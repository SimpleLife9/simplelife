-- Serialize owner-scoped Event writes with Protected Time mutations.
-- Consent is a one-operation decision, bound to the Event idempotency hash and
-- to the exact Protected Time row versions the user reviewed.
-- CI applies this migration only to its disposable local Supabase stack.

CREATE OR REPLACE FUNCTION private.lock_protected_time_owner()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $function$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.owner_user_id IS DISTINCT FROM OLD.owner_user_id THEN
    RAISE EXCEPTION 'Protected Time ownership is immutable'
      USING ERRCODE = '42501';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('simplelife:protected-time-owner:' || NEW.owner_user_id::text, 0)
  );
  RETURN NEW;
END;
$function$;

ALTER FUNCTION private.lock_protected_time_owner() OWNER TO postgres;
REVOKE ALL PRIVILEGES ON FUNCTION private.lock_protected_time_owner()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS protected_time_owner_write_lock ON public.protected_time_block;
CREATE TRIGGER protected_time_owner_write_lock
  BEFORE INSERT OR UPDATE ON public.protected_time_block
  FOR EACH ROW EXECUTE FUNCTION private.lock_protected_time_owner();

GRANT USAGE ON SCHEMA private TO service_role;

CREATE OR REPLACE FUNCTION private.append_calendar_event_protected_time_decisions(
  p_owner_user_id uuid,
  p_event_id uuid,
  p_idempotency_key uuid,
  p_operation text,
  p_conflict_decisions jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_decision record;
  v_action text;
BEGIN
  IF p_owner_user_id IS NULL OR p_event_id IS NULL OR p_idempotency_key IS NULL
     OR p_operation NOT IN ('create', 'edit')
     OR jsonb_typeof(p_conflict_decisions) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Protected Time decision audit input is invalid'
      USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.calendar_event AS e
    WHERE e.id = p_event_id
      AND e.owner_user_id = p_owner_user_id
  ) THEN
    RAISE EXCEPTION 'The audited Event is not owned by the verified profile'
      USING ERRCODE = '42501';
  END IF;

  FOR v_decision IN
    SELECT *
    FROM jsonb_to_recordset(p_conflict_decisions) AS d(
      "blockId" uuid,
      "blockUpdatedAt" timestamptz,
      "protectionMode" text,
      decision text
    )
    ORDER BY "blockId"
  LOOP
    IF v_decision."blockId" IS NULL
       OR v_decision."blockUpdatedAt" IS NULL
       OR NOT (
         (v_decision."protectionMode" = 'hard' AND v_decision.decision = 'override')
         OR (v_decision."protectionMode" = 'flexible' AND v_decision.decision = 'keep')
       ) THEN
      RAISE EXCEPTION 'Protected Time consent decision is invalid'
        USING ERRCODE = '22023';
    END IF;

    v_action := CASE v_decision."protectionMode"
      WHEN 'hard' THEN 'calendar_event.protected_time_hard_override'
      ELSE 'calendar_event.protected_time_flexible_overlap_kept'
    END;

    INSERT INTO public.audit_event (
      id, account_user_id, actor_user_id, action, entity_type, entity_id,
      result, source, details, occurred_at, recorded_at
    ) VALUES (
      private.uuidv7(), p_owner_user_id, p_owner_user_id, v_action,
      'calendar_event', p_event_id, 'success', 'user',
      jsonb_build_object(
        'protected_time_block_id', v_decision."blockId",
        'protected_time_block_updated_at', v_decision."blockUpdatedAt",
        'protection_mode', v_decision."protectionMode",
        'decision', v_decision.decision,
        'event_operation', p_operation,
        'idempotency_key', p_idempotency_key
      ),
      clock_timestamp(), clock_timestamp()
    );
  END LOOP;
END;
$function$;

ALTER FUNCTION private.append_calendar_event_protected_time_decisions(uuid, uuid, uuid, text, jsonb)
  OWNER TO postgres;
