
-- Server-only, owner-scoped idempotency receipt for one-off Event creation.
-- This migration is source code only; CI applies it to ephemeral local Postgres.
-- Never apply it to hosted Supabase without a separate Human Gate.

CREATE TABLE public.event_create_request (
  owner_user_id uuid NOT NULL
    REFERENCES public.user_profile(id) ON DELETE RESTRICT,
  idempotency_key uuid NOT NULL,
  payload_version text NOT NULL
    CHECK (payload_version ~ '^event-create-v[1-9][0-9]*$'),
  payload_hash bytea NOT NULL
    CHECK (octet_length(payload_hash) = 32),

  -- These are a minimal immutable receipt, not a copy of the Event payload.
  -- Intentionally no FK to calendar_event: keep the tombstone if that Event
  -- is eventually physically purged, so a late offline retry cannot recreate it.
  result_event_id uuid,
  response_created_at timestamptz,
  response_event_status text
    CHECK (response_event_status IS NULL OR response_event_status IN ('preparing', 'proposed', 'confirmed')),
  created_at timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (owner_user_id, idempotency_key),
  UNIQUE (result_event_id),

  CONSTRAINT event_create_request_key_uuidv7_check
    CHECK (
      (get_byte(uuid_send(idempotency_key), 6) >> 4) = 7
      AND (get_byte(uuid_send(idempotency_key), 8) & 192) = 128
    ),
  CONSTRAINT event_create_request_receipt_complete_check
    CHECK (
      (result_event_id IS NULL AND response_created_at IS NULL AND response_event_status IS NULL)
      OR
      (result_event_id IS NOT NULL AND response_created_at IS NOT NULL AND response_event_status IS NOT NULL)
    )
);

ALTER TABLE public.event_create_request ENABLE ROW LEVEL SECURITY;

-- No browser/API-user access. service_role is used only inside the trusted
-- Edge Function and still receives no DELETE, TRUNCATE or audit_event access.
REVOKE ALL PRIVILEGES ON TABLE public.event_create_request
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.event_create_request TO service_role;

