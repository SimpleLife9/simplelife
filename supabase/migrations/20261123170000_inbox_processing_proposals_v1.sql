-- Persist deterministic Inbox processing proposals as independently reviewable parts.
-- Tested on ephemeral CI Postgres. No hosted migration is performed by this PR.

GRANT SELECT, INSERT, UPDATE ON TABLE public.capture_part TO service_role;

CREATE OR REPLACE FUNCTION public.claim_inbox_processing_run_by_id(
  p_run_id uuid, p_lease_token uuid, p_lease_seconds integer DEFAULT 120
)
RETURNS TABLE (
  run_id uuid, capture_id uuid, owner_profile_id uuid, processor_version text,
  attempt_number integer, lease_token uuid, lease_expires_at timestamptz, content_original text
)
LANGUAGE plpgsql VOLATILE SECURITY INVOKER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_run_id uuid;
  v_run public.processing_run%ROWTYPE;
  v_owner_profile_id uuid;
  v_content_original text;
BEGIN
  IF current_user <> 'service_role' THEN
    RAISE EXCEPTION 'Inbox processing claim requires service_role' USING ERRCODE = '42501';
  END IF;
  IF p_run_id IS NULL OR p_lease_token IS NULL OR p_lease_seconds IS NULL
     OR p_lease_seconds NOT BETWEEN 30 AND 600 THEN
    RAISE EXCEPTION 'A run, lease token and bounded lease duration are required' USING ERRCODE = '22023';
  END IF;

  UPDATE public.processing_run pr
  SET status = 'failed', finished_at = now(), lease_token = NULL, lease_expires_at = NULL,
      error_code = 'MAX_ATTEMPTS_EXCEEDED', error_message = NULL
  WHERE pr.id = p_run_id AND pr.attempt_number >= 5
    AND (
      (pr.status IN ('queued','retryable') AND pr.next_attempt_at <= now())
      OR (pr.status = 'running' AND pr.lease_expires_at <= now())
    );
  IF FOUND THEN
    UPDATE public.capture c SET processing_status = 'failed'
    WHERE c.id = (SELECT capture_id FROM public.processing_run WHERE id = p_run_id)
      AND c.deleted_at IS NULL;
    RETURN;
  END IF;

  SELECT pr.id INTO v_run_id
  FROM public.processing_run pr
  JOIN public.capture c ON c.id = pr.capture_id
  WHERE pr.id = p_run_id AND c.deleted_at IS NULL AND pr.attempt_number < 5
    AND (
      (pr.status IN ('queued','retryable') AND pr.next_attempt_at <= now())
      OR (pr.status = 'running' AND pr.lease_expires_at <= now())
    )
  FOR UPDATE OF pr SKIP LOCKED;
  IF v_run_id IS NULL THEN RETURN; END IF;

  UPDATE public.processing_run pr
  SET status = 'running',
      attempt_number = CASE WHEN pr.status = 'queued' THEN pr.attempt_number ELSE pr.attempt_number + 1 END,
      started_at = now(), finished_at = NULL,
      lease_token = p_lease_token,
      lease_expires_at = now() + make_interval(secs => p_lease_seconds),
      error_code = NULL, error_message = NULL
  WHERE pr.id = v_run_id
  RETURNING * INTO v_run;

  UPDATE public.capture c SET processing_status = 'processing'
  WHERE c.id = v_run.capture_id AND c.deleted_at IS NULL
  RETURNING c.owner_user_id, c.content_original INTO v_owner_profile_id, v_content_original;
  IF NOT FOUND THEN
    UPDATE public.processing_run
    SET status = 'failed', finished_at = now(), lease_token = NULL, lease_expires_at = NULL,
        error_code = 'CAPTURE_UNAVAILABLE', error_message = NULL
    WHERE id = v_run.id;
    RETURN;
  END IF;

  RETURN QUERY SELECT v_run.id, v_run.capture_id, v_owner_profile_id, v_run.processor_version,
    v_run.attempt_number, v_run.lease_token, v_run.lease_expires_at, v_content_original;
END;
$function$;

ALTER FUNCTION public.claim_inbox_processing_run_by_id(uuid, uuid, integer) OWNER TO postgres;
REVOKE ALL PRIVILEGES ON FUNCTION public.claim_inbox_processing_run_by_id(uuid, uuid, integer)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.claim_inbox_processing_run_by_id(uuid, uuid, integer) TO service_role;

