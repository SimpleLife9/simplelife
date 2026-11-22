-- Owner-scoped Protected Time conflict decisions for Event create/edit.
-- This migration is exercised only in ephemeral CI; hosted DDL remains behind a Human Gate.

ALTER TABLE public.calendar_event
  ADD COLUMN protected_time_decisions jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD CONSTRAINT calendar_event_protected_time_decisions_check
    CHECK (
      CASE
        WHEN jsonb_typeof(protected_time_decisions) = 'array'
          THEN jsonb_array_length(protected_time_decisions) <= 500
        ELSE false
      END
    );

COMMENT ON COLUMN public.calendar_event.protected_time_decisions IS
  'Per-occurrence, user-confirmed hard override/flexible overlap decisions. Also appended to audit_event transactionally.';

CREATE OR REPLACE FUNCTION private.append_calendar_event_protected_time_decision_audit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
BEGIN
  IF NEW.owner_user_id IS NULL
     OR NEW.updated_by_user_id IS NULL
     OR NEW.owner_user_id <> NEW.updated_by_user_id THEN
    RAISE EXCEPTION 'Protected Time decision audit requires matching Event owner and actor';
  END IF;

  IF jsonb_typeof(NEW.protected_time_decisions) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Protected Time decision evidence must be a JSON array';
  END IF;
  IF jsonb_array_length(NEW.protected_time_decisions) > 500 THEN
    RAISE EXCEPTION 'Protected Time decision evidence cannot exceed 500 entries';
  END IF;

  IF jsonb_array_length(NEW.protected_time_decisions) = 0 THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.protected_time_decisions IS NOT DISTINCT FROM OLD.protected_time_decisions THEN
      RETURN NEW;
    END IF;
  ELSIF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'Unsupported Protected Time decision audit operation: %', TG_OP;
  END IF;

  INSERT INTO public.audit_event (
    id, account_user_id, actor_user_id, action, entity_type, entity_id,
    result, source, details, occurred_at, recorded_at
  ) VALUES (
    private.uuidv7(), NEW.owner_user_id, NEW.updated_by_user_id,
    'calendar_event.protected_time_decisions_recorded', 'calendar_event', NEW.id,
    'success', 'user',
    jsonb_build_object(
      'decision_version', 'protected-time-decision-v1',
      'decisions', NEW.protected_time_decisions
    ),
    clock_timestamp(), clock_timestamp()
  );
  RETURN NEW;
END;
$function$;