CREATE OR REPLACE FUNCTION public.create_calendar_event_once(
  p_owner_user_id uuid,
  p_idempotency_key uuid,
  p_payload_version text,
  p_payload_hash_hex text,
  p_event_record jsonb
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
  v_event public.calendar_event%ROWTYPE;
  v_existing public.event_create_request%ROWTYPE;
  v_claimed_rows integer;
  v_payload_hash bytea;
  v_response jsonb;
BEGIN
  -- The routine is callable only from the trusted server-role path.
  IF current_user <> 'service_role' THEN
    RAISE EXCEPTION 'create_calendar_event_once requires service_role'
      USING ERRCODE = '42501';
  END IF;

  IF p_owner_user_id IS NULL THEN
    RAISE EXCEPTION 'Verified owner profile is required'
      USING ERRCODE = '22023';
  END IF;

  IF p_idempotency_key IS NULL
     OR (get_byte(uuid_send(p_idempotency_key), 6) >> 4) <> 7
     OR (get_byte(uuid_send(p_idempotency_key), 8) & 192) <> 128 THEN
    RAISE EXCEPTION 'Idempotency key must be a valid UUIDv7'
      USING ERRCODE = '22023';
  END IF;

  IF p_payload_version IS DISTINCT FROM 'event-create-v1' THEN
    RAISE EXCEPTION 'Unsupported Event create payload version'
      USING ERRCODE = '22023';
  END IF;

  IF p_payload_hash_hex IS NULL
     OR p_payload_hash_hex !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Payload hash must be 64 lowercase SHA-256 hexadecimal characters'
      USING ERRCODE = '22023';
  END IF;
  v_payload_hash := decode(p_payload_hash_hex, 'hex');

  IF p_event_record IS NULL OR jsonb_typeof(p_event_record) <> 'object' THEN
    RAISE EXCEPTION 'A serialized Event record object is required'
      USING ERRCODE = '22023';
  END IF;

  -- The serializer emits this exact record shape. Reject unknown keys rather
  -- than silently ignoring client/server-owned fields through jsonb_populate_record.
  IF jsonb_object_length(p_event_record) <> 26
     OR EXISTS (
       SELECT 1
       FROM jsonb_object_keys(p_event_record) AS supplied(key)
       WHERE supplied.key <> ALL (ARRAY[
         'id',
         'owner_user_id',
         'created_by_user_id',
         'updated_by_user_id',
         'title',
         'description',
         'location_label',
         'location_kind',
         'event_status',
         'temporal_kind',
         'start_date',
         'end_date_exclusive',
         'start_local',
         'end_local',
         'time_zone',
         'starts_at',
         'ends_at',
         'start_disambiguation',
         'end_disambiguation',
         'start_gap_strategy',
         'end_gap_strategy',
         'archived_at',
         'deleted_at',
         'purge_after',
         'created_at',
         'updated_at'
       ]::text[])
     ) THEN
    RAISE EXCEPTION 'Serialized Event record contains missing or unsupported fields'
      USING ERRCODE = '22023';
  END IF;

  SELECT *
    INTO v_event
  FROM jsonb_populate_record(NULL::public.calendar_event, p_event_record);

  IF v_event.id IS NULL
     OR v_event.owner_user_id IS NULL
     OR v_event.created_by_user_id IS NULL
     OR v_event.updated_by_user_id IS NULL
     OR v_event.created_at IS NULL
     OR v_event.updated_at IS NULL
     OR v_event.owner_user_id IS DISTINCT FROM p_owner_user_id
     OR v_event.created_by_user_id IS DISTINCT FROM p_owner_user_id
     OR v_event.updated_by_user_id IS DISTINCT FROM p_owner_user_id
     OR v_event.id = p_idempotency_key THEN
    RAISE EXCEPTION 'Serialized Event identity does not match the trusted owner or idempotency key'
      USING ERRCODE = '22023';
  END IF;

  -- Claim the owner/key pair. The unique constraint is the concurrency gate:
  -- a concurrent insert waits for the winning transaction to commit/rollback.
  INSERT INTO public.event_create_request (
    owner_user_id,
    idempotency_key,
    payload_version,
    payload_hash
  ) VALUES (
    p_owner_user_id,
    p_idempotency_key,
    p_payload_version,
    v_payload_hash
  )
  ON CONFLICT (owner_user_id, idempotency_key) DO NOTHING;

  GET DIAGNOSTICS v_claimed_rows = ROW_COUNT;

  IF v_claimed_rows = 0 THEN
    SELECT *
      INTO v_existing
    FROM public.event_create_request
    WHERE owner_user_id = p_owner_user_id
      AND idempotency_key = p_idempotency_key
    FOR UPDATE;

    IF NOT FOUND THEN
      -- This can occur only under a non-default transaction snapshot after a
      -- concurrent rollback. The caller may retry safely with the same key.
      RAISE EXCEPTION 'Concurrent idempotency claim was not visible; retry the same key'
        USING ERRCODE = '40001';
    END IF;

    IF v_existing.payload_version IS DISTINCT FROM p_payload_version
       OR v_existing.payload_hash IS DISTINCT FROM v_payload_hash THEN
      RETURN QUERY
        SELECT 409, jsonb_build_object('error', 'IDEMPOTENCY_KEY_REUSED'), false;
      RETURN;
    END IF;

    IF v_existing.result_event_id IS NULL
       OR v_existing.response_created_at IS NULL
       OR v_existing.response_event_status IS NULL THEN
      RAISE EXCEPTION 'A committed idempotency receipt is incomplete'
        USING ERRCODE = '55000';
    END IF;

    v_response := jsonb_build_object(
      'eventId', v_existing.result_event_id::text,
      'createdAt', to_char(
        v_existing.response_created_at AT TIME ZONE 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
      ),
      'eventStatus', v_existing.response_event_status
    );

    RETURN QUERY SELECT 201, v_response, true;
    RETURN;
  END IF;

  -- The Event AFTER trigger appends exactly one audit row in this transaction.
  -- If that append fails, PostgreSQL rolls back this Event and the key claim too.
  INSERT INTO public.calendar_event
  SELECT v_event.*;

  UPDATE public.event_create_request
  SET result_event_id = v_event.id,
      response_created_at = v_event.created_at,
      response_event_status = v_event.event_status
  WHERE owner_user_id = p_owner_user_id
    AND idempotency_key = p_idempotency_key;

  v_response := jsonb_build_object(
    'eventId', v_event.id::text,
    'createdAt', to_char(
      v_event.created_at AT TIME ZONE 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    ),
    'eventStatus', v_event.event_status
  );

  RETURN QUERY SELECT 201, v_response, false;
END;
$function$;

ALTER FUNCTION public.create_calendar_event_once(uuid, uuid, text, text, jsonb)
  OWNER TO postgres;

REVOKE ALL PRIVILEGES ON FUNCTION public.create_calendar_event_once(uuid, uuid, text, text, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_calendar_event_once(uuid, uuid, text, text, jsonb)
  TO service_role;