CREATE OR REPLACE FUNCTION public.complete_inbox_processing_run_with_parts(
  p_run_id uuid, p_lease_token uuid, p_result jsonb, p_proposals jsonb
)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY INVOKER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_run public.processing_run%ROWTYPE;
  v_source text;
  v_reconstructed text := '';
  v_item jsonb;
  v_fragment text;
  v_category text;
  v_confidence numeric;
  v_interpretation text;
  v_index integer := 0;
  v_completed boolean;
  v_rows integer;
BEGIN
  IF current_user <> 'service_role' THEN
    RAISE EXCEPTION 'Inbox proposal persistence requires service_role' USING ERRCODE = '42501';
  END IF;
  IF p_run_id IS NULL OR p_lease_token IS NULL OR p_result IS NULL
     OR jsonb_typeof(p_result) <> 'object' OR pg_column_size(p_result) > 65536
     OR p_proposals IS NULL OR jsonb_typeof(p_proposals) <> 'array'
     OR jsonb_array_length(p_proposals) < 1 OR jsonb_array_length(p_proposals) > 30 THEN
    RAISE EXCEPTION 'Invalid Inbox proposal completion payload' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_run FROM public.processing_run WHERE id = p_run_id FOR UPDATE;
  IF NOT FOUND OR v_run.status <> 'running' OR v_run.lease_token IS DISTINCT FROM p_lease_token
     OR v_run.lease_expires_at IS NULL OR v_run.lease_expires_at <= now() THEN
    RETURN false;
  END IF;
  SELECT c.content_original INTO v_source
  FROM public.capture c WHERE c.id = v_run.capture_id AND c.deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_proposals) AS item(value) LOOP
    IF jsonb_typeof(v_item) <> 'object'
       OR jsonb_typeof(v_item->'originalFragment') <> 'string'
       OR jsonb_typeof(v_item->'category') <> 'string'
       OR jsonb_typeof(v_item->'confidence') <> 'number'
       OR jsonb_typeof(v_item->'requiresClarification') <> 'boolean' THEN
      RAISE EXCEPTION 'Invalid Inbox part proposal shape' USING ERRCODE = '22023';
    END IF;
    v_fragment := v_item->>'originalFragment';
    v_category := v_item->>'category';
    v_confidence := (v_item->>'confidence')::numeric;
    v_interpretation := COALESCE(v_item->>'interpretation', '');
    IF btrim(v_fragment) = '' OR v_category NOT IN
       ('task','event','request','habit','goal_subgoal','project','note_idea','list')
       OR v_confidence < 0 OR v_confidence > 1
       OR length(v_interpretation) > 1000 THEN
      RAISE EXCEPTION 'Inbox part proposal failed validation' USING ERRCODE = '22023';
    END IF;
    v_reconstructed := v_reconstructed || v_fragment;
  END LOOP;
  IF v_reconstructed IS DISTINCT FROM v_source THEN
    RAISE EXCEPTION 'Inbox proposals must preserve the exact source with no gaps or overlaps'
      USING ERRCODE = '22023';
  END IF;

  SELECT public.complete_inbox_processing_run(p_run_id, p_lease_token, p_result)
  INTO v_completed;
  IF NOT v_completed THEN RETURN false; END IF;

  FOR v_item IN
    SELECT value FROM jsonb_array_elements(p_proposals) WITH ORDINALITY AS parts(value, ordinality)
    ORDER BY ordinality
  LOOP
    v_fragment := v_item->>'originalFragment';
    v_category := v_item->>'category';
    v_interpretation := COALESCE(v_item->>'interpretation', '');
    INSERT INTO public.capture_part(
      id, capture_id, part_index, original_fragment, interpretation, category, review_status
    ) VALUES (
      private.uuidv7(), v_run.capture_id, v_index, v_fragment, v_interpretation, v_category, 'unreviewed'
    )
    ON CONFLICT (capture_id, part_index) DO UPDATE
      SET original_fragment = EXCLUDED.original_fragment,
          interpretation = EXCLUDED.interpretation,
          category = EXCLUDED.category,
          review_status = 'unreviewed'
      WHERE public.capture_part.review_status = 'unreviewed';
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows <> 1 THEN
      RAISE EXCEPTION 'An Inbox part was already reviewed and cannot be overwritten by processing'
        USING ERRCODE = '55000';
    END IF;
    v_index := v_index + 1;
  END LOOP;
  RETURN true;
END;
$function$;

ALTER FUNCTION public.complete_inbox_processing_run_with_parts(uuid, uuid, jsonb, jsonb) OWNER TO postgres;
REVOKE ALL PRIVILEGES ON FUNCTION public.complete_inbox_processing_run_with_parts(uuid, uuid, jsonb, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.complete_inbox_processing_run_with_parts(uuid, uuid, jsonb, jsonb)
  TO service_role;
