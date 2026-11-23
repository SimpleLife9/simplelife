-- Version-bound, owner-scoped mutations for an individual materialized occurrence.
-- Series rules and the original occurrence identity are immutable in this RPC.

CREATE TABLE public.calendar_event_occurrence_mutation_request (
  owner_user_id uuid NOT NULL REFERENCES public.user_profile(id) ON DELETE RESTRICT,
  idempotency_key uuid NOT NULL,
  occurrence_id uuid NOT NULL,
  payload_version text NOT NULL CHECK (payload_version = 'recurring-occurrence-mutate-v1'),
  payload_hash bytea NOT NULL CHECK (octet_length(payload_hash) = 32),
  response_http_status integer,
  response_body jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  PRIMARY KEY (owner_user_id, idempotency_key),
  CONSTRAINT calendar_event_occurrence_mutation_key_uuidv7_check
    CHECK ((get_byte(uuid_send(idempotency_key), 6) >> 4) = 7
      AND (get_byte(uuid_send(idempotency_key), 8) & 192) = 128),
  CONSTRAINT calendar_event_occurrence_mutation_owner_fk
    FOREIGN KEY (occurrence_id, owner_user_id)
    REFERENCES public.calendar_event_occurrence (id, owner_user_id) ON DELETE RESTRICT,
  CONSTRAINT calendar_event_occurrence_mutation_response_check
    CHECK (
      (response_http_status IS NULL AND response_body IS NULL AND completed_at IS NULL)
      OR (response_http_status = 200 AND response_body IS NOT NULL AND completed_at IS NOT NULL)
    )
);

ALTER TABLE public.calendar_event_occurrence_mutation_request ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.calendar_event_occurrence_mutation_request
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.calendar_event_occurrence_mutation_request TO service_role;

COMMENT ON TABLE public.calendar_event_occurrence_mutation_request IS
  'Server-only idempotency receipts for version-bound recurring occurrence exception mutations.';

CREATE OR REPLACE FUNCTION public.mutate_calendar_event_occurrence_once(
  p_owner_user_id uuid,
  p_occurrence_id uuid,
  p_idempotency_key uuid,
  p_payload_hash_hex text,
  p_expected_row_version bigint,
  p_occurrence_patch jsonb,
  p_now timestamptz
)
RETURNS TABLE (
  http_status integer,
  response_body jsonb,
  replayed boolean
)
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_current public.calendar_event_occurrence%ROWTYPE;
  v_candidate public.calendar_event_occurrence%ROWTYPE;
  v_existing public.calendar_event_occurrence_mutation_request%ROWTYPE;
  v_payload_hash bytea;
  v_merged jsonb;
  v_response jsonb;
