-- Inbox processing queue and server-only worker lifecycle.
-- Source-only migration: CI applies it to an ephemeral local Postgres database.
-- Never apply to hosted Supabase without the separate Human Gate.

ALTER TABLE public.processing_run
  DROP CONSTRAINT processing_run_status_check,
  ADD CONSTRAINT processing_run_status_check
    CHECK (status IN ('queued','running','succeeded','retryable','failed')),
  ADD COLUMN lease_token uuid,
  ADD COLUMN lease_expires_at timestamptz,
  ADD COLUMN next_attempt_at timestamptz NOT NULL DEFAULT now(),
  ALTER COLUMN started_at DROP NOT NULL,
  ADD CONSTRAINT processing_run_lease_pair_check
    CHECK ((lease_token IS NULL) = (lease_expires_at IS NULL));

CREATE INDEX processing_run_queue_due_idx
  ON public.processing_run (next_attempt_at, created_at)
  WHERE status IN ('queued','retryable');
CREATE INDEX processing_run_expired_lease_idx
  ON public.processing_run (lease_expires_at, created_at)
  WHERE status = 'running';

GRANT SELECT, INSERT, UPDATE ON TABLE public.processing_run TO service_role;
GRANT SELECT, UPDATE (processing_status) ON TABLE public.capture TO service_role;

CREATE OR REPLACE FUNCTION public.enqueue_inbox_processing_run(
  p_run_id uuid,
  p_owner_profile_id uuid,
  p_capture_id uuid,
  p_idempotency_key text,
  p_processor_version text
)
RETURNS TABLE (run_id uuid, run_status text, attempt_number integer, replayed boolean)
LANGUAGE plpgsql VOLATILE SECURITY INVOKER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_capture public.capture%ROWTYPE;
  v_run public.processing_run%ROWTYPE;
BEGIN
  IF current_user <> 'service_role' THEN
    RAISE EXCEPTION 'Inbox processing enqueue requires service_role' USING ERRCODE = '42501';
  END IF;
  IF p_run_id IS NULL
     OR (get_byte(uuid_send(p_run_id), 6) >> 4) <> 7
     OR (get_byte(uuid_send(p_run_id), 8) & 192) <> 128 THEN
    RAISE EXCEPTION 'Processing run id must be a valid UUIDv7' USING ERRCODE = '22023';
  END IF;
  IF p_owner_profile_id IS NULL OR p_capture_id IS NULL THEN
    RAISE EXCEPTION 'Owner and capture identifiers are required' USING ERRCODE = '22023';
  END IF;
  IF p_idempotency_key IS NULL
     OR p_idempotency_key !~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
    RAISE EXCEPTION 'Idempotency key must be a canonical UUIDv7' USING ERRCODE = '22023';
  END IF;
  IF p_processor_version IS NULL
     OR p_processor_version !~ '^inbox-[a-z0-9][a-z0-9._-]{0,47}$' THEN
    RAISE EXCEPTION 'Processor version is invalid' USING ERRCODE = '22023';
  END IF;

  -- Serializes enqueue attempts for the same capture, including different keys.
  -- A transaction-scoped advisory lock serializes enqueues without taking the
  -- capture row lock before the processing_run lock. This keeps lock order
  -- compatible with claim/complete/fail (run, then capture) and avoids deadlocks.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_capture_id::text, 0));

  SELECT * INTO v_capture
  FROM public.capture
  WHERE id = p_capture_id AND owner_user_id = p_owner_profile_id AND deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CAPTURE_NOT_FOUND_OR_FORBIDDEN' USING ERRCODE = '42501';
  END IF;

  -- A same-key committed request always replays before checking current state.
  SELECT * INTO v_run
  FROM public.processing_run
  WHERE capture_id = p_capture_id AND idempotency_key = p_idempotency_key
  FOR UPDATE;
  IF FOUND THEN
    IF v_run.processor_version IS DISTINCT FROM p_processor_version THEN
      RAISE EXCEPTION 'IDEMPOTENCY_KEY_REUSED' USING ERRCODE = '23505';
    END IF;
    RETURN QUERY SELECT v_run.id, v_run.status, v_run.attempt_number, true;
    RETURN;
  END IF;

  -- Fresh keys join an existing active job instead of creating concurrent work.
  SELECT * INTO v_run
  FROM public.processing_run
  WHERE capture_id = p_capture_id AND status IN ('queued','running','retryable')
  ORDER BY created_at DESC
  LIMIT 1
  FOR UPDATE;
  IF FOUND THEN
    RETURN QUERY SELECT v_run.id, v_run.status, v_run.attempt_number, true;
    RETURN;
  END IF;

  -- The row may have changed while we waited for a worker's run lock.
  -- Re-read processing state after that lock resolves so a just-completed
  -- capture cannot be re-queued by a concurrent fresh-key request.
  SELECT * INTO v_capture
  FROM public.capture
  WHERE id = p_capture_id AND owner_user_id = p_owner_profile_id AND deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CAPTURE_NOT_FOUND_OR_FORBIDDEN' USING ERRCODE = '42501';
  END IF;

  IF v_capture.processing_status = 'processed' THEN
    RAISE EXCEPTION 'CAPTURE_ALREADY_PROCESSED' USING ERRCODE = '55000';
  END IF;

  INSERT INTO public.processing_run (
    id, capture_id, processor_version, status, attempt_number,
    idempotency_key, result, started_at, next_attempt_at
  ) VALUES (
    p_run_id, p_capture_id, p_processor_version, 'queued', 1,
    p_idempotency_key, '{}'::jsonb, NULL, now()
  )
  RETURNING * INTO v_run;

  UPDATE public.capture SET processing_status = 'queued'
  WHERE id = p_capture_id AND owner_user_id = p_owner_profile_id AND deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CAPTURE_NOT_FOUND_OR_FORBIDDEN' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY SELECT v_run.id, v_run.status, v_run.attempt_number, false;
