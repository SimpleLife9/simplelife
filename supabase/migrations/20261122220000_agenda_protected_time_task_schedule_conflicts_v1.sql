-- Protected Time -> TaskSchedule conflict consent and shared-owner atomicity.
-- The migration is validated only in ephemeral CI; hosted deployment remains gated.

ALTER TABLE public.protected_time_block
  ADD COLUMN task_schedule_conflict_decisions jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD CONSTRAINT protected_time_block_task_schedule_decisions_check
    CHECK (
      CASE WHEN jsonb_typeof(task_schedule_conflict_decisions) = 'array'
        THEN jsonb_array_length(task_schedule_conflict_decisions) <= 500
        ELSE false
      END
    );

COMMENT ON COLUMN public.protected_time_block.task_schedule_conflict_decisions IS
  'Version-bound user consent for existing TaskSchedule overlaps. The audit stream records the exact decisions.';

ALTER TABLE public.protected_time_block_mutation_request
  DROP CONSTRAINT IF EXISTS protected_time_block_mutation_request_payload_version_check,
  ADD CONSTRAINT protected_time_block_mutation_request_payload_version_check
    CHECK (payload_version IN ('protected-time-mutation-v1', 'protected-time-mutation-v2'));

CREATE OR REPLACE FUNCTION private.append_protected_time_task_schedule_decision_audit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_decisions_before jsonb := '[]'::jsonb;
BEGIN
  IF NEW.owner_user_id IS NULL OR NEW.updated_by_user_id IS NULL
     OR NEW.owner_user_id <> NEW.updated_by_user_id THEN
    RAISE EXCEPTION 'TaskSchedule decision audit requires the verified Protected Time owner';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.task_schedule_conflict_decisions IS NOT DISTINCT FROM OLD.task_schedule_conflict_decisions THEN
      RETURN NEW;
    END IF;
    v_decisions_before := coalesce(OLD.task_schedule_conflict_decisions, '[]'::jsonb);
  ELSIF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'Unsupported Protected Time TaskSchedule decision audit operation: %', TG_OP;
  END IF;

  IF jsonb_typeof(NEW.task_schedule_conflict_decisions) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'TaskSchedule decision evidence must be a JSON array';
  END IF;
  IF jsonb_array_length(NEW.task_schedule_conflict_decisions) > 500 THEN
    RAISE EXCEPTION 'TaskSchedule decision evidence cannot exceed 500 entries';
  END IF;

  -- An empty initial state has nothing to audit. An UPDATE from a non-empty
  -- state to [] is meaningful revocation and must remain visible.
  IF TG_OP = 'INSERT' AND jsonb_array_length(NEW.task_schedule_conflict_decisions) = 0 THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.audit_event (
    id, account_user_id, actor_user_id, action, entity_type, entity_id,
    result, source, details, occurred_at, recorded_at
  ) VALUES (
    private.uuidv7(), NEW.owner_user_id, NEW.updated_by_user_id,
    'protected_time_block.task_schedule_decisions_changed',
    'protected_time_block', NEW.id, 'success', 'user',
    jsonb_build_object(
      'decision_version', 'protected-time-task-schedule-decision-v1',
      'protection_mode', NEW.protection_mode,
      'decision_count_before', jsonb_array_length(v_decisions_before),
      'decision_count_after', jsonb_array_length(NEW.task_schedule_conflict_decisions),
      'decisions', NEW.task_schedule_conflict_decisions,
      'decisions_before', v_decisions_before,
      'decisions_after', NEW.task_schedule_conflict_decisions
    ),
    clock_timestamp(), clock_timestamp()
  );
  RETURN NEW;
END;
$function$;