BEGIN
  IF current_user <> 'service_role' THEN
    RAISE EXCEPTION 'mutate_calendar_event_occurrence_once requires service_role'
      USING ERRCODE = '42501';
  END IF;

  IF p_owner_user_id IS NULL OR p_occurrence_id IS NULL OR p_idempotency_key IS NULL
     OR p_now IS NULL OR p_expected_row_version IS NULL OR p_expected_row_version < 1 THEN
    RAISE EXCEPTION 'Verified owner, occurrence, UUIDv7 key, expected version and timestamp are required'
      USING ERRCODE = '22023';
  END IF;
  IF (get_byte(uuid_send(p_idempotency_key), 6) >> 4) <> 7
     OR (get_byte(uuid_send(p_idempotency_key), 8) & 192) <> 128 THEN
    RAISE EXCEPTION 'Occurrence mutation idempotency key must be UUIDv7' USING ERRCODE = '22023';
  END IF;
  IF p_payload_hash_hex IS NULL OR p_payload_hash_hex !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Occurrence mutation payload hash must be 64 lowercase SHA-256 hexadecimal characters'
      USING ERRCODE = '22023';
  END IF;
  v_payload_hash := decode(p_payload_hash_hex, 'hex');

  IF p_occurrence_patch IS NULL
     OR jsonb_typeof(p_occurrence_patch) IS DISTINCT FROM 'object'
     OR NOT (p_occurrence_patch ? 'occurrence_status')
     OR NOT (p_occurrence_patch ? 'override_kind')
     OR EXISTS (
       SELECT 1 FROM jsonb_object_keys(p_occurrence_patch) AS supplied(key)
       WHERE supplied.key <> ALL (ARRAY[
         'occurrence_status','override_kind','actual_local_date','actual_local_time',
         'start_date','end_date_exclusive','start_local','end_local','time_zone',
         'starts_at','ends_at','start_disambiguation','end_disambiguation',
         'start_gap_strategy','end_gap_strategy','resolver_metadata','review_candidate'
       ]::text[])
     ) THEN
    RAISE EXCEPTION 'Occurrence patch contains missing or unsupported fields'
      USING ERRCODE = '22023';
  END IF;

  IF NOT (
    (p_occurrence_patch->>'occurrence_status' = 'cancelled'
      AND p_occurrence_patch->>'override_kind' = 'cancelled')
    OR
    (p_occurrence_patch->>'occurrence_status' = 'scheduled'
      AND p_occurrence_patch->>'override_kind' IN ('moved', 'modified'))
  ) THEN
    RAISE EXCEPTION 'Occurrence mutation must be cancelled/cancelled or scheduled/moved|modified'
      USING ERRCODE = '22023';
  END IF;

  -- Use the same owner lock as Event, Protected Time and TaskSchedule writes.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_owner_user_id::text, 8102026));

  SELECT * INTO v_existing
  FROM public.calendar_event_occurrence_mutation_request
  WHERE owner_user_id = p_owner_user_id AND idempotency_key = p_idempotency_key
  FOR UPDATE;

  IF FOUND THEN
    IF v_existing.occurrence_id IS DISTINCT FROM p_occurrence_id
       OR v_existing.payload_version IS DISTINCT FROM 'recurring-occurrence-mutate-v1'
       OR v_existing.payload_hash IS DISTINCT FROM v_payload_hash THEN
      RETURN QUERY SELECT 409,
        jsonb_build_object('error', 'IDEMPOTENCY_KEY_REUSED'), false;
      RETURN;
    END IF;
    IF v_existing.response_http_status IS NULL OR v_existing.response_body IS NULL THEN
      RAISE EXCEPTION 'Committed occurrence mutation receipt is incomplete' USING ERRCODE = '55000';
    END IF;
    RETURN QUERY SELECT v_existing.response_http_status, v_existing.response_body, true;
    RETURN;
  END IF;

  SELECT * INTO v_current
  FROM public.calendar_event_occurrence
  WHERE id = p_occurrence_id AND owner_user_id = p_owner_user_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 404, jsonb_build_object('error', 'OCCURRENCE_NOT_FOUND'), false;
    RETURN;
  END IF;
  IF v_current.row_version IS DISTINCT FROM p_expected_row_version THEN
    RETURN QUERY SELECT 409, jsonb_build_object(
      'error', 'OCCURRENCE_VERSION_CONFLICT',
      'occurrenceId', v_current.id::text,
      'rowVersion', v_current.row_version,
      'updatedAt', v_current.updated_at
    ), false;
    RETURN;
  END IF;

  v_merged := to_jsonb(v_current) || p_occurrence_patch;
  SELECT (jsonb_populate_record(v_current, v_merged)).* INTO v_candidate;

  IF v_candidate.id IS DISTINCT FROM v_current.id
     OR v_candidate.owner_user_id IS DISTINCT FROM v_current.owner_user_id
     OR v_candidate.created_by_user_id IS DISTINCT FROM v_current.created_by_user_id
     OR v_candidate.calendar_event_id IS DISTINCT FROM v_current.calendar_event_id
     OR v_candidate.occurrence_key IS DISTINCT FROM v_current.occurrence_key
     OR v_candidate.original_local_date IS DISTINCT FROM v_current.original_local_date
     OR v_candidate.original_local_time IS DISTINCT FROM v_current.original_local_time
     OR v_candidate.created_at IS DISTINCT FROM v_current.created_at
     OR v_candidate.row_version IS DISTINCT FROM v_current.row_version
     OR v_candidate.updated_by_user_id IS DISTINCT FROM p_owner_user_id THEN
    RAISE EXCEPTION 'Occurrence identity, owner, original slot and creation metadata are immutable'
      USING ERRCODE = '22023';
  END IF;

  IF v_candidate.occurrence_status = 'cancelled'
     AND v_candidate.override_kind = 'cancelled'
     AND v_candidate.review_candidate IS NOT NULL THEN
    RAISE EXCEPTION 'A cancelled occurrence cannot retain an unresolved TZDB review candidate'
      USING ERRCODE = '22023';
  END IF;
  IF v_candidate.occurrence_status = 'scheduled' AND v_candidate.override_kind = 'moved'
     AND v_candidate.actual_local_date = v_current.actual_local_date
     AND v_candidate.actual_local_time IS NOT DISTINCT FROM v_current.actual_local_time THEN
    RAISE EXCEPTION 'A moved occurrence must change its effective civil slot'
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.calendar_event_occurrence AS occurrence
  SET actual_local_date = v_candidate.actual_local_date,
      actual_local_time = v_candidate.actual_local_time,
      start_date = v_candidate.start_date,
      end_date_exclusive = v_candidate.end_date_exclusive,
      start_local = v_candidate.start_local,
      end_local = v_candidate.end_local,
      time_zone = v_candidate.time_zone,
      starts_at = v_candidate.starts_at,
      ends_at = v_candidate.ends_at,
      start_disambiguation = v_candidate.start_disambiguation,
      end_disambiguation = v_candidate.end_disambiguation,
      start_gap_strategy = v_candidate.start_gap_strategy,
      end_gap_strategy = v_candidate.end_gap_strategy,
      resolver_metadata = v_candidate.resolver_metadata,
      occurrence_status = v_candidate.occurrence_status,
      override_kind = v_candidate.override_kind,
      review_candidate = v_candidate.review_candidate
  WHERE occurrence.id = p_occurrence_id
    AND occurrence.owner_user_id = p_owner_user_id
    AND occurrence.row_version = p_expected_row_version
  RETURNING * INTO v_candidate;

  IF NOT FOUND THEN
    RETURN QUERY SELECT 409, jsonb_build_object('error', 'OCCURRENCE_VERSION_CONFLICT'), false;
    RETURN;
  END IF;

  v_response := jsonb_build_object(
    'occurrenceId', v_candidate.id::text,
    'seriesEventId', v_candidate.calendar_event_id::text,
    'occurrenceKey', v_candidate.occurrence_key,
    'occurrenceStatus', v_candidate.occurrence_status,
    'overrideKind', v_candidate.override_kind,
    'rowVersion', v_candidate.row_version,
    'updatedAt', v_candidate.updated_at
  );

  INSERT INTO public.calendar_event_occurrence_mutation_request (
    owner_user_id, idempotency_key, occurrence_id, payload_version,
    payload_hash, response_http_status, response_body, completed_at
  ) VALUES (
    p_owner_user_id, p_idempotency_key, p_occurrence_id,
    'recurring-occurrence-mutate-v1', v_payload_hash, 200, v_response, p_now
  );

  RETURN QUERY SELECT 200, v_response, false;
END;
$function$;

ALTER FUNCTION public.mutate_calendar_event_occurrence_once(uuid, uuid, uuid, text, bigint, jsonb, timestamptz)
  OWNER TO postgres;
REVOKE ALL PRIVILEGES ON FUNCTION public.mutate_calendar_event_occurrence_once(uuid, uuid, uuid, text, bigint, jsonb, timestamptz)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mutate_calendar_event_occurrence_once(uuid, uuid, uuid, text, bigint, jsonb, timestamptz)
  TO service_role;