END;
$function$;

ALTER FUNCTION public.enqueue_inbox_processing_run(uuid, uuid, uuid, text, text) OWNER TO postgres;
REVOKE ALL PRIVILEGES ON FUNCTION public.enqueue_inbox_processing_run(uuid, uuid, uuid, text, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.enqueue_inbox_processing_run(uuid, uuid, uuid, text, text) TO service_role;

CREATE OR REPLACE FUNCTION public.claim_inbox_processing_run(
  p_lease_token uuid,
  p_lease_seconds integer DEFAULT 120
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
  IF p_lease_token IS NULL OR p_lease_seconds NOT BETWEEN 30 AND 600 THEN
    RAISE EXCEPTION 'A lease token and lease duration between 30 and 600 seconds are required'
      USING ERRCODE = '22023';
  END IF;

  -- Expired work at the attempt limit becomes terminal instead of looping forever.
  WITH exhausted AS (
    UPDATE public.processing_run pr
    SET status = 'failed', finished_at = now(), lease_token = NULL, lease_expires_at = NULL,
        error_code = 'MAX_ATTEMPTS_EXCEEDED', error_message = NULL
    WHERE pr.attempt_number >= 5
      AND (
        (pr.status IN ('queued','retryable') AND pr.next_attempt_at <= now())
        OR (pr.status = 'running' AND pr.lease_expires_at <= now())
      )
    RETURNING pr.capture_id
  )
  UPDATE public.capture c SET processing_status = 'failed'
  FROM exhausted e WHERE c.id = e.capture_id AND c.deleted_at IS NULL;

  SELECT pr.id INTO v_run_id
  FROM public.processing_run pr
  JOIN public.capture c ON c.id = pr.capture_id
  WHERE c.deleted_at IS NULL AND pr.attempt_number < 5
    AND (
      (pr.status IN ('queued','retryable') AND pr.next_attempt_at <= now())
      OR (pr.status = 'running' AND pr.lease_expires_at <= now())
    )
  ORDER BY CASE WHEN pr.status = 'running' THEN pr.lease_expires_at ELSE pr.next_attempt_at END,
    pr.created_at
  LIMIT 1
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

ALTER FUNCTION public.claim_inbox_processing_run(uuid, integer) OWNER TO postgres;
REVOKE ALL PRIVILEGES ON FUNCTION public.claim_inbox_processing_run(uuid, integer)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.claim_inbox_processing_run(uuid, integer) TO service_role;

CREATE OR REPLACE FUNCTION public.complete_inbox_processing_run(
  p_run_id uuid, p_lease_token uuid, p_result jsonb
)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY INVOKER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_run public.processing_run%ROWTYPE;
  v_deleted_at timestamptz;
BEGIN
  IF current_user <> 'service_role' THEN
    RAISE EXCEPTION 'Inbox processing completion requires service_role' USING ERRCODE = '42501';
  END IF;
  IF p_run_id IS NULL OR p_lease_token IS NULL OR p_result IS NULL
     OR jsonb_typeof(p_result) <> 'object' OR pg_column_size(p_result) > 65536 THEN
    RAISE EXCEPTION 'Invalid processing completion payload' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_run FROM public.processing_run WHERE id = p_run_id FOR UPDATE;
  IF NOT FOUND OR v_run.status <> 'running' OR v_run.lease_token IS DISTINCT FROM p_lease_token
     OR v_run.lease_expires_at IS NULL OR v_run.lease_expires_at <= now() THEN
    RETURN false;
  END IF;

  SELECT deleted_at INTO v_deleted_at
  FROM public.capture WHERE id = v_run.capture_id FOR UPDATE;
  IF NOT FOUND OR v_deleted_at IS NOT NULL THEN
    UPDATE public.processing_run
    SET status = 'failed', finished_at = now(), lease_token = NULL, lease_expires_at = NULL,
        error_code = 'CAPTURE_UNAVAILABLE', error_message = NULL
    WHERE id = p_run_id;
    RETURN false;
  END IF;

  UPDATE public.processing_run
  SET status = 'succeeded', result = p_result, finished_at = now(),
      lease_token = NULL, lease_expires_at = NULL, error_code = NULL, error_message = NULL
  WHERE id = p_run_id;
  UPDATE public.capture SET processing_status = 'processed' WHERE id = v_run.capture_id;
  RETURN true;
END;
$function$;

ALTER FUNCTION public.complete_inbox_processing_run(uuid, uuid, jsonb) OWNER TO postgres;
REVOKE ALL PRIVILEGES ON FUNCTION public.complete_inbox_processing_run(uuid, uuid, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.complete_inbox_processing_run(uuid, uuid, jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.fail_inbox_processing_run(
  p_run_id uuid, p_lease_token uuid, p_error_code text,
  p_retryable boolean, p_retry_after_seconds integer DEFAULT 60
)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY INVOKER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_run public.processing_run%ROWTYPE;
  v_next_status text;
BEGIN
  IF current_user <> 'service_role' THEN
    RAISE EXCEPTION 'Inbox processing failure update requires service_role' USING ERRCODE = '42501';
  END IF;
  IF p_run_id IS NULL OR p_lease_token IS NULL OR p_error_code IS NULL
     OR p_error_code !~ '^[A-Z0-9_]{1,64}$' OR p_retryable IS NULL
     OR p_retry_after_seconds NOT BETWEEN 0 AND 86400 THEN
    RAISE EXCEPTION 'Invalid processing failure payload' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_run FROM public.processing_run WHERE id = p_run_id FOR UPDATE;
  IF NOT FOUND OR v_run.status <> 'running' OR v_run.lease_token IS DISTINCT FROM p_lease_token
     OR v_run.lease_expires_at IS NULL OR v_run.lease_expires_at <= now() THEN
    RETURN false;
  END IF;

  v_next_status := CASE WHEN p_retryable AND v_run.attempt_number < 5 THEN 'retryable' ELSE 'failed' END;
  UPDATE public.processing_run
  SET status = v_next_status, finished_at = now(),
      next_attempt_at = now() + make_interval(secs => p_retry_after_seconds),
      lease_token = NULL, lease_expires_at = NULL,
      error_code = p_error_code, error_message = NULL
  WHERE id = p_run_id;
  UPDATE public.capture
  SET processing_status = CASE WHEN v_next_status = 'retryable' THEN 'queued' ELSE 'failed' END
  WHERE id = v_run.capture_id AND deleted_at IS NULL;
  RETURN true;
END;
$function$;

ALTER FUNCTION public.fail_inbox_processing_run(uuid, uuid, text, boolean, integer) OWNER TO postgres;
REVOKE ALL PRIVILEGES ON FUNCTION public.fail_inbox_processing_run(uuid, uuid, text, boolean, integer)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fail_inbox_processing_run(uuid, uuid, text, boolean, integer) TO service_role;