ALTER FUNCTION private.append_calendar_event_protected_time_decision_audit() OWNER TO postgres;
REVOKE ALL PRIVILEGES ON FUNCTION private.append_calendar_event_protected_time_decision_audit()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS calendar_event_protected_time_decision_audit ON public.calendar_event;
CREATE TRIGGER calendar_event_protected_time_decision_audit
  AFTER INSERT OR UPDATE ON public.calendar_event
  FOR EACH ROW EXECUTE FUNCTION private.append_calendar_event_protected_time_decision_audit();


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
  IF (SELECT count(*) FROM jsonb_object_keys(p_event_record)) <> 28
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
         'updated_at',
         'protected_time_decisions',
         'protected_time_snapshot'
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
     OR v_event.event_status IS NULL
     OR v_event.event_status NOT IN ('preparing', 'proposed', 'confirmed')
     OR v_event.archived_at IS NOT NULL
     OR v_event.deleted_at IS NOT NULL
     OR v_event.purge_after IS NOT NULL
     OR v_event.id = p_idempotency_key THEN
    RAISE EXCEPTION 'Serialized Event identity does not match the trusted owner or idempotency key'
      USING ERRCODE = '22023';
  END IF;

  IF jsonb_typeof(p_event_record->'protected_time_decisions') IS DISTINCT FROM 'array'
     OR jsonb_typeof(p_event_record->'protected_time_snapshot') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Protected Time decisions/snapshot must be JSON arrays'
      USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(p_event_record->'protected_time_decisions') > 500
     OR jsonb_array_length(p_event_record->'protected_time_snapshot') > 500 THEN
    RAISE EXCEPTION 'Protected Time decisions/snapshot cannot exceed 500 entries'
      USING ERRCODE = '22023';
  END IF;

  -- Serialize Event writes with Protected Time mutations for this owner.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_owner_user_id::text, 8102026));

  -- Compare the complete owner block snapshot after obtaining the shared lock.
  -- A stale set means a block was created, changed, archived or deleted after
  -- conflict analysis. Return before claiming the idempotency key.
  IF EXISTS (
    SELECT 1
    FROM (
      SELECT (item->>'id')::uuid AS id, (item->>'updated_at')::timestamptz AS updated_at
      FROM jsonb_array_elements(p_event_record->'protected_time_snapshot') AS supplied(item)
    ) AS snapshot
    FULL OUTER JOIN (
      SELECT id, updated_at
      FROM public.protected_time_block
      WHERE owner_user_id = p_owner_user_id
        AND archived_at IS NULL
        AND deleted_at IS NULL
    ) AS current_blocks USING (id)
    WHERE snapshot.id IS NULL
       OR current_blocks.id IS NULL
       OR snapshot.updated_at IS DISTINCT FROM current_blocks.updated_at
  ) THEN
    RETURN QUERY SELECT 409, jsonb_build_object('error', 'PROTECTED_TIME_CONFLICTS_CHANGED'), false;
    RETURN;
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

  IF p_mutation IS NULL OR p_mutation NOT IN ('edit', 'cancel', 'reopen', 'finish', 'archive', 'restore', 'trash') THEN
    RAISE EXCEPTION 'Unsupported Event mutation'
      USING ERRCODE = '22023';
  END IF;

  IF p_mutation = 'edit' THEN
    IF p_event_patch IS NULL OR jsonb_typeof(p_event_patch) <> 'object'
       OR (SELECT count(*) FROM jsonb_object_keys(p_event_patch)) <> 18
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
           'end_gap_strategy',
           'protected_time_decisions',
           'protected_time_snapshot'
         ]::text[])
       ) THEN
      RAISE EXCEPTION 'Event edit patch must contain exactly 18 fields including Protected Time evidence'
        USING ERRCODE = '22023';
    END IF;
  ELSIF p_event_patch IS DISTINCT FROM '{}'::jsonb THEN
    RAISE EXCEPTION 'Only Event edit may contain an Event patch'
      USING ERRCODE = '22023';
  END IF;

  IF p_mutation = 'edit' THEN
    IF jsonb_typeof(p_event_patch->'protected_time_decisions') IS DISTINCT FROM 'array'
       OR jsonb_typeof(p_event_patch->'protected_time_snapshot') IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'Protected Time decisions/snapshot must be JSON arrays'
        USING ERRCODE = '22023';
    END IF;
    IF jsonb_array_length(p_event_patch->'protected_time_decisions') > 500
       OR jsonb_array_length(p_event_patch->'protected_time_snapshot') > 500 THEN
      RAISE EXCEPTION 'Protected Time decisions/snapshot cannot exceed 500 entries'
        USING ERRCODE = '22023';
    END IF;

    PERFORM pg_advisory_xact_lock(hashtextextended(p_owner_user_id::text, 8102026));
    IF EXISTS (
      SELECT 1
      FROM (
        SELECT (item->>'id')::uuid AS id, (item->>'updated_at')::timestamptz AS updated_at
        FROM jsonb_array_elements(p_event_patch->'protected_time_snapshot') AS supplied(item)
      ) AS snapshot
      FULL OUTER JOIN (
        SELECT id, updated_at
        FROM public.protected_time_block
        WHERE owner_user_id = p_owner_user_id
          AND archived_at IS NULL
          AND deleted_at IS NULL
      ) AS current_blocks USING (id)
      WHERE snapshot.id IS NULL
         OR current_blocks.id IS NULL
         OR snapshot.updated_at IS DISTINCT FROM current_blocks.updated_at
    ) THEN
      RETURN QUERY SELECT 409, jsonb_build_object('error', 'PROTECTED_TIME_CONFLICTS_CHANGED'), false;
      RETURN;
    END IF;
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
              end_gap_strategy = v_next.end_gap_strategy,
              protected_time_decisions = v_next.protected_time_decisions
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

      WHEN 'finish' THEN
        IF v_lifecycle <> 'active' OR v_event.event_status <> 'confirmed' THEN
          v_status := 409;
          v_response := jsonb_build_object('error', 'EVENT_CANNOT_BE_FINISHED');
        ELSE
          UPDATE public.calendar_event
          SET event_status = 'finished'
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

