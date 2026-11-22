-- Owner-scoped manual Task reservations.
-- Source migration only: CI applies this to its disposable local Supabase database.
-- No hosted DDL, remote data, Edge deployment, cron or release is authorized here.

ALTER TABLE public.task
  ADD CONSTRAINT task_id_owner_identity_uq UNIQUE (id, owner_user_id);

CREATE TABLE public.task_schedule (
  id uuid PRIMARY KEY,
  owner_user_id uuid NOT NULL REFERENCES public.user_profile(id) ON DELETE RESTRICT,
  created_by_user_id uuid NOT NULL REFERENCES public.user_profile(id) ON DELETE RESTRICT,
  updated_by_user_id uuid NOT NULL REFERENCES public.user_profile(id) ON DELETE RESTRICT,
  task_id uuid NOT NULL,

  schedule_status text NOT NULL DEFAULT 'proposed'
    CHECK (schedule_status IN ('proposed', 'confirmed', 'cancelled', 'released', 'elapsed')),

  -- TaskSchedule is always a timed reservation. Keep the civil instruction
  -- and the authoritative UTC interval so DST and timezone changes are auditable.
  start_local timestamp without time zone NOT NULL,
  end_local timestamp without time zone NOT NULL,
  time_zone text NOT NULL CHECK (length(btrim(time_zone)) BETWEEN 1 AND 100),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  start_disambiguation text NOT NULL CHECK (start_disambiguation IN ('earlier', 'later')),
  end_disambiguation text NOT NULL CHECK (end_disambiguation IN ('earlier', 'later')),
  start_gap_strategy text NOT NULL DEFAULT 'next-valid' CHECK (start_gap_strategy = 'next-valid'),
  end_gap_strategy text NOT NULL DEFAULT 'next-valid' CHECK (end_gap_strategy = 'next-valid'),
  resolver_metadata jsonb NOT NULL
    CHECK (
      jsonb_typeof(resolver_metadata) = 'object'
      AND resolver_metadata->>'rulesSource' = 'iana-tzdb'
      AND resolver_metadata->>'authoritative' = 'true'
      AND length(coalesce(resolver_metadata->>'rulesVersion', '')) > 0
      AND length(coalesce(resolver_metadata->>'resolverVersion', '')) > 0
    ),

  -- Decision and conflict snapshot evidence are captured with the reservation.
  -- The trusted Edge writer computes these; browser-supplied owner/actor values
  -- are never accepted by the mutation RPC.
  conflict_decisions jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(conflict_decisions) = 'array'),
  conflict_snapshot jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(conflict_snapshot) = 'array'),

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT task_schedule_id_uuidv7_check
    CHECK ((get_byte(uuid_send(id), 6) >> 4) = 7 AND (get_byte(uuid_send(id), 8) & 192) = 128),
  CONSTRAINT task_schedule_owner_actor_check
    CHECK (owner_user_id = created_by_user_id AND owner_user_id = updated_by_user_id),
  CONSTRAINT task_schedule_task_owner_fk
    FOREIGN KEY (task_id, owner_user_id)
    REFERENCES public.task (id, owner_user_id) ON DELETE RESTRICT,
  CONSTRAINT task_schedule_owner_identity_uq UNIQUE (id, owner_user_id),
  CONSTRAINT task_schedule_temporal_range_check
    CHECK (
      isfinite(start_local)
      AND isfinite(end_local)
      AND isfinite(starts_at)
      AND isfinite(ends_at)
      AND ends_at > starts_at
    )
);

CREATE INDEX task_schedule_owner_time_idx
  ON public.task_schedule (owner_user_id, starts_at, ends_at)
  WHERE schedule_status IN ('proposed', 'confirmed');

CREATE INDEX task_schedule_owner_task_idx
  ON public.task_schedule (owner_user_id, task_id, created_at DESC);

ALTER TABLE public.task_schedule ENABLE ROW LEVEL SECURITY;

CREATE POLICY task_schedule_read_self
  ON public.task_schedule
  FOR SELECT
  TO authenticated
  USING (
    owner_user_id IN (
      SELECT id
      FROM public.user_profile
      WHERE auth_user_id = (SELECT auth.uid())
    )
  );

REVOKE ALL PRIVILEGES ON TABLE public.task_schedule
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.task_schedule TO authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.task_schedule TO service_role;

COMMENT ON TABLE public.task_schedule IS
  'Owner-private timed reservations for an existing Task. A Task may have multiple schedules; reservations never create or mutate Tasks.';
