-- Server-only, owner-scoped idempotent Event mutations.
-- Runs only in the repository-tracked migration chain / ephemeral CI until a
-- separate Human Gate authorizes hosted DDL.
--
-- Each mutation is a compare-and-swap against updated_at. The unique
-- (owner_user_id, idempotency_key) receipt makes retries replay the original
-- response. calendar_event's AFTER UPDATE trigger appends the audit row in the
-- same transaction; if that append fails, this receipt and mutation roll back.

CREATE TABLE public.event_mutation_request (
  owner_user_id uuid NOT NULL
    REFERENCES public.user_profile(id) ON DELETE RESTRICT,
  idempotency_key uuid NOT NULL,
  event_id uuid NOT NULL,
  payload_version text NOT NULL
    CHECK (payload_version = 'event-mutation-v1'),
  payload_hash bytea NOT NULL
    CHECK (octet_length(payload_hash) = 32),
  response_http_status integer,
  response_body jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,

  PRIMARY KEY (owner_user_id, idempotency_key),

  CONSTRAINT event_mutation_request_key_uuidv7_check
    CHECK (
      (get_byte(uuid_send(idempotency_key), 6) >> 4) = 7
      AND (get_byte(uuid_send(idempotency_key), 8) & 192) = 128
    ),
  CONSTRAINT event_mutation_request_event_uuidv7_check
    CHECK (
      (get_byte(uuid_send(event_id), 6) >> 4) = 7
      AND (get_byte(uuid_send(event_id), 8) & 192) = 128
    ),
  CONSTRAINT event_mutation_request_response_complete_check
    CHECK (
      (response_http_status IS NULL AND response_body IS NULL AND completed_at IS NULL)
      OR
      (response_http_status IN (200, 404, 409)
        AND response_body IS NOT NULL
        AND completed_at IS NOT NULL)
    )
);

ALTER TABLE public.event_mutation_request ENABLE ROW LEVEL SECURITY;

REVOKE ALL PRIVILEGES ON TABLE public.event_mutation_request
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.event_mutation_request TO service_role;

COMMENT ON TABLE public.event_mutation_request IS
  'Server-only idempotency receipts for owner-scoped Event edit/status/lifecycle mutations. No browser/API-user grants.';