REVOKE ALL PRIVILEGES ON FUNCTION private.append_calendar_event_protected_time_decisions(uuid, uuid, uuid, text, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.append_calendar_event_protected_time_decisions(uuid, uuid, uuid, text, jsonb)
  TO service_role;

CREATE OR REPLACE FUNCTION private.protected_time_snapshot_matches(
  p_owner_user_id uuid,
  p_snapshot jsonb
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_count integer;
  v_unique_count integer;
  v_matches boolean;
BEGIN
  IF p_snapshot IS NULL OR jsonb_typeof(p_snapshot) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Protected Time snapshot must be a JSON array'
      USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_snapshot) AS item(value)
    WHERE jsonb_typeof(item.value) IS DISTINCT FROM 'object'
       OR jsonb_object_length(item.value) <> 2
       OR NOT (item.value ? 'id' AND item.value ? 'updatedAt')
  ) THEN
    RAISE EXCEPTION 'Protected Time snapshot contains an invalid row'
      USING ERRCODE = '22023';
  END IF;

  SELECT count(*), count(DISTINCT supplied.id)
    INTO v_count, v_unique_count
  FROM jsonb_to_recordset(p_snapshot) AS supplied(
    id uuid,
    "updatedAt" timestamptz
  )
  WHERE supplied.id IS NOT NULL
    AND supplied."updatedAt" IS NOT NULL;

  IF v_count <> jsonb_array_length(p_snapshot)
     OR v_count <> v_unique_count
     OR v_count > 500 THEN
    RAISE EXCEPTION 'Protected Time snapshot has missing, duplicate or excessive rows'
      USING ERRCODE = '22023';
  END IF;

  WITH supplied AS MATERIALIZED (
    SELECT id, "updatedAt" AS updated_at
    FROM jsonb_to_recordset(p_snapshot) AS row_data(
      id uuid,
      "updatedAt" timestamptz
    )
  ),
  current_blocks AS MATERIALIZED (
    SELECT block.id, block.updated_at
    FROM public.protected_time_block AS block
    WHERE block.owner_user_id = p_owner_user_id
      AND block.archived_at IS NULL
      AND block.deleted_at IS NULL
  )
  SELECT
    NOT EXISTS (
      SELECT id, updated_at FROM current_blocks
      EXCEPT
      SELECT id, updated_at FROM supplied
    )
    AND NOT EXISTS (
      SELECT id, updated_at FROM supplied
      EXCEPT
      SELECT id, updated_at FROM current_blocks
    )
    INTO v_matches;

  RETURN coalesce(v_matches, false);
END;
$function$;

ALTER FUNCTION private.protected_time_snapshot_matches(uuid, jsonb) OWNER TO postgres;
REVOKE ALL PRIVILEGES ON FUNCTION private.protected_time_snapshot_matches(uuid, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.protected_time_snapshot_matches(uuid, jsonb)
  TO service_role;

CREATE OR REPLACE FUNCTION private.protected_time_decisions_are_current(
  p_owner_user_id uuid,
  p_decisions jsonb
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_count integer;
  v_unique_count integer;
  v_valid boolean;
BEGIN
  IF p_decisions IS NULL OR jsonb_typeof(p_decisions) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Protected Time conflict decisions must be a JSON array'
      USING ERRCODE = '22023';
  END IF;

  IF jsonb_array_length(p_decisions) > 50 OR EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_decisions) AS item(value)
    WHERE jsonb_typeof(item.value) IS DISTINCT FROM 'object'
       OR jsonb_object_length(item.value) <> 4
       OR NOT (
         item.value ? 'blockId'
         AND item.value ? 'blockUpdatedAt'
         AND item.value ? 'protectionMode'
         AND item.value ? 'decision'
       )
  ) THEN
    RAISE EXCEPTION 'Protected Time conflict decisions contain invalid rows'
      USING ERRCODE = '22023';
  END IF;

  SELECT count(*), count(DISTINCT decision."blockId")
    INTO v_count, v_unique_count
  FROM jsonb_to_recordset(p_decisions) AS decision(
    "blockId" uuid,
    "blockUpdatedAt" timestamptz,
    "protectionMode" text,
    decision text
  )
  WHERE decision."blockId" IS NOT NULL
    AND decision."blockUpdatedAt" IS NOT NULL;

  IF v_count <> jsonb_array_length(p_decisions)
     OR v_count <> v_unique_count THEN
    RAISE EXCEPTION 'Protected Time conflict decisions contain duplicate or missing identities'
      USING ERRCODE = '22023';
  END IF;

  SELECT NOT EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(p_decisions) AS decision(
      "blockId" uuid,
      "blockUpdatedAt" timestamptz,
      "protectionMode" text,
      decision text
    )
    LEFT JOIN public.protected_time_block AS block
      ON block.id = decision."blockId"
     AND block.owner_user_id = p_owner_user_id
     AND block.archived_at IS NULL
     AND block.deleted_at IS NULL
    WHERE block.id IS NULL
       OR block.updated_at IS DISTINCT FROM decision."blockUpdatedAt"
       OR block.protection_mode IS DISTINCT FROM decision."protectionMode"
       OR NOT (
         (block.protection_mode = 'hard' AND decision.decision = 'override')
         OR (block.protection_mode = 'flexible' AND decision.decision = 'keep')
       )
  ) INTO v_valid;

  RETURN coalesce(v_valid, false);