ALTER FUNCTION private.append_protected_time_task_schedule_decision_audit() OWNER TO postgres;
REVOKE ALL PRIVILEGES ON FUNCTION private.append_protected_time_task_schedule_decision_audit()
  FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER protected_time_task_schedule_decision_audit
  AFTER INSERT OR UPDATE ON public.protected_time_block
  FOR EACH ROW EXECUTE FUNCTION private.append_protected_time_task_schedule_decision_audit();

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

  IF p_payload_version IS NULL OR p_payload_version NOT IN ('protected-time-mutation-v1', 'protected-time-mutation-v2')
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
       OR (SELECT count(*) FROM jsonb_object_keys(p_block_patch)) NOT IN (20, 22)
       OR EXISTS (
         SELECT 1 FROM jsonb_object_keys(p_block_patch) AS supplied(key)
         WHERE supplied.key <> ALL (ARRAY[
           'label', 'category', 'protection_mode', 'pattern_kind', 'time_zone',
           'start_local', 'end_local', 'starts_at', 'ends_at',
           'start_disambiguation', 'end_disambiguation',
           'start_gap_strategy', 'end_gap_strategy',
           'start_date', 'end_date_exclusive', 'weekdays',
           'start_time_local', 'end_time_local', 'ends_next_day',
           'resolver_metadata', 'task_schedule_conflict_decisions', 'task_schedule_snapshot'
         ]::text[])
       ) THEN
      RAISE EXCEPTION 'Protected Time patch must contain exactly the 20 editable fields'
        USING ERRCODE = '22023';
    END IF;
  ELSIF p_mutation = 'restore' AND p_block_patch IS DISTINCT FROM '{}'::jsonb THEN
    IF p_block_patch IS NULL OR jsonb_typeof(p_block_patch) IS DISTINCT FROM 'object'
       OR (SELECT count(*) FROM jsonb_object_keys(p_block_patch)) <> 2
       OR EXISTS (
         SELECT 1 FROM jsonb_object_keys(p_block_patch) AS supplied(key)
         WHERE supplied.key <> ALL (ARRAY[
           'task_schedule_conflict_decisions', 'task_schedule_snapshot'
         ]::text[])
       ) THEN
      RAISE EXCEPTION 'Protected Time restore accepts only TaskSchedule conflict evidence'
        USING ERRCODE = '22023';
    END IF;
  ELSIF p_block_patch IS DISTINCT FROM '{}'::jsonb THEN
    RAISE EXCEPTION 'Only Protected Time create/edit or evidence-bearing restore may contain a block patch'
      USING ERRCODE = '22023';
  END IF;

  -- All owner-scoped Event, Protected Time and TaskSchedule writers share this
  -- transaction lock. It serializes the read/compare/commit boundary.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_owner_user_id::text, 8102026));

  IF (p_mutation IN ('create', 'edit') AND
      (SELECT count(*) FROM jsonb_object_keys(p_block_patch)) = 22)
     OR (p_mutation = 'restore' AND p_block_patch IS DISTINCT FROM '{}'::jsonb) THEN
    IF jsonb_typeof(p_block_patch->'task_schedule_conflict_decisions') IS DISTINCT FROM 'array'
       OR jsonb_typeof(p_block_patch->'task_schedule_snapshot') IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'TaskSchedule decisions and snapshot must be JSON arrays'
        USING ERRCODE = '22023';
    END IF;
    IF jsonb_array_length(p_block_patch->'task_schedule_conflict_decisions') > 500
       OR jsonb_array_length(p_block_patch->'task_schedule_snapshot') > 500 THEN
      RAISE EXCEPTION 'TaskSchedule decisions and snapshot cannot exceed 500 entries'
        USING ERRCODE = '22023';
    END IF;
    IF EXISTS (
      SELECT 1
      FROM jsonb_array_elements(p_block_patch->'task_schedule_snapshot') AS supplied(item)
      WHERE jsonb_typeof(supplied.item) IS DISTINCT FROM 'object'
         OR CASE
              WHEN jsonb_typeof(supplied.item) = 'object' THEN
                (SELECT count(*) FROM jsonb_object_keys(supplied.item)) <> 2
                OR NOT (supplied.item ?& ARRAY['id', 'updated_at']::text[])
              ELSE true
            END
    ) OR EXISTS (
      SELECT 1
      FROM (
        SELECT item->>'id' AS schedule_id, count(*) AS copies
        FROM jsonb_array_elements(p_block_patch->'task_schedule_snapshot') AS supplied(item)
        GROUP BY item->>'id'
      ) AS duplicate_snapshots
      WHERE copies > 1
    ) THEN
      RAISE EXCEPTION 'TaskSchedule snapshot entries must be exact, unique id/updated_at objects'
        USING ERRCODE = '22023';
    END IF;
    IF p_payload_version = 'protected-time-mutation-v1'
       AND jsonb_array_length(p_block_patch->'task_schedule_conflict_decisions') > 0 THEN
      RAISE EXCEPTION 'TaskSchedule consent requires protected-time-mutation-v2'
        USING ERRCODE = '22023';
    END IF;
    IF p_payload_version = 'protected-time-mutation-v2'
       AND jsonb_array_length(p_block_patch->'task_schedule_conflict_decisions') = 0 THEN
      RAISE EXCEPTION 'protected-time-mutation-v2 requires explicit TaskSchedule consent'
        USING ERRCODE = '22023';
    END IF;

    -- Recheck the complete owner TaskSchedule set after acquiring the lock.
    IF EXISTS (
      SELECT 1
      FROM (
        SELECT id, updated_at
        FROM jsonb_to_recordset(p_block_patch->'task_schedule_snapshot')
          AS supplied(id uuid, updated_at timestamptz)
      ) AS snapshot
      FULL OUTER JOIN (
        SELECT id, updated_at
        FROM public.task_schedule
        WHERE owner_user_id = p_owner_user_id
          AND schedule_status IN ('proposed', 'confirmed')
      ) AS current_schedules USING (id)
      WHERE snapshot.id IS NULL
         OR current_schedules.id IS NULL
         OR snapshot.updated_at IS DISTINCT FROM current_schedules.updated_at
    ) THEN
      RETURN QUERY SELECT 409, jsonb_build_object('error', 'TASK_SCHEDULE_CONFLICTS_CHANGED'), false;
      RETURN;
    END IF;

    -- The Edge layer expands the recurring block through the pinned IANA
    -- resolver; SQL revalidates every accepted schedule identity and version.
    IF EXISTS (
      SELECT 1
      FROM jsonb_array_elements(p_block_patch->'task_schedule_conflict_decisions') AS supplied(item)
      WHERE jsonb_typeof(supplied.item) IS DISTINCT FROM 'object'
         OR CASE
              WHEN jsonb_typeof(supplied.item) = 'object' THEN
                (SELECT count(*) FROM jsonb_object_keys(supplied.item)) <> 14
                OR NOT (supplied.item ?& ARRAY[
                  'policyVersion', 'taskScheduleId', 'taskScheduleUpdatedAt',
                  'startsAt', 'endsAt', 'occurrenceDate', 'occurrenceStartsAt',
                  'occurrenceEndsAt', 'overlapStartsAt', 'overlapEndsAt',
                  'protectionMode', 'timeZone', 'decision', 'consentedAt'
                ]::text[])
              ELSE true
            END
         OR supplied.item->>'policyVersion' IS DISTINCT FROM 'protected-time-task-schedule-decision-v1'
         OR supplied.item->>'decision' IS DISTINCT FROM 'keep_overlap'
         OR supplied.item->>'protectionMode' IS DISTINCT FROM CASE
              WHEN p_mutation = 'restore' THEN (
                SELECT protection_mode FROM public.protected_time_block
                WHERE id = p_block_id AND owner_user_id = p_owner_user_id
              )
              ELSE p_block_patch->>'protection_mode'
            END
         OR NOT EXISTS (
           SELECT 1
           FROM public.task_schedule AS schedule
           WHERE schedule.id = (supplied.item->>'taskScheduleId')::uuid
             AND schedule.owner_user_id = p_owner_user_id
             AND schedule.updated_at = (supplied.item->>'taskScheduleUpdatedAt')::timestamptz
             AND schedule.schedule_status IN ('proposed', 'confirmed')
         )
    ) OR EXISTS (
      SELECT 1
      FROM (
        SELECT item->>'taskScheduleId' AS schedule_id,
               item->>'occurrenceStartsAt' AS occurrence_start,
               count(*) AS occurrences
        FROM jsonb_array_elements(p_block_patch->'task_schedule_conflict_decisions') AS decisions(item)
        GROUP BY item->>'taskScheduleId', item->>'occurrenceStartsAt'
      ) AS duplicates
      WHERE occurrences > 1
    ) THEN
      RETURN QUERY SELECT 409, jsonb_build_object('error', 'TASK_SCHEDULE_CONFLICTS_CHANGED'), false;
      RETURN;
    END IF;
  ELSIF p_mutation IN ('create', 'edit', 'restore') AND p_payload_version = 'protected-time-mutation-v2' THEN
    RAISE EXCEPTION 'TaskSchedule consent requires the complete conflict snapshot'
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

  IF p_mutation = 'create' THEN
    v_next := jsonb_populate_record(NULL::public.protected_time_block, p_block_patch - 'task_schedule_snapshot');
    v_next.task_schedule_conflict_decisions := coalesce(v_next.task_schedule_conflict_decisions, '[]'::jsonb);
    INSERT INTO public.protected_time_block (
      id, owner_user_id, created_by_user_id, updated_by_user_id,
      label, category, protection_mode, pattern_kind, time_zone,
      start_local, end_local, starts_at, ends_at,
      start_disambiguation, end_disambiguation, start_gap_strategy, end_gap_strategy,
      start_date, end_date_exclusive, weekdays, start_time_local, end_time_local, ends_next_day,
      resolver_metadata, task_schedule_conflict_decisions, created_at, updated_at
    ) VALUES (
      p_block_id, p_owner_user_id, p_owner_user_id, p_owner_user_id,
      v_next.label, v_next.category, v_next.protection_mode, v_next.pattern_kind, v_next.time_zone,
      v_next.start_local, v_next.end_local, v_next.starts_at, v_next.ends_at,
      v_next.start_disambiguation, v_next.end_disambiguation, v_next.start_gap_strategy, v_next.end_gap_strategy,
      v_next.start_date, v_next.end_date_exclusive, v_next.weekdays,
      v_next.start_time_local, v_next.end_time_local, v_next.ends_next_day,
      v_next.resolver_metadata, v_next.task_schedule_conflict_decisions, p_now, p_now
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
            v_next := jsonb_populate_record(v_block, p_block_patch - 'task_schedule_snapshot');
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
                task_schedule_conflict_decisions = v_next.task_schedule_conflict_decisions,
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
            SET archived_at = NULL,
                deleted_at = NULL,
                task_schedule_conflict_decisions = CASE
                  WHEN p_block_patch ? 'task_schedule_conflict_decisions'
                    THEN p_block_patch->'task_schedule_conflict_decisions'
                  ELSE task_schedule_conflict_decisions
                END,
                updated_by_user_id = p_owner_user_id
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
      'taskScheduleDecisions', v_block.task_schedule_conflict_decisions,
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