COMMENT ON COLUMN public.task_schedule.task_id IS
  'References the existing Task through (id, owner_user_id), preventing cross-owner scheduling.';
COMMENT ON COLUMN public.task_schedule.conflict_decisions IS
  'Explicit user decisions for Event and Protected Time conflicts, recorded by the trusted TaskSchedule writer.';
COMMENT ON COLUMN public.task_schedule.conflict_snapshot IS
  'Owner-scoped conflict versions checked by the trusted writer before the atomic reservation commit.';

CREATE OR REPLACE FUNCTION private.touch_task_schedule_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $function$
BEGIN
  NEW.updated_at := GREATEST(clock_timestamp(), OLD.updated_at + interval '1 microsecond');
  RETURN NEW;
END;
$function$;

ALTER FUNCTION private.touch_task_schedule_updated_at() OWNER TO postgres;
REVOKE ALL PRIVILEGES ON FUNCTION private.touch_task_schedule_updated_at()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER task_schedule_touch_updated_at
  BEFORE UPDATE ON public.task_schedule
  FOR EACH ROW EXECUTE FUNCTION private.touch_task_schedule_updated_at();

CREATE OR REPLACE FUNCTION private.append_task_schedule_audit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_changed_fields text[] := ARRAY[]::text[];
  v_details jsonb;
BEGIN
  IF NEW.owner_user_id IS NULL
     OR NEW.created_by_user_id IS NULL
     OR NEW.updated_by_user_id IS NULL
     OR NEW.owner_user_id <> NEW.created_by_user_id
     OR NEW.owner_user_id <> NEW.updated_by_user_id THEN
    RAISE EXCEPTION 'TaskSchedule owner and actor fields must match the verified owner';
  END IF;

  IF TG_OP = 'INSERT' THEN
    v_details := jsonb_build_object(
      'changed_fields', to_jsonb(ARRAY['created']::text[]),
      'schedule_status_after', NEW.schedule_status,
      'conflict_decision_count', jsonb_array_length(NEW.conflict_decisions)
    );
    INSERT INTO public.audit_event (
      id, account_user_id, actor_user_id, action, entity_type, entity_id,
      result, source, details, occurred_at, recorded_at
    ) VALUES (
      private.uuidv7(), NEW.owner_user_id, NEW.updated_by_user_id,
      'task_schedule.created', 'task_schedule', NEW.id,
      'success', 'user', v_details, clock_timestamp(), clock_timestamp()
    );
    RETURN NEW;
  END IF;

  IF TG_OP <> 'UPDATE' THEN
    RAISE EXCEPTION 'Unsupported TaskSchedule audit operation: %', TG_OP;
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.owner_user_id IS DISTINCT FROM OLD.owner_user_id
     OR NEW.created_by_user_id IS DISTINCT FROM OLD.created_by_user_id
     OR NEW.task_id IS DISTINCT FROM OLD.task_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'TaskSchedule identity, owner, creator, Task and creation time are immutable';
  END IF;

  SELECT coalesce(array_agg(k ORDER BY k), ARRAY[]::text[])
    INTO v_changed_fields
  FROM jsonb_object_keys(to_jsonb(NEW)) AS keys(k)
  WHERE k <> 'updated_at'
    AND (to_jsonb(NEW)->k) IS DISTINCT FROM (to_jsonb(OLD)->k);

  IF cardinality(v_changed_fields) = 0 THEN
    RETURN NEW;
  END IF;

  v_details := jsonb_build_object(
    'changed_fields', to_jsonb(v_changed_fields),
    'schedule_status_before', OLD.schedule_status,
    'schedule_status_after', NEW.schedule_status,
    'conflict_decision_count_before', jsonb_array_length(OLD.conflict_decisions),
    'conflict_decision_count_after', jsonb_array_length(NEW.conflict_decisions)
  );

  INSERT INTO public.audit_event (
    id, account_user_id, actor_user_id, action, entity_type, entity_id,
    result, source, details, occurred_at, recorded_at
  ) VALUES (
    private.uuidv7(), NEW.owner_user_id, NEW.updated_by_user_id,
    'task_schedule.updated', 'task_schedule', NEW.id,
    'success', 'user', v_details, clock_timestamp(), clock_timestamp()
  );
  RETURN NEW;
END;
$function$;

ALTER FUNCTION private.append_task_schedule_audit() OWNER TO postgres;
REVOKE ALL PRIVILEGES ON FUNCTION private.append_task_schedule_audit()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER task_schedule_append_audit
  AFTER INSERT OR UPDATE ON public.task_schedule
  FOR EACH ROW EXECUTE FUNCTION private.append_task_schedule_audit();