END;
$function$;

ALTER FUNCTION private.protected_time_decisions_are_current(uuid, jsonb) OWNER TO postgres;
REVOKE ALL PRIVILEGES ON FUNCTION private.protected_time_decisions_are_current(uuid, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.protected_time_decisions_are_current(uuid, jsonb)
  TO service_role;

CREATE OR REPLACE FUNCTION public.create_calendar_event_with_protected_time_once(
  p_owner_user_id uuid,
  p_idempotency_key uuid,
  p_payload_version text,
  p_payload_hash_hex text,
  p_event_record jsonb,
  p_protected_time_snapshot jsonb,
  p_conflict_decisions jsonb
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
  v_existing public.event_create_request%ROWTYPE;
  v_result record;
  v_event_id uuid;
BEGIN
  IF current_user <> 'service_role' THEN
    RAISE EXCEPTION 'create_calendar_event_with_protected_time_once requires service_role'
      USING ERRCODE = '42501';
  END IF;
  IF p_owner_user_id IS NULL OR p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'Verified owner and idempotency key are required'
      USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('simplelife:protected-time-owner:' || p_owner_user_id::text, 0)
  );

  -- Replays are returned before inspecting current Protected Time state.
  SELECT * INTO v_existing
  FROM public.event_create_request
  WHERE owner_user_id = p_owner_user_id
    AND idempotency_key = p_idempotency_key
  FOR UPDATE;

  IF FOUND THEN
    IF v_existing.payload_version IS DISTINCT FROM p_payload_version
       OR encode(v_existing.payload_hash, 'hex') IS DISTINCT FROM p_payload_hash_hex THEN
      RETURN QUERY SELECT 409, jsonb_build_object('error', 'IDEMPOTENCY_KEY_REUSED'), false;
      RETURN;
    END IF;
    IF v_existing.result_event_id IS NULL
       OR v_existing.response_created_at IS NULL
       OR v_existing.response_event_status IS NULL THEN
      RAISE EXCEPTION 'A committed Event create receipt is incomplete'
        USING ERRCODE = '55000';
    END IF;
    RETURN QUERY SELECT 201,
      jsonb_build_object(
        'eventId', v_existing.result_event_id::text,
        'createdAt', to_char(v_existing.response_created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'eventStatus', v_existing.response_event_status
      ),
      true;
    RETURN;
  END IF;

  IF NOT private.protected_time_snapshot_matches(p_owner_user_id, p_protected_time_snapshot) THEN
    RETURN QUERY SELECT 409, jsonb_build_object('error', 'PROTECTED_TIME_STATE_CHANGED'), false;
    RETURN;
  END IF;
  IF NOT private.protected_time_decisions_are_current(p_owner_user_id, p_conflict_decisions) THEN
    RETURN QUERY SELECT 409, jsonb_build_object('error', 'PROTECTED_TIME_STATE_CHANGED'), false;
    RETURN;
  END IF;

  SELECT * INTO v_result
  FROM public.create_calendar_event_once(
    p_owner_user_id,
    p_idempotency_key,
    p_payload_version,
    p_payload_hash_hex,
    p_event_record
  );

  IF v_result.http_status = 201 AND v_result.replayed IS NOT TRUE
     AND jsonb_array_length(p_conflict_decisions) > 0 THEN
    v_event_id := (v_result.response_body ->> 'eventId')::uuid;
    PERFORM private.append_calendar_event_protected_time_decisions(
      p_owner_user_id, v_event_id, p_idempotency_key, 'create', p_conflict_decisions
    );
  END IF;

  RETURN QUERY SELECT v_result.http_status, v_result.response_body, v_result.replayed;
END;
$function$;

ALTER FUNCTION public.create_calendar_event_with_protected_time_once(uuid, uuid, text, text, jsonb, jsonb, jsonb)
  OWNER TO postgres;
REVOKE ALL PRIVILEGES ON FUNCTION public.create_calendar_event_with_protected_time_once(uuid, uuid, text, text, jsonb, jsonb, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_calendar_event_with_protected_time_once(uuid, uuid, text, text, jsonb, jsonb, jsonb)
  TO service_role;

CREATE OR REPLACE FUNCTION public.mutate_calendar_event_with_protected_time_once(
  p_owner_user_id uuid,
  p_event_id uuid,
  p_idempotency_key uuid,
  p_payload_version text,
  p_payload_hash_hex text,
  p_expected_updated_at timestamptz,
  p_mutation text,
  p_event_patch jsonb,
  p_now timestamptz,
  p_protected_time_snapshot jsonb,
  p_conflict_decisions jsonb
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
  v_existing public.event_mutation_request%ROWTYPE;
  v_result record;
BEGIN
  IF current_user <> 'service_role' THEN
    RAISE EXCEPTION 'mutate_calendar_event_with_protected_time_once requires service_role'
      USING ERRCODE = '42501';
  END IF;
  IF p_owner_user_id IS NULL OR p_event_id IS NULL OR p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'Verified owner, Event and idempotency key are required'
      USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('simplelife:protected-time-owner:' || p_owner_user_id::text, 0)
  );

  -- Exact mutation retries replay regardless of later changes to Protected Time.
  SELECT * INTO v_existing
  FROM public.event_mutation_request
  WHERE owner_user_id = p_owner_user_id
    AND idempotency_key = p_idempotency_key
  FOR UPDATE;

  IF FOUND THEN
    IF v_existing.event_id IS DISTINCT FROM p_event_id
       OR v_existing.payload_version IS DISTINCT FROM p_payload_version
       OR encode(v_existing.payload_hash, 'hex') IS DISTINCT FROM p_payload_hash_hex THEN
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

  IF NOT private.protected_time_snapshot_matches(p_owner_user_id, p_protected_time_snapshot) THEN
    RETURN QUERY SELECT 409, jsonb_build_object('error', 'PROTECTED_TIME_STATE_CHANGED'), false;
    RETURN;
  END IF;
  IF NOT private.protected_time_decisions_are_current(p_owner_user_id, p_conflict_decisions) THEN
    RETURN QUERY SELECT 409, jsonb_build_object('error', 'PROTECTED_TIME_STATE_CHANGED'), false;
    RETURN;
  END IF;

  SELECT * INTO v_result
  FROM public.mutate_calendar_event_once(
    p_owner_user_id,
    p_event_id,
    p_idempotency_key,
    p_payload_version,
    p_payload_hash_hex,
    p_expected_updated_at,
    p_mutation,
    p_event_patch,
    p_now
  );

  IF v_result.http_status = 200 AND v_result.replayed IS NOT TRUE
     AND jsonb_array_length(p_conflict_decisions) > 0 THEN
    PERFORM private.append_calendar_event_protected_time_decisions(
      p_owner_user_id, p_event_id, p_idempotency_key, 'edit', p_conflict_decisions
    );
  END IF;

  RETURN QUERY SELECT v_result.http_status, v_result.response_body, v_result.replayed;
END;
$function$;

ALTER FUNCTION public.mutate_calendar_event_with_protected_time_once(uuid, uuid, uuid, text, text, timestamptz, text, jsonb, timestamptz, jsonb, jsonb)
  OWNER TO postgres;
REVOKE ALL PRIVILEGES ON FUNCTION public.mutate_calendar_event_with_protected_time_once(uuid, uuid, uuid, text, text, timestamptz, text, jsonb, timestamptz, jsonb, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mutate_calendar_event_with_protected_time_once(uuid, uuid, uuid, text, text, timestamptz, text, jsonb, timestamptz, jsonb, jsonb)
  TO service_role;