CREATE OR REPLACE FUNCTION public.mutate_protected_time_block_once(
  p_owner_user_id uuid,
  p_block_id uuid,
  p_idempotency_key uuid,
  p_payload_version text,
  p_payload_hash_hex text,
  p_expected_updated_at timestamptz,
  p_mutation text,
  p_block_patch jsonb,
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
  v_block public.protected_time_block%ROWTYPE;
  v_next public.protected_time_block%ROWTYPE;
  v_existing public.protected_time_block_mutation_request%ROWTYPE;
  v_claimed_rows integer;
  v_payload_hash bytea;
  v_status integer;
  v_response jsonb;
  v_lifecycle text;
BEGIN
  IF current_user <> 'service_role' THEN
    RAISE EXCEPTION 'mutate_protected_time_block_once requires service_role'
      USING ERRCODE = '42501';
  END IF;

  IF p_owner_user_id IS NULL OR p_block_id IS NULL OR p_idempotency_key IS NULL OR p_now IS NULL THEN
    RAISE EXCEPTION 'Verified owner, block, idempotency key and server timestamp are required'
      USING ERRCODE = '22023';
  END IF;

  IF (get_byte(uuid_send(p_block_id), 6) >> 4) <> 7
     OR (get_byte(uuid_send(p_block_id), 8) & 192) <> 128
     OR (get_byte(uuid_send(p_idempotency_key), 6) >> 4) <> 7
     OR (get_byte(uuid_send(p_idempotency_key), 8) & 192) <> 128 THEN
    RAISE EXCEPTION 'Block id and Idempotency-Key must be UUIDv7 values'
      USING ERRCODE = '22023';
  END IF;

  IF p_payload_version IS DISTINCT FROM 'protected-time-mutation-v1'
     OR p_payload_hash_hex IS NULL
     OR p_payload_hash_hex !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Protected Time mutation payload version/hash is invalid'
      USING ERRCODE = '22023';
  END IF;
  v_payload_hash := decode(p_payload_hash_hex, 'hex');

  IF p_mutation IS NULL OR p_mutation NOT IN ('create', 'edit', 'archive', 'restore', 'delete') THEN
    RAISE EXCEPTION 'Unsupported Protected Time mutation'
      USING ERRCODE = '22023';
  END IF;

  IF p_mutation IN ('create', 'edit') THEN
    IF p_block_patch IS NULL OR jsonb_typeof(p_block_patch) <> 'object'
       OR (SELECT count(*) FROM jsonb_object_keys(p_block_patch)) <> 20
       OR EXISTS (
         SELECT 1 FROM jsonb_object_keys(p_block_patch) AS supplied(key)
         WHERE supplied.key <> ALL (ARRAY[
           'label', 'category', 'protection_mode', 'pattern_kind', 'time_zone',
           'start_local', 'end_local', 'starts_at', 'ends_at',
           'start_disambiguation', 'end_disambiguation',
           'start_gap_strategy', 'end_gap_strategy',
           'start_date', 'end_date_exclusive', 'weekdays',
           'start_time_local', 'end_time_local', 'ends_next_day',
           'resolver_metadata'
         ]::text[])
       ) THEN
      RAISE EXCEPTION 'Protected Time patch must contain exactly the 20 editable fields'
        USING ERRCODE = '22023';
    END IF;
  ELSIF p_block_patch IS DISTINCT FROM '{}'::jsonb THEN
    RAISE EXCEPTION 'Only Protected Time create/edit may contain a block patch'
      USING ERRCODE = '22023';
  END IF;

  IF (p_mutation = 'create' AND p_expected_updated_at IS NOT NULL)
     OR (p_mutation <> 'create' AND p_expected_updated_at IS NULL) THEN
    RAISE EXCEPTION 'Only create omits expected_updated_at'
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.protected_time_block_mutation_request (
    owner_user_id, idempotency_key, block_id, payload_version, payload_hash
  ) VALUES (
    p_owner_user_id, p_idempotency_key, p_block_id, p_payload_version, v_payload_hash
  )
  ON CONFLICT (owner_user_id, idempotency_key) DO NOTHING;

  GET DIAGNOSTICS v_claimed_rows = ROW_COUNT;
  IF v_claimed_rows = 0 THEN
    SELECT * INTO v_existing
    FROM public.protected_time_block_mutation_request
    WHERE owner_user_id = p_owner_user_id
      AND idempotency_key = p_idempotency_key
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Concurrent Protected Time mutation claim was not visible; retry the same key'
        USING ERRCODE = '40001';
    END IF;

    IF (v_existing.block_id IS DISTINCT FROM p_block_id AND p_mutation <> 'create')
       OR v_existing.payload_version IS DISTINCT FROM p_payload_version
       OR v_existing.payload_hash IS DISTINCT FROM v_payload_hash THEN
      RETURN QUERY SELECT 409, jsonb_build_object('error', 'IDEMPOTENCY_KEY_REUSED'), false;
      RETURN;
    END IF;

    IF v_existing.response_http_status IS NULL OR v_existing.response_body IS NULL THEN
      RAISE EXCEPTION 'A committed Protected Time mutation receipt is incomplete'
        USING ERRCODE = '55000';
    END IF;

    RETURN QUERY SELECT v_existing.response_http_status, v_existing.response_body, true;
    RETURN;
  END IF;

  -- Shared owner lock serializes block writes with Event conflict analysis and commit.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_owner_user_id::text, 8102026));

  IF p_mutation = 'create' THEN
    v_next := jsonb_populate_record(NULL::public.protected_time_block, p_block_patch);
    INSERT INTO public.protected_time_block (
      id, owner_user_id, created_by_user_id, updated_by_user_id,
      label, category, protection_mode, pattern_kind, time_zone,
      start_local, end_local, starts_at, ends_at,
      start_disambiguation, end_disambiguation, start_gap_strategy, end_gap_strategy,
      start_date, end_date_exclusive, weekdays, start_time_local, end_time_local, ends_next_day,
      resolver_metadata, created_at, updated_at
    ) VALUES (
      p_block_id, p_owner_user_id, p_owner_user_id, p_owner_user_id,
      v_next.label, v_next.category, v_next.protection_mode, v_next.pattern_kind, v_next.time_zone,
      v_next.start_local, v_next.end_local, v_next.starts_at, v_next.ends_at,
      v_next.start_disambiguation, v_next.end_disambiguation, v_next.start_gap_strategy, v_next.end_gap_strategy,
      v_next.start_date, v_next.end_date_exclusive, v_next.weekdays,
      v_next.start_time_local, v_next.end_time_local, v_next.ends_next_day,
      v_next.resolver_metadata, p_now, p_now
    )
    RETURNING * INTO v_block;
    v_status := 201;

  ELSE
    SELECT * INTO v_block
    FROM public.protected_time_block
    WHERE id = p_block_id AND owner_user_id = p_owner_user_id
    FOR UPDATE;

    IF NOT FOUND THEN
      v_status := 404;
      v_response := jsonb_build_object('error', 'PROTECTED_TIME_BLOCK_NOT_FOUND');

    ELSIF v_block.updated_at IS DISTINCT FROM p_expected_updated_at THEN
      v_status := 409;
      v_response := jsonb_build_object(
        'error', 'PROTECTED_TIME_BLOCK_VERSION_CONFLICT',
        'currentUpdatedAt', to_char(v_block.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
      );

    ELSE
      v_lifecycle := CASE
        WHEN v_block.deleted_at IS NOT NULL THEN 'trash'
        WHEN v_block.archived_at IS NOT NULL THEN 'archived'
        ELSE 'active'
      END;

      CASE p_mutation
        WHEN 'edit' THEN
          IF v_lifecycle <> 'active' THEN
            v_status := 409;
            v_response := jsonb_build_object('error', 'PROTECTED_TIME_BLOCK_NOT_EDITABLE');
          ELSE
            v_next := jsonb_populate_record(v_block, p_block_patch);
            UPDATE public.protected_time_block
            SET label = v_next.label,
                category = v_next.category,
                protection_mode = v_next.protection_mode,
                pattern_kind = v_next.pattern_kind,
                time_zone = v_next.time_zone,
                start_local = v_next.start_local,
                end_local = v_next.end_local,
                starts_at = v_next.starts_at,
                ends_at = v_next.ends_at,
                start_disambiguation = v_next.start_disambiguation,
                end_disambiguation = v_next.end_disambiguation,
                start_gap_strategy = v_next.start_gap_strategy,
                end_gap_strategy = v_next.end_gap_strategy,
                start_date = v_next.start_date,
                end_date_exclusive = v_next.end_date_exclusive,
                weekdays = v_next.weekdays,
                start_time_local = v_next.start_time_local,
                end_time_local = v_next.end_time_local,
                ends_next_day = v_next.ends_next_day,
                resolver_metadata = v_next.resolver_metadata,
                updated_by_user_id = p_owner_user_id
            WHERE id = p_block_id AND owner_user_id = p_owner_user_id
            RETURNING * INTO v_block;
            v_status := 200;
          END IF;

        WHEN 'archive' THEN
          IF v_lifecycle <> 'active' THEN
            v_status := 409;
            v_response := jsonb_build_object('error', 'PROTECTED_TIME_BLOCK_NOT_ARCHIVABLE');
          ELSE
            UPDATE public.protected_time_block
            SET archived_at = p_now, updated_by_user_id = p_owner_user_id
            WHERE id = p_block_id AND owner_user_id = p_owner_user_id
            RETURNING * INTO v_block;
            v_status := 200;
          END IF;

        WHEN 'restore' THEN
          IF v_lifecycle IN ('archived', 'trash') THEN
            UPDATE public.protected_time_block
            SET archived_at = NULL, deleted_at = NULL, updated_by_user_id = p_owner_user_id
            WHERE id = p_block_id AND owner_user_id = p_owner_user_id
            RETURNING * INTO v_block;
            v_status := 200;
          ELSE
            v_status := 409;
            v_response := jsonb_build_object('error', 'PROTECTED_TIME_BLOCK_NOT_RESTORABLE');
          END IF;

        WHEN 'delete' THEN
          IF v_lifecycle = 'trash' THEN
            v_status := 409;
            v_response := jsonb_build_object('error', 'PROTECTED_TIME_BLOCK_ALREADY_DELETED');
          ELSE
            UPDATE public.protected_time_block
            SET archived_at = NULL, deleted_at = p_now, updated_by_user_id = p_owner_user_id
            WHERE id = p_block_id AND owner_user_id = p_owner_user_id
            RETURNING * INTO v_block;
            v_status := 200;
          END IF;
      END CASE;
    END IF;
  END IF;

  IF v_status IN (200, 201) THEN
    v_lifecycle := CASE
      WHEN v_block.deleted_at IS NOT NULL THEN 'trash'
      WHEN v_block.archived_at IS NOT NULL THEN 'archived'
      ELSE 'active'
    END;
    v_response := jsonb_build_object(
      'blockId', v_block.id::text,
      'updatedAt', to_char(v_block.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'label', v_block.label,
      'category', v_block.category,
      'protectionMode', v_block.protection_mode,
      'patternKind', v_block.pattern_kind,
      'timeZone', v_block.time_zone,
      'lifecycle', v_lifecycle,
      'resolverMetadata', v_block.resolver_metadata,
      'oneOff', CASE WHEN v_block.pattern_kind = 'one_off' THEN jsonb_build_object(
        'startLocalDateTime', v_block.start_local,
        'endLocalDateTime', v_block.end_local,
        'startsAt', v_block.starts_at,
        'endsAt', v_block.ends_at,
        'startDisambiguation', v_block.start_disambiguation,
        'endDisambiguation', v_block.end_disambiguation
      ) ELSE NULL END,
      'weekly', CASE WHEN v_block.pattern_kind = 'weekly' THEN jsonb_build_object(
        'startDate', v_block.start_date,
        'endDateExclusive', v_block.end_date_exclusive,
        'weekdays', to_jsonb(v_block.weekdays),
        'startLocalTime', v_block.start_time_local,
        'endLocalTime', v_block.end_time_local,
        'endsNextDay', v_block.ends_next_day
      ) ELSE NULL END
    );
  END IF;

  UPDATE public.protected_time_block_mutation_request
  SET response_http_status = v_status,
      response_body = v_response,
      completed_at = p_now
  WHERE owner_user_id = p_owner_user_id
    AND idempotency_key = p_idempotency_key;

  RETURN QUERY SELECT v_status, v_response, false;
END;
$function$;

ALTER FUNCTION public.mutate_protected_time_block_once(uuid, uuid, uuid, text, text, timestamptz, text, jsonb, timestamptz)
  OWNER TO postgres;

REVOKE ALL PRIVILEGES ON FUNCTION public.mutate_protected_time_block_once(uuid, uuid, uuid, text, text, timestamptz, text, jsonb, timestamptz)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mutate_protected_time_block_once(uuid, uuid, uuid, text, text, timestamptz, text, jsonb, timestamptz)
  TO service_role;