CREATE TABLE public.task_schedule_mutation_request (
  owner_user_id uuid NOT NULL REFERENCES public.user_profile(id) ON DELETE RESTRICT,
  idempotency_key uuid NOT NULL,
  task_schedule_id uuid NOT NULL,
  payload_version text NOT NULL CHECK (payload_version = 'task-schedule-mutation-v1'),
  payload_hash bytea NOT NULL CHECK (octet_length(payload_hash) = 32),
  response_http_status integer,
  response_body jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,

  PRIMARY KEY (owner_user_id, idempotency_key),
  CONSTRAINT task_schedule_mutation_key_uuidv7_check
    CHECK ((get_byte(uuid_send(idempotency_key), 6) >> 4) = 7
      AND (get_byte(uuid_send(idempotency_key), 8) & 192) = 128),
  CONSTRAINT task_schedule_mutation_schedule_uuidv7_check
    CHECK ((get_byte(uuid_send(task_schedule_id), 6) >> 4) = 7
      AND (get_byte(uuid_send(task_schedule_id), 8) & 192) = 128),
  CONSTRAINT task_schedule_mutation_response_complete_check
    CHECK (
      (response_http_status IS NULL AND response_body IS NULL AND completed_at IS NULL)
      OR (response_http_status IN (200, 201, 404, 409)
        AND response_body IS NOT NULL AND completed_at IS NOT NULL)
    )
);

ALTER TABLE public.task_schedule_mutation_request ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.task_schedule_mutation_request
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.task_schedule_mutation_request TO service_role;

COMMENT ON TABLE public.task_schedule_mutation_request IS
  'Server-only idempotency receipts for owner-scoped TaskSchedule mutations. No browser/API-user grants.';