CREATE OR REPLACE FUNCTION public.mutate_calendar_event_once(
  p_owner_user_id uuid,
  p_event_id uuid,
  p_idempotency_key uuid,
  p_payload_version text,
  p_payload_hash_hex text,
  p_expected_updated_at timestamptz,
  p_mutation text,
  p_event_patch jsonb,
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
  v_event public.calendar_event%ROWTYPE;
  v_next public.calendar_event%ROWTYPE;
  v_existing public.event_mutation_request%ROWTYPE;
  v_claimed_rows integer;
  v_payload_hash bytea;
  v_status integer;
  v_response jsonb;
  v_lifecycle text;
BEGIN
  IF current_user <> 'service_role' THEN
    RAISE EXCEPTION 'mutate_calendar_event_once requires service_role'
      USING ERRCODE = '42501';
  END IF;

  IF p_owner_user_id IS NULL OR p_event_id IS NULL OR p_expected_updated_at IS NULL OR p_now IS NULL THEN
    RAISE EXCEPTION 'Verified owner, Event, expected version and server timestamp are required'
      USING ERRCODE = '22023';
  END IF;

  IF (get_byte(uuid_send(p_event_id), 6) >> 4) <> 7
     OR (get_byte(uuid_send(p_event_id), 8) & 192) <> 128
     OR p_idempotency_key IS NULL
     OR (get_byte(uuid_send(p_idempotency_key), 6) >> 4) <> 7
     OR (get_byte(uuid_send(p_idempotency_key), 8) & 192) <> 128 THEN
    RAISE EXCEPTION 'Event id and Idempotency-Key must be valid UUIDv7 values'
      USING ERRCODE = '22023';
  END IF;

  IF p_payload_version IS DISTINCT FROM 'event-mutation-v1' THEN
    RAISE EXCEPTION 'Unsupported Event mutation payload version'
      USING ERRCODE = '22023';
  END IF;

  IF p_payload_hash_hex IS NULL OR p_payload_hash_hex !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Payload hash must be 64 lowercase SHA-256 hexadecimal characters'
      USING ERRCODE = '22023';
  END IF;
  v_payload_hash := decode(p_payload_hash_hex, 'hex');

  IF p_mutation NOT IN ('edit', 'cancel', 'reopen', 'archive', 'restore', 'trash') THEN
    RAISE EXCEPTION 'Unsupported Event mutation'
      USING ERRCODE = '22023';
  END IF;

  IF p_mutation = 'edit' THEN
    IF p_event_patch IS NULL OR jsonb_typeof(p_event_patch) <> 'object'
       OR (SELECT count(*) FROM jsonb_object_keys(p_event_patch)) <> 16
       OR EXISTS (
         SELECT 1
         FROM jsonb_object_keys(p_event_patch) AS supplied(key)
         WHERE supplied.key <> ALL (ARRAY[
           'title',
           'description',
           'location_label',
           'location_kind',
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
           'end_gap_strategy'
         ]::text[])
       ) THEN
      RAISE EXCEPTION 'Event edit patch must contain exactly the 16 editable fields'
        USING ERRCODE = '22023';
    END IF;
  ELSIF p_event_patch IS DISTINCT FROM '{}'::jsonb THEN
    RAISE EXCEPTION 'Only Event edit may contain an Event patch'
      USING ERRCODE = '22023';
  END IF;

  -- Claim owner/key before reading or mutating the Event. Concurrent retries
  -- wait at the primary key and replay the committed response.
  INSERT INTO public.event_mutation_request (
    owner_user_id,
    idempotency_key,
    event_id,
    payload_version,
    payload_hash
  ) VALUES (
    p_owner_user_id,
    p_idempotency_key,
    p_event_id,
    p_payload_version,
    v_payload_hash
  )
  ON CONFLICT (owner_user_id, idempotency_key) DO NOTHING;

  GET DIAGNOSTICS v_claimed_rows = ROW_COUNT;

  IF v_claimed_rows = 0 THEN
    SELECT *
      INTO v_existing
    FROM public.event_mutation_request
    WHERE owner_user_id = p_owner_user_id
      AND idempotency_key = p_idempotency_key
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Concurrent Event mutation claim was not visible; retry the same key'
        USING ERRCODE = '40001';
    END IF;

    IF v_existing.event_id IS DISTINCT FROM p_event_id
       OR v_existing.payload_version IS DISTINCT FROM p_payload_version
       OR v_existing.payload_hash IS DISTINCT FROM v_payload_hash THEN
      RETURN QUERY SELECT 409, jsonb_build_object('error', 'IDEMPOTENCY_KEY_REUSED'), false;
      RETURN;
    END IF;

    IF v_existing.response_http_status IS NULL OR v_existing.response_body IS NULL THEN
      RAISE EXCEPTION 'A committed Event mutation receipt is incomplete'
        USING ERRCODE = '55000';
    END IF;

    RETURN QUERY SELECT v_existing.response_http_status, v_existing.response_body, true;
    RETURN;
  END IF;

  SELECT *
    INTO v_event
  FROM public.calendar_event
  WHERE id = p_event_id
    AND owner_user_id = p_owner_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    v_status := 404;
    v_response := jsonb_build_object('error', 'EVENT_NOT_FOUND');
  ELSIF v_event.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    v_status := 409;
    v_response := jsonb_build_object(
      'error', 'EVENT_VERSION_CONFLICT',
      'currentUpdatedAt', v_event.updated_at
    );
  ELSE
    v_lifecycle := CASE
      WHEN v_event.deleted_at IS NOT NULL THEN 'trash'
      WHEN v_event.archived_at IS NOT NULL THEN 'archived'
      ELSE 'active'
    END;

    CASE p_mutation
      WHEN 'edit' THEN
        IF v_lifecycle <> 'active'
           OR v_event.event_status IN ('cancelled', 'finished') THEN
          v_status := 409;
          v_response := jsonb_build_object('error', 'EVENT_NOT_EDITABLE');
        ELSE
          v_next := jsonb_populate_record(v_event, p_event_patch);

          UPDATE public.calendar_event
          SET title = v_next.title,
              description = v_next.description,
              location_label = v_next.location_label,
              location_kind = v_next.location_kind,
              temporal_kind = v_next.temporal_kind,
              start_date = v_next.start_date,
              end_date_exclusive = v_next.end_date_exclusive,
              start_local = v_next.start_local,
              end_local = v_next.end_local,
              time_zone = v_next.time_zone,
              starts_at = v_next.starts_at,
              ends_at = v_next.ends_at,
              start_disambiguation = v_next.start_disambiguation,
              end_disambiguation = v_next.end_disambiguation,
              start_gap_strategy = v_next.start_gap_strategy,
              end_gap_strategy = v_next.end_gap_strategy
          WHERE id = p_event_id
            AND owner_user_id = p_owner_user_id;

          v_status := 200;
        END IF;

      WHEN 'cancel' THEN
        IF v_lifecycle = 'trash' OR v_event.event_status IN ('cancelled', 'finished') THEN
          v_status := 409;
          v_response := jsonb_build_object('error', 'EVENT_CANNOT_BE_CANCELLED');
        ELSE
          UPDATE public.calendar_event
          SET event_status = 'cancelled'
          WHERE id = p_event_id AND owner_user_id = p_owner_user_id;
          v_status := 200;
        END IF;

      WHEN 'reopen' THEN
        IF v_lifecycle <> 'active' OR v_event.event_status <> 'cancelled' THEN
          v_status := 409;
          v_response := jsonb_build_object('error', 'EVENT_CANNOT_BE_REOPENED');
        ELSE
          UPDATE public.calendar_event
          SET event_status = 'confirmed'
          WHERE id = p_event_id AND owner_user_id = p_owner_user_id;
          v_status := 200;
        END IF;

      WHEN 'archive' THEN
        IF v_lifecycle <> 'active' THEN
          v_status := 409;
          v_response := jsonb_build_object('error', 'EVENT_CANNOT_BE_ARCHIVED');
        ELSE
          UPDATE public.calendar_event
          SET archived_at = p_now
          WHERE id = p_event_id AND owner_user_id = p_owner_user_id;
          v_status := 200;
        END IF;

      WHEN 'restore' THEN
        IF v_event.deleted_at IS NOT NULL AND v_event.purge_after > p_now THEN
          UPDATE public.calendar_event
          SET deleted_at = NULL,
              purge_after = NULL
          WHERE id = p_event_id AND owner_user_id = p_owner_user_id;
          v_status := 200;
        ELSIF v_event.deleted_at IS NULL AND v_event.archived_at IS NOT NULL THEN
          UPDATE public.calendar_event
          SET archived_at = NULL
          WHERE id = p_event_id AND owner_user_id = p_owner_user_id;
          v_status := 200;
        ELSE
          v_status := 409;
          v_response := jsonb_build_object('error', 'EVENT_NOT_RESTORABLE');
        END IF;

      WHEN 'trash' THEN
        IF v_event.deleted_at IS NOT NULL THEN
          v_status := 409;
          v_response := jsonb_build_object('error', 'EVENT_ALREADY_IN_TRASH');
        ELSE
          UPDATE public.calendar_event
          SET archived_at = NULL,
              deleted_at = p_now,
              purge_after = p_now + interval '30 days'
          WHERE id = p_event_id AND owner_user_id = p_owner_user_id;
          v_status := 200;
        END IF;
    END CASE;

    IF v_status = 200 THEN
      SELECT *
        INTO v_event
      FROM public.calendar_event
      WHERE id = p_event_id
        AND owner_user_id = p_owner_user_id;

      v_lifecycle := CASE
        WHEN v_event.deleted_at IS NOT NULL THEN 'trash'
        WHEN v_event.archived_at IS NOT NULL THEN 'archived'
        ELSE 'active'
      END;

      v_response := jsonb_build_object(
        'eventId', v_event.id::text,
        'updatedAt', to_char(
          v_event.updated_at AT TIME ZONE 'UTC',
          'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
        ),
        'eventStatus', v_event.event_status,
        'lifecycle', v_lifecycle,
        'archivedAt', v_event.archived_at,
        'deletedAt', v_event.deleted_at,
        'purgeAfter', v_event.purge_after
      );
    END IF;
  END IF;

  UPDATE public.event_mutation_request
  SET response_http_status = v_status,
      response_body = v_response,
      completed_at = p_now
  WHERE owner_user_id = p_owner_user_id
    AND idempotency_key = p_idempotency_key;

  RETURN QUERY SELECT v_status, v_response, false;
END;
$function$;

ALTER FUNCTION public.mutate_calendar_event_once(uuid, uuid, uuid, text, text, timestamptz, text, jsonb, timestamptz)
  OWNER TO postgres;

REVOKE ALL PRIVILEGES ON FUNCTION public.mutate_calendar_event_once(uuid, uuid, uuid, text, text, timestamptz, text, jsonb, timestamptz)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mutate_calendar_event_once(uuid, uuid, uuid, text, text, timestamptz, text, jsonb, timestamptz)
  TO service_role;
