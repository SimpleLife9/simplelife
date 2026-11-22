-- Atomic create idempotency for one-off Agenda Events.
-- Source-only until a separately approved hosted Supabase Human Gate.
-- Apply only in ephemeral/local Postgres after the Event/Audit migration.

CREATE TABLE private.calendar_event_idempotency (
  owner_user_id uuid NOT NULL,
  idempotency_key uuid NOT NULL,
  request_hash text NOT NULL,
  event_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),

  CONSTRAINT calendar_event_idempotency_owner_key_pk
    PRIMARY KEY (owner_user_id, idempotency_key),
  CONSTRAINT calendar_event_idempotency_key_uuidv4_check
    CHECK (
      (get_byte(uuid_send(idempotency_key), 6) >> 4) = 4
      AND (get_byte(uuid_send(idempotency_key), 8) & 192) = 128
    ),
  CONSTRAINT calendar_event_idempotency_hash_sha256_check
    CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT calendar_event_idempotency_event_owner_fk
    FOREIGN KEY (event_id, owner_user_id)
    REFERENCES public.calendar_event (id, owner_user_id)
    ON DELETE RESTRICT
    DEFERRABLE INITIALLY DEFERRED
);

ALTER TABLE private.calendar_event_idempotency OWNER TO postgres;
REVOKE ALL PRIVILEGES ON TABLE private.calendar_event_idempotency
  FROM PUBLIC, anon, authenticated, service_role;

-- All Event creates must pass through the atomic reservation + insert function.
-- The backend keeps SELECT/UPDATE for its trusted read/update path.
REVOKE INSERT ON TABLE public.calendar_event FROM service_role;

CREATE OR REPLACE FUNCTION public.create_calendar_event_idempotent(
  p_owner_user_id uuid,
  p_idempotency_key uuid,
  p_request_hash text,
  p_event_record jsonb
)
RETURNS TABLE (
  outcome text,
  resolved_event_id uuid,
  event_created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_key_bytes bytea;
  v_event_id uuid;
  v_existing_hash text;
  v_existing_event_id uuid;
  v_created_at timestamptz;
  v_allowed_keys text[] := ARRAY[
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
  ];
BEGIN
  IF p_owner_user_id IS NULL OR p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'Owner and idempotency key are required'
      USING ERRCODE = '22023';
  END IF;

  v_key_bytes := uuid_send(p_idempotency_key);
  IF (get_byte(v_key_bytes, 6) >> 4) <> 4
     OR (get_byte(v_key_bytes, 8) & 192) <> 128 THEN
    RAISE EXCEPTION 'Idempotency key must be a UUIDv4'
      USING ERRCODE = '22023';
  END IF;

  IF p_request_hash IS NULL OR p_request_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Request hash must be a lowercase SHA-256 hex digest'
      USING ERRCODE = '22023';
  END IF;

  IF p_event_record IS NULL OR jsonb_typeof(p_event_record) <> 'object' THEN
    RAISE EXCEPTION 'Event record must be a JSON object'
      USING ERRCODE = '22023';
  END IF;

  IF NOT (p_event_record ?& v_allowed_keys) THEN
    RAISE EXCEPTION 'Event record is missing required persistence fields'
      USING ERRCODE = '22023';
  END IF;

  IF (p_event_record - v_allowed_keys) <> '{}'::jsonb THEN
    RAISE EXCEPTION 'Event record contains unsupported fields'
      USING ERRCODE = '22023';
  END IF;

  IF (p_event_record ->> 'owner_user_id') IS DISTINCT FROM p_owner_user_id::text
     OR (p_event_record ->> 'created_by_user_id') IS DISTINCT FROM p_owner_user_id::text
     OR (p_event_record ->> 'updated_by_user_id') IS DISTINCT FROM p_owner_user_id::text THEN
    RAISE EXCEPTION 'Event owner/actor fields must match the verified owner'
      USING ERRCODE = '42501';
  END IF;

  v_event_id := (p_event_record ->> 'id')::uuid;

  -- Reserve the owner-scoped key first. The deferred FK permits the Event to
  -- be inserted later in this same transaction. Concurrent retries wait on
  -- the unique key and observe either the committed reservation or its rollback.
  INSERT INTO private.calendar_event_idempotency (
    owner_user_id,
    idempotency_key,
    request_hash,
    event_id
  )
  VALUES (
    p_owner_user_id,
    p_idempotency_key,
    p_request_hash,
    v_event_id
  )
  ON CONFLICT (owner_user_id, idempotency_key) DO NOTHING;

  IF NOT FOUND THEN
    SELECT reservation.request_hash, reservation.event_id
      INTO v_existing_hash, v_existing_event_id
    FROM private.calendar_event_idempotency AS reservation
    WHERE reservation.owner_user_id = p_owner_user_id
      AND reservation.idempotency_key = p_idempotency_key
    FOR UPDATE;

    IF v_existing_hash IS DISTINCT FROM p_request_hash THEN
      RETURN QUERY SELECT 'conflict'::text, NULL::uuid, NULL::timestamptz;
      RETURN;
    END IF;

    SELECT event.created_at
      INTO v_created_at
    FROM public.calendar_event AS event
    WHERE event.id = v_existing_event_id
      AND event.owner_user_id = p_owner_user_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Committed idempotency reservation has no Event'
        USING ERRCODE = '23503';
    END IF;

    RETURN QUERY SELECT 'replayed'::text, v_existing_event_id, v_created_at;
    RETURN;
  END IF;

  INSERT INTO public.calendar_event
  SELECT (jsonb_populate_record(NULL::public.calendar_event, p_event_record)).*;

  SELECT event.created_at
    INTO v_created_at
  FROM public.calendar_event AS event
  WHERE event.id = v_event_id
    AND event.owner_user_id = p_owner_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'New Event row could not be read back after insertion'
      USING ERRCODE = '23503';
  END IF;

  RETURN QUERY SELECT 'created'::text, v_event_id, v_created_at;
END;
$function$;

ALTER FUNCTION public.create_calendar_event_idempotent(uuid, uuid, text, jsonb)
  OWNER TO postgres;

REVOKE ALL PRIVILEGES
  ON FUNCTION public.create_calendar_event_idempotent(uuid, uuid, text, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE
  ON FUNCTION public.create_calendar_event_idempotent(uuid, uuid, text, jsonb)
  TO service_role;

COMMENT ON FUNCTION public.create_calendar_event_idempotent(uuid, uuid, text, jsonb)
  IS 'Server-only atomic Event create reservation. Caller must authenticate and resolve owner before invoking; same owner/key/hash replays the original Event ID; same owner/key with a different hash returns conflict.';