CREATE OR REPLACE FUNCTION public.mutate_task_schedule_once(
  p_owner_user_id uuid,
  p_task_schedule_id uuid,
  p_idempotency_key uuid,
  p_payload_version text,
  p_payload_hash_hex text,
  p_expected_updated_at timestamptz,
  p_mutation text,
  p_schedule_patch jsonb,
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
  v_schedule public.task_schedule%ROWTYPE;
  v_next public.task_schedule%ROWTYPE;
  v_existing public.task_schedule_mutation_request%ROWTYPE;
  v_task public.task%ROWTYPE;
  v_claimed_rows integer;
  v_payload_hash bytea;
  v_status integer;
  v_response jsonb;
BEGIN
  IF current_user <> 'service_role' THEN
    RAISE EXCEPTION 'mutate_task_schedule_once requires service_role'
      USING ERRCODE = '42501';
  END IF;

  IF p_owner_user_id IS NULL OR p_task_schedule_id IS NULL
     OR p_idempotency_key IS NULL OR p_now IS NULL THEN
    RAISE EXCEPTION 'Verified owner, TaskSchedule, idempotency key and server timestamp are required'
      USING ERRCODE = '22023';
  END IF;

  IF (get_byte(uuid_send(p_task_schedule_id), 6) >> 4) <> 7
     OR (get_byte(uuid_send(p_task_schedule_id), 8) & 192) <> 128
     OR (get_byte(uuid_send(p_idempotency_key), 6) >> 4) <> 7
     OR (get_byte(uuid_send(p_idempotency_key), 8) & 192) <> 128 THEN
    RAISE EXCEPTION 'TaskSchedule id and Idempotency-Key must be UUIDv7 values'
      USING ERRCODE = '22023';
  END IF;

  IF p_payload_version IS DISTINCT FROM 'task-schedule-mutation-v1'
     OR p_payload_hash_hex IS NULL
     OR p_payload_hash_hex !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'TaskSchedule mutation payload version/hash is invalid'
      USING ERRCODE = '22023';
  END IF;
  v_payload_hash := decode(p_payload_hash_hex, 'hex');

  IF p_mutation IS NULL
     OR p_mutation NOT IN ('create', 'edit', 'confirm', 'cancel', 'release', 'elapsed') THEN
    RAISE EXCEPTION 'Unsupported TaskSchedule mutation'
      USING ERRCODE = '22023';
  END IF;

  IF p_mutation IN ('create', 'edit') THEN
    IF p_schedule_patch IS NULL OR jsonb_typeof(p_schedule_patch) <> 'object'
       OR (SELECT count(*) FROM jsonb_object_keys(p_schedule_patch)) <> 14
       OR EXISTS (
         SELECT 1
         FROM jsonb_object_keys(p_schedule_patch) AS supplied(key)
         WHERE supplied.key <> ALL (ARRAY[
           'task_id', 'schedule_status',
           'start_local', 'end_local', 'time_zone', 'starts_at', 'ends_at',
           'start_disambiguation', 'end_disambiguation',
           'start_gap_strategy', 'end_gap_strategy',
           'resolver_metadata', 'conflict_decisions', 'conflict_snapshot'
         ]::text[])
       )
       OR jsonb_typeof(p_schedule_patch->'conflict_decisions') <> 'array'
       OR jsonb_typeof(p_schedule_patch->'conflict_snapshot') <> 'array' THEN
      RAISE EXCEPTION 'TaskSchedule patch must contain exactly the 14 supported fields and conflict arrays'
        USING ERRCODE = '22023';
    END IF;
  ELSIF p_schedule_patch IS DISTINCT FROM '{}'::jsonb THEN
    RAISE EXCEPTION 'Only TaskSchedule create/edit may contain a schedule patch'
      USING ERRCODE = '22023';
  END IF;

  IF (p_mutation = 'create' AND p_expected_updated_at IS NOT NULL)
     OR (p_mutation <> 'create' AND p_expected_updated_at IS NULL) THEN
    RAISE EXCEPTION 'Only create omits expected_updated_at'
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.task_schedule_mutation_request (
    owner_user_id, idempotency_key, task_schedule_id, payload_version, payload_hash
  ) VALUES (
    p_owner_user_id, p_idempotency_key, p_task_schedule_id, p_payload_version, v_payload_hash
  )
  ON CONFLICT (owner_user_id, idempotency_key) DO NOTHING;

  GET DIAGNOSTICS v_claimed_rows = ROW_COUNT;
  IF v_claimed_rows = 0 THEN
    SELECT * INTO v_existing
    FROM public.task_schedule_mutation_request
    WHERE owner_user_id = p_owner_user_id
      AND idempotency_key = p_idempotency_key
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Concurrent TaskSchedule mutation claim was not visible; retry the same key'
        USING ERRCODE = '40001';
    END IF;

    IF (v_existing.task_schedule_id IS DISTINCT FROM p_task_schedule_id AND p_mutation <> 'create')
       OR v_existing.payload_version IS DISTINCT FROM p_payload_version
       OR v_existing.payload_hash IS DISTINCT FROM v_payload_hash THEN
      RETURN QUERY SELECT 409, jsonb_build_object('error', 'IDEMPOTENCY_KEY_REUSED'), false;
      RETURN;
    END IF;

    IF v_existing.response_http_status IS NULL OR v_existing.response_body IS NULL THEN
      RAISE EXCEPTION 'A committed TaskSchedule mutation receipt is incomplete'
        USING ERRCODE = '55000';
    END IF;

    RETURN QUERY SELECT v_existing.response_http_status, v_existing.response_body, true;
    RETURN;
  END IF;

  -- The owner advisory lock serializes this commit with Event, Protected Time
  -- and TaskSchedule writers. Compare the complete owner snapshot only after
  -- acquiring it, closing the read/analyze/commit time-of-check race.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_owner_user_id::text, 8102026));

  IF p_mutation IN ('create', 'edit') AND EXISTS (
    WITH actual AS (
      SELECT 'calendar_event'::text AS resource_type, id, updated_at
      FROM public.calendar_event
      WHERE owner_user_id = p_owner_user_id
        AND archived_at IS NULL
        AND deleted_at IS NULL
        AND event_status IN ('preparing', 'proposed', 'confirmed')
      UNION ALL
      SELECT 'protected_time_block'::text AS resource_type, id, updated_at
      FROM public.protected_time_block
      WHERE owner_user_id = p_owner_user_id
        AND archived_at IS NULL
        AND deleted_at IS NULL
      UNION ALL
      SELECT 'task_schedule'::text AS resource_type, id, updated_at
      FROM public.task_schedule
      WHERE owner_user_id = p_owner_user_id
        AND schedule_status IN ('proposed', 'confirmed')
    ),
    supplied AS (
      SELECT resource_type, id, updated_at
      FROM jsonb_to_recordset(p_schedule_patch->'conflict_snapshot')
        AS snapshot(resource_type text, id uuid, updated_at timestamptz)
    )
    SELECT 1
    FROM actual
    FULL OUTER JOIN supplied USING (resource_type, id)
    WHERE actual.id IS NULL
       OR supplied.id IS NULL
       OR actual.updated_at IS DISTINCT FROM supplied.updated_at
  ) THEN
    v_status := 409;
    v_response := jsonb_build_object('error', 'TASK_SCHEDULE_CONFLICTS_CHANGED');
    UPDATE public.task_schedule_mutation_request
    SET response_http_status = v_status,
        response_body = v_response,
        completed_at = p_now
    WHERE owner_user_id = p_owner_user_id
      AND idempotency_key = p_idempotency_key;
    RETURN QUERY SELECT v_status, v_response, false;
    RETURN;
  END IF;

  IF p_mutation = 'create' THEN
    v_next := jsonb_populate_record(NULL::public.task_schedule, p_schedule_patch);

    IF v_next.schedule_status NOT IN ('proposed', 'confirmed') THEN
      RAISE EXCEPTION 'New TaskSchedule must be proposed or confirmed'
        USING ERRCODE = '22023';
    END IF;

    SELECT * INTO v_task
    FROM public.task
    WHERE id = v_next.task_id
      AND owner_user_id = p_owner_user_id
    FOR KEY SHARE;

    IF NOT FOUND OR v_task.archived_at IS NOT NULL OR v_task.deleted_at IS NOT NULL
       OR v_task.status IN ('completed', 'cancelled') THEN
      v_status := 409;
      v_response := jsonb_build_object('error', 'TASK_NOT_SCHEDULABLE');
    ELSE
      INSERT INTO public.task_schedule (
        id, owner_user_id, created_by_user_id, updated_by_user_id, task_id,
        schedule_status, start_local, end_local, time_zone, starts_at, ends_at,
        start_disambiguation, end_disambiguation, start_gap_strategy, end_gap_strategy,
        resolver_metadata, conflict_decisions, conflict_snapshot, created_at, updated_at
      ) VALUES (
        p_task_schedule_id, p_owner_user_id, p_owner_user_id, p_owner_user_id, v_next.task_id,
        v_next.schedule_status, v_next.start_local, v_next.end_local, v_next.time_zone,
        v_next.starts_at, v_next.ends_at, v_next.start_disambiguation, v_next.end_disambiguation,
        v_next.start_gap_strategy, v_next.end_gap_strategy, v_next.resolver_metadata,
        v_next.conflict_decisions, v_next.conflict_snapshot, p_now, p_now
      )
      RETURNING * INTO v_schedule;
      v_status := 201;
    END IF;

  ELSE
    SELECT * INTO v_schedule
    FROM public.task_schedule
    WHERE id = p_task_schedule_id
      AND owner_user_id = p_owner_user_id
    FOR UPDATE;

    IF NOT FOUND THEN
      v_status := 404;
      v_response := jsonb_build_object('error', 'TASK_SCHEDULE_NOT_FOUND');

    ELSIF v_schedule.updated_at IS DISTINCT FROM p_expected_updated_at THEN
      v_status := 409;
      v_response := jsonb_build_object(
        'error', 'TASK_SCHEDULE_VERSION_CONFLICT',
        'currentUpdatedAt', to_char(v_schedule.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
      );

    ELSIF p_mutation = 'edit' THEN
      IF v_schedule.schedule_status NOT IN ('proposed', 'confirmed') THEN
        v_status := 409;
        v_response := jsonb_build_object('error', 'TASK_SCHEDULE_NOT_EDITABLE');
      ELSE
        v_next := jsonb_populate_record(v_schedule, p_schedule_patch);
        IF v_next.task_id IS DISTINCT FROM v_schedule.task_id
           OR v_next.schedule_status IS DISTINCT FROM v_schedule.schedule_status THEN
          RAISE EXCEPTION 'TaskSchedule edit cannot change Task identity or reservation status'
            USING ERRCODE = '22023';
        END IF;

        SELECT * INTO v_task
        FROM public.task
        WHERE id = v_schedule.task_id
          AND owner_user_id = p_owner_user_id
        FOR KEY SHARE;

        IF NOT FOUND OR v_task.archived_at IS NOT NULL OR v_task.deleted_at IS NOT NULL
           OR v_task.status IN ('completed', 'cancelled') THEN
          v_status := 409;
          v_response := jsonb_build_object('error', 'TASK_NOT_SCHEDULABLE');
        ELSE
          UPDATE public.task_schedule
          SET start_local = v_next.start_local,
              end_local = v_next.end_local,
              time_zone = v_next.time_zone,
              starts_at = v_next.starts_at,
              ends_at = v_next.ends_at,
              start_disambiguation = v_next.start_disambiguation,
              end_disambiguation = v_next.end_disambiguation,
              start_gap_strategy = v_next.start_gap_strategy,
              end_gap_strategy = v_next.end_gap_strategy,
              resolver_metadata = v_next.resolver_metadata,
              conflict_decisions = v_next.conflict_decisions,
              conflict_snapshot = v_next.conflict_snapshot,
              updated_by_user_id = p_owner_user_id
          WHERE id = p_task_schedule_id
            AND owner_user_id = p_owner_user_id
          RETURNING * INTO v_schedule;
          v_status := 200;
        END IF;
      END IF;

    ELSE
      CASE p_mutation
        WHEN 'confirm' THEN
          IF v_schedule.schedule_status = 'proposed' THEN
            UPDATE public.task_schedule
            SET schedule_status = 'confirmed', updated_by_user_id = p_owner_user_id
            WHERE id = p_task_schedule_id AND owner_user_id = p_owner_user_id
            RETURNING * INTO v_schedule;
            v_status := 200;
          ELSE
            v_status := 409;
            v_response := jsonb_build_object('error', 'TASK_SCHEDULE_NOT_CONFIRMABLE');
          END IF;

        WHEN 'cancel' THEN
          IF v_schedule.schedule_status IN ('proposed', 'confirmed') THEN
            UPDATE public.task_schedule
            SET schedule_status = 'cancelled', updated_by_user_id = p_owner_user_id
            WHERE id = p_task_schedule_id AND owner_user_id = p_owner_user_id
            RETURNING * INTO v_schedule;
            v_status := 200;
          ELSE
            v_status := 409;
            v_response := jsonb_build_object('error', 'TASK_SCHEDULE_NOT_CANCELLABLE');
          END IF;

        WHEN 'release' THEN
          IF v_schedule.schedule_status = 'confirmed' THEN
            UPDATE public.task_schedule
            SET schedule_status = 'released', updated_by_user_id = p_owner_user_id
            WHERE id = p_task_schedule_id AND owner_user_id = p_owner_user_id
            RETURNING * INTO v_schedule;
            v_status := 200;
          ELSE
            v_status := 409;
            v_response := jsonb_build_object('error', 'TASK_SCHEDULE_NOT_RELEASABLE');
          END IF;

        WHEN 'elapsed' THEN
          IF v_schedule.schedule_status = 'confirmed' THEN
            UPDATE public.task_schedule
            SET schedule_status = 'elapsed', updated_by_user_id = p_owner_user_id
            WHERE id = p_task_schedule_id AND owner_user_id = p_owner_user_id
            RETURNING * INTO v_schedule;
            v_status := 200;
          ELSE
            v_status := 409;
            v_response := jsonb_build_object('error', 'TASK_SCHEDULE_NOT_ELAPSABLE');
          END IF;
      END CASE;
    END IF;
  END IF;

  IF v_status IN (200, 201) THEN
    v_response := jsonb_build_object(
      'taskScheduleId', v_schedule.id::text,
      'taskId', v_schedule.task_id::text,
      'scheduleStatus', v_schedule.schedule_status,
      'updatedAt', to_char(v_schedule.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'startLocal', v_schedule.start_local,
      'endLocal', v_schedule.end_local,
      'timeZone', v_schedule.time_zone,
      'startsAt', v_schedule.starts_at,
      'endsAt', v_schedule.ends_at,
      'resolverMetadata', v_schedule.resolver_metadata,
      'conflictDecisionCount', jsonb_array_length(v_schedule.conflict_decisions)
    );
  END IF;

  UPDATE public.task_schedule_mutation_request
  SET response_http_status = v_status,
      response_body = v_response,
      completed_at = p_now
  WHERE owner_user_id = p_owner_user_id
    AND idempotency_key = p_idempotency_key;

  RETURN QUERY SELECT v_status, v_response, false;
END;
$function$;

ALTER FUNCTION public.mutate_task_schedule_once(uuid, uuid, uuid, text, text, timestamptz, text, jsonb, timestamptz)
  OWNER TO postgres;

REVOKE ALL PRIVILEGES ON FUNCTION public.mutate_task_schedule_once(uuid, uuid, uuid, text, text, timestamptz, text, jsonb, timestamptz)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mutate_task_schedule_once(uuid, uuid, uuid, text, text, timestamptz, text, jsonb, timestamptz)
  TO service_role;
