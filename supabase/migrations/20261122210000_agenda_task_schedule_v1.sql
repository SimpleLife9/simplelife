-- TaskSchedule: manual time reservations for existing Tasks.
-- Proposed blocks do not reserve time. Only confirmed reservations block Agenda time.
-- Task state is intentionally untouched by every TaskSchedule transition.

ALTER TABLE public.task
  ADD CONSTRAINT task_owner_identity_uq UNIQUE (id, owner_user_id);

CREATE TABLE public.task_schedule (
  id uuid PRIMARY KEY,
  owner_user_id uuid NOT NULL REFERENCES public.user_profile(id) ON DELETE RESTRICT,
  task_id uuid NOT NULL,
  created_by_user_id uuid NOT NULL REFERENCES public.user_profile(id) ON DELETE RESTRICT,
  updated_by_user_id uuid NOT NULL REFERENCES public.user_profile(id) ON DELETE RESTRICT,
  time_zone text NOT NULL CHECK (length(btrim(time_zone)) BETWEEN 1 AND 100),
  start_local timestamp without time zone NOT NULL,
  end_local timestamp without time zone NOT NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  start_disambiguation text NOT NULL CHECK (start_disambiguation IN ('earlier','later','reject')),
  end_disambiguation text NOT NULL CHECK (end_disambiguation IN ('earlier','later','reject')),
  start_gap_strategy text NOT NULL CHECK (start_gap_strategy = 'next-valid'),
  end_gap_strategy text NOT NULL CHECK (end_gap_strategy = 'next-valid'),
  resolver_metadata jsonb NOT NULL CHECK (jsonb_typeof(resolver_metadata) = 'object'),
  schedule_status text NOT NULL DEFAULT 'proposed'
    CHECK (schedule_status IN ('proposed','confirmed','cancelled','released','elapsed')),
  conflict_decisions jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(conflict_decisions) = 'array' AND jsonb_array_length(conflict_decisions) <= 500),
  cancelled_at timestamptz,
  released_at timestamptz,
  elapsed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT task_schedule_id_uuidv7_check
    CHECK ((get_byte(uuid_send(id),6)>>4)=7 AND (get_byte(uuid_send(id),8)&192)=128),
  CONSTRAINT task_schedule_owner_pair_uq UNIQUE (id, owner_user_id),
  CONSTRAINT task_schedule_task_owner_fkey FOREIGN KEY (task_id, owner_user_id)
    REFERENCES public.task(id, owner_user_id) ON DELETE RESTRICT,
  CONSTRAINT task_schedule_actor_check
    CHECK (owner_user_id = created_by_user_id AND owner_user_id = updated_by_user_id),
  CONSTRAINT task_schedule_time_range_check
    CHECK (isfinite(start_local) AND isfinite(end_local) AND isfinite(starts_at) AND isfinite(ends_at) AND ends_at > starts_at),
  CONSTRAINT task_schedule_resolver_check
    CHECK (coalesce(resolver_metadata->>'rulesSource','') = 'iana-tzdb'
      AND coalesce(resolver_metadata->>'authoritative','') = 'true'
      AND length(coalesce(resolver_metadata->>'rulesVersion','')) > 0
      AND length(coalesce(resolver_metadata->>'resolverVersion','')) > 0),
  CONSTRAINT task_schedule_status_timestamp_check CHECK (
    (schedule_status IN ('proposed','confirmed') AND cancelled_at IS NULL AND released_at IS NULL AND elapsed_at IS NULL)
    OR (schedule_status = 'cancelled' AND cancelled_at IS NOT NULL AND released_at IS NULL AND elapsed_at IS NULL)
    OR (schedule_status = 'released' AND cancelled_at IS NULL AND released_at IS NOT NULL AND elapsed_at IS NULL)
    OR (schedule_status = 'elapsed' AND cancelled_at IS NULL AND released_at IS NULL AND elapsed_at IS NOT NULL)
  )
);

COMMENT ON TABLE public.task_schedule IS
  'A timed reservation linked to one existing Task. Multiple reservations can reference one Task; reservation lifecycle never changes Task state.';
COMMENT ON COLUMN public.task_schedule.schedule_status IS
  'proposed is non-blocking; confirmed blocks Agenda time; cancelled/released/elapsed do not block. elapsed is not evidence of Task completion.';

CREATE INDEX task_schedule_owner_confirmed_range_idx
  ON public.task_schedule(owner_user_id, starts_at, ends_at)
  WHERE schedule_status = 'confirmed';
CREATE INDEX task_schedule_task_owner_created_idx
  ON public.task_schedule(task_id, owner_user_id, created_at DESC);

ALTER TABLE public.task_schedule ENABLE ROW LEVEL SECURITY;
CREATE POLICY task_schedule_read_self ON public.task_schedule
  FOR SELECT TO authenticated
  USING (owner_user_id IN (
    SELECT id FROM public.user_profile WHERE auth_user_id = (SELECT auth.uid())
  ));
REVOKE ALL PRIVILEGES ON TABLE public.task_schedule FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.task_schedule TO authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.task_schedule TO service_role;

CREATE OR REPLACE FUNCTION private.touch_task_schedule_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $function$
BEGIN
  NEW.updated_at := GREATEST(clock_timestamp(), OLD.updated_at + interval '1 microsecond');
  RETURN NEW;
END;
$function$;
ALTER FUNCTION private.touch_task_schedule_updated_at() OWNER TO postgres;
REVOKE ALL PRIVILEGES ON FUNCTION private.touch_task_schedule_updated_at()
  FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER task_schedule_touch_updated_at
  BEFORE UPDATE ON public.task_schedule FOR EACH ROW
  EXECUTE FUNCTION private.touch_task_schedule_updated_at();

CREATE OR REPLACE FUNCTION private.append_task_schedule_audit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $function$
DECLARE
  v_action text := 'task_schedule.updated';
  v_details jsonb;
BEGIN
  IF NEW.owner_user_id IS NULL OR NEW.created_by_user_id IS NULL OR NEW.updated_by_user_id IS NULL
     OR NEW.owner_user_id <> NEW.created_by_user_id OR NEW.owner_user_id <> NEW.updated_by_user_id THEN
    RAISE EXCEPTION 'TaskSchedule owner and actors must match the verified owner';
  END IF;
  IF TG_OP = 'INSERT' THEN
    v_action := 'task_schedule.proposed';
    v_details := jsonb_build_object('task_id', NEW.task_id, 'schedule_status', NEW.schedule_status,
      'starts_at', NEW.starts_at, 'ends_at', NEW.ends_at);
  ELSE
    IF NEW.id IS DISTINCT FROM OLD.id OR NEW.owner_user_id IS DISTINCT FROM OLD.owner_user_id
       OR NEW.task_id IS DISTINCT FROM OLD.task_id
       OR NEW.created_by_user_id IS DISTINCT FROM OLD.created_by_user_id
       OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'TaskSchedule identity, owner, Task, creator and creation time are immutable';
    END IF;
    IF NEW.schedule_status IS DISTINCT FROM OLD.schedule_status THEN
      v_action := CASE NEW.schedule_status
        WHEN 'confirmed' THEN 'task_schedule.confirmed'
        WHEN 'cancelled' THEN 'task_schedule.cancelled'
        WHEN 'released' THEN 'task_schedule.released'
        WHEN 'elapsed' THEN 'task_schedule.elapsed'
        ELSE 'task_schedule.updated'
      END;
    END IF;
    v_details := jsonb_build_object(
      'task_id', NEW.task_id,
      'schedule_status_before', OLD.schedule_status,
      'schedule_status_after', NEW.schedule_status,
      'changed_fields', (
        SELECT coalesce(jsonb_agg(k ORDER BY k), '[]'::jsonb)
        FROM jsonb_object_keys(to_jsonb(NEW)) AS keys(k)
        WHERE k <> 'updated_at' AND (to_jsonb(NEW)->k) IS DISTINCT FROM (to_jsonb(OLD)->k)
      ),
      'conflict_decisions', NEW.conflict_decisions
    );
  END IF;
  INSERT INTO public.audit_event (
    id, account_user_id, actor_user_id, action, entity_type, entity_id,
    result, source, details, occurred_at, recorded_at
  ) VALUES (
    private.uuidv7(), NEW.owner_user_id, NEW.updated_by_user_id,
    v_action, 'task_schedule', NEW.id, 'success', 'user', v_details,
    clock_timestamp(), clock_timestamp()
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
    CHECK ((get_byte(uuid_send(idempotency_key),6)>>4)=7 AND (get_byte(uuid_send(idempotency_key),8)&192)=128),
  CONSTRAINT task_schedule_mutation_id_uuidv7_check
    CHECK ((get_byte(uuid_send(task_schedule_id),6)>>4)=7 AND (get_byte(uuid_send(task_schedule_id),8)&192)=128),
  CONSTRAINT task_schedule_mutation_response_check CHECK (
    (response_http_status IS NULL AND response_body IS NULL AND completed_at IS NULL)
    OR (response_http_status IN (200,201,404,409) AND response_body IS NOT NULL AND completed_at IS NOT NULL)
  )
);
ALTER TABLE public.task_schedule_mutation_request ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.task_schedule_mutation_request FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.task_schedule_mutation_request TO service_role;


CREATE OR REPLACE FUNCTION public.mutate_task_schedule_once(
  p_owner_user_id uuid,
  p_task_schedule_id uuid,
  p_idempotency_key uuid,
  p_payload_version text,
  p_payload_hash_hex text,
  p_expected_updated_at timestamptz,
  p_mutation text,
  p_schedule_patch jsonb,
  p_conflict_decisions jsonb,
  p_protected_time_snapshot jsonb,
  p_calendar_event_snapshot jsonb,
  p_task_schedule_snapshot jsonb,
  p_now timestamptz
)
RETURNS TABLE(http_status integer, response_body jsonb, replayed boolean)
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog
AS $function$
DECLARE
  v_existing public.task_schedule_mutation_request%ROWTYPE;
  v_schedule public.task_schedule%ROWTYPE;
  v_claimed integer;
  v_hash bytea;
  v_status integer;
  v_body jsonb;
  v_needs_conflict_check boolean := false;
BEGIN
  IF current_user <> 'service_role' THEN
    RAISE EXCEPTION 'mutate_task_schedule_once requires service_role' USING ERRCODE = '42501';
  END IF;
  IF p_owner_user_id IS NULL OR p_task_schedule_id IS NULL
     OR p_idempotency_key IS NULL OR p_now IS NULL THEN
    RAISE EXCEPTION 'Verified owner, TaskSchedule, key and server time are required' USING ERRCODE = '22023';
  END IF;
  IF (get_byte(uuid_send(p_task_schedule_id),6)>>4) <> 7 OR (get_byte(uuid_send(p_task_schedule_id),8)&192) <> 128
     OR (get_byte(uuid_send(p_idempotency_key),6)>>4) <> 7 OR (get_byte(uuid_send(p_idempotency_key),8)&192) <> 128 THEN
    RAISE EXCEPTION 'TaskSchedule id and Idempotency-Key must be UUIDv7' USING ERRCODE = '22023';
  END IF;
  IF p_payload_version IS DISTINCT FROM 'task-schedule-mutation-v1'
     OR p_payload_hash_hex IS NULL OR p_payload_hash_hex !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'TaskSchedule payload version/hash is invalid' USING ERRCODE = '22023';
  END IF;
  v_hash := decode(p_payload_hash_hex, 'hex');
  IF p_mutation IS NULL OR p_mutation NOT IN ('create','edit','confirm','cancel','release','mark_elapsed') THEN
    RAISE EXCEPTION 'Unsupported TaskSchedule mutation' USING ERRCODE = '22023';
  END IF;
  IF (p_mutation = 'create' AND p_expected_updated_at IS NOT NULL)
     OR (p_mutation <> 'create' AND p_expected_updated_at IS NULL) THEN
    RAISE EXCEPTION 'Only TaskSchedule create omits expected_updated_at' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(p_conflict_decisions) IS DISTINCT FROM 'array'
     OR jsonb_typeof(p_protected_time_snapshot) IS DISTINCT FROM 'array'
     OR jsonb_typeof(p_calendar_event_snapshot) IS DISTINCT FROM 'array'
     OR jsonb_typeof(p_task_schedule_snapshot) IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_conflict_decisions) > 500
     OR jsonb_array_length(p_protected_time_snapshot) > 500
     OR jsonb_array_length(p_calendar_event_snapshot) > 500
     OR jsonb_array_length(p_task_schedule_snapshot) > 500 THEN
    RAISE EXCEPTION 'TaskSchedule decisions and snapshots must be bounded JSON arrays' USING ERRCODE = '22023';
  END IF;
  IF p_mutation IN ('create','edit') THEN
    IF p_schedule_patch IS NULL OR jsonb_typeof(p_schedule_patch) <> 'object'
       OR (SELECT count(*) FROM jsonb_object_keys(p_schedule_patch)) <> 11
       OR EXISTS (
         SELECT 1 FROM jsonb_object_keys(p_schedule_patch) AS supplied(key)
         WHERE supplied.key <> ALL (ARRAY[
           'task_id','time_zone','start_local','end_local','starts_at','ends_at',
           'start_disambiguation','end_disambiguation','start_gap_strategy','end_gap_strategy','resolver_metadata'
         ]::text[])
       ) THEN
      RAISE EXCEPTION 'TaskSchedule patch must contain exactly 11 allowed fields' USING ERRCODE = '22023';
    END IF;
  ELSIF p_schedule_patch IS DISTINCT FROM '{}'::jsonb THEN
    RAISE EXCEPTION 'Only TaskSchedule create/edit may contain a schedule patch' USING ERRCODE = '22023';
  END IF;
  IF p_mutation NOT IN ('confirm','edit') AND jsonb_array_length(p_conflict_decisions) <> 0 THEN
    RAISE EXCEPTION 'Only TaskSchedule confirmation/edit may carry conflict decisions' USING ERRCODE = '22023';
  END IF;

  -- The same owner lock serializes reservation writes with Event and Protected Time writers.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_owner_user_id::text, 8102026));

  -- Same-key/same-intent retries replay before snapshot validation or CAS.
  SELECT * INTO v_existing FROM public.task_schedule_mutation_request
  WHERE owner_user_id = p_owner_user_id AND idempotency_key = p_idempotency_key
  FOR UPDATE;
  IF FOUND THEN
    IF v_existing.payload_version IS DISTINCT FROM p_payload_version
       OR v_existing.payload_hash IS DISTINCT FROM v_hash
       OR (p_mutation <> 'create' AND v_existing.task_schedule_id IS DISTINCT FROM p_task_schedule_id) THEN
      RETURN QUERY SELECT 409, jsonb_build_object('error','IDEMPOTENCY_KEY_REUSED'), false;
      RETURN;
    END IF;
    IF v_existing.response_http_status IS NULL OR v_existing.response_body IS NULL THEN
      RAISE EXCEPTION 'A committed TaskSchedule receipt is incomplete' USING ERRCODE = '55000';
    END IF;
    RETURN QUERY SELECT v_existing.response_http_status, v_existing.response_body, true;
    RETURN;
  END IF;

  IF p_mutation <> 'create' THEN
    SELECT * INTO v_schedule FROM public.task_schedule
    WHERE id = p_task_schedule_id AND owner_user_id = p_owner_user_id FOR UPDATE;
    IF NOT FOUND THEN
      RETURN QUERY SELECT 404, jsonb_build_object('error','TASK_SCHEDULE_NOT_FOUND'), false;
      RETURN;
    END IF;
    IF v_schedule.updated_at IS DISTINCT FROM p_expected_updated_at THEN
      RETURN QUERY SELECT 409, jsonb_build_object('error','TASK_SCHEDULE_VERSION_CONFLICT'), false;
      RETURN;
    END IF;
    IF p_mutation = 'edit' THEN
      IF v_schedule.schedule_status NOT IN ('proposed','confirmed') THEN
        RETURN QUERY SELECT 409, jsonb_build_object('error','TASK_SCHEDULE_NOT_EDITABLE'), false;
        RETURN;
      END IF;
      v_needs_conflict_check := v_schedule.schedule_status = 'confirmed';
    ELSIF p_mutation = 'confirm' THEN
      IF v_schedule.schedule_status <> 'proposed' THEN
        RETURN QUERY SELECT 409, jsonb_build_object('error','TASK_SCHEDULE_NOT_PROPOSED'), false;
        RETURN;
      END IF;
      IF v_schedule.ends_at <= p_now THEN
        RETURN QUERY SELECT 409, jsonb_build_object('error','TASK_SCHEDULE_INTERVAL_ALREADY_PASSED'), false;
        RETURN;
      END IF;
      v_needs_conflict_check := true;
    ELSIF p_mutation = 'cancel' THEN
      IF v_schedule.schedule_status NOT IN ('proposed','confirmed') THEN
        RETURN QUERY SELECT 409, jsonb_build_object('error','TASK_SCHEDULE_CANNOT_BE_CANCELLED'), false;
        RETURN;
      END IF;
    ELSIF p_mutation = 'release' THEN
      IF v_schedule.schedule_status <> 'confirmed' THEN
        RETURN QUERY SELECT 409, jsonb_build_object('error','TASK_SCHEDULE_CANNOT_BE_RELEASED'), false;
        RETURN;
      END IF;
    ELSIF p_mutation = 'mark_elapsed' THEN
      IF v_schedule.schedule_status <> 'confirmed' OR v_schedule.ends_at > p_now THEN
        RETURN QUERY SELECT 409, jsonb_build_object('error','TASK_SCHEDULE_NOT_ELAPSED'), false;
        RETURN;
      END IF;
    END IF;
  END IF;

  IF v_needs_conflict_check THEN
    IF EXISTS (
      SELECT 1 FROM (
        SELECT (item->>'id')::uuid AS id, (item->>'updated_at')::timestamptz AS updated_at
        FROM jsonb_array_elements(p_protected_time_snapshot) AS supplied(item)
      ) AS snapshot FULL OUTER JOIN (
        SELECT id,updated_at FROM public.protected_time_block
        WHERE owner_user_id=p_owner_user_id AND archived_at IS NULL AND deleted_at IS NULL
      ) AS current_rows USING(id)
      WHERE snapshot.id IS NULL OR current_rows.id IS NULL OR snapshot.updated_at IS DISTINCT FROM current_rows.updated_at
    ) THEN
      RETURN QUERY SELECT 409,jsonb_build_object('error','AGENDA_CONFLICTS_CHANGED'),false; RETURN;
    END IF;
    IF EXISTS (
      SELECT 1 FROM (
        SELECT (item->>'id')::uuid AS id, (item->>'updated_at')::timestamptz AS updated_at
        FROM jsonb_array_elements(p_calendar_event_snapshot) AS supplied(item)
      ) AS snapshot FULL OUTER JOIN (
        SELECT id,updated_at FROM public.calendar_event
        WHERE owner_user_id=p_owner_user_id AND event_status='confirmed'
          AND archived_at IS NULL AND deleted_at IS NULL
      ) AS current_rows USING(id)
      WHERE snapshot.id IS NULL OR current_rows.id IS NULL OR snapshot.updated_at IS DISTINCT FROM current_rows.updated_at
    ) THEN
      RETURN QUERY SELECT 409,jsonb_build_object('error','AGENDA_CONFLICTS_CHANGED'),false; RETURN;
    END IF;
    IF EXISTS (
      SELECT 1 FROM (
        SELECT (item->>'id')::uuid AS id, (item->>'updated_at')::timestamptz AS updated_at
        FROM jsonb_array_elements(p_task_schedule_snapshot) AS supplied(item)
      ) AS snapshot FULL OUTER JOIN (
        SELECT id,updated_at FROM public.task_schedule
        WHERE owner_user_id=p_owner_user_id AND schedule_status='confirmed' AND id<>p_task_schedule_id
      ) AS current_rows USING(id)
      WHERE snapshot.id IS NULL OR current_rows.id IS NULL OR snapshot.updated_at IS DISTINCT FROM current_rows.updated_at
    ) THEN
      RETURN QUERY SELECT 409,jsonb_build_object('error','AGENDA_CONFLICTS_CHANGED'),false; RETURN;
    END IF;
  END IF;

  -- CAS and conflict validation have passed; the idempotency claim is now safe.
  INSERT INTO public.task_schedule_mutation_request(owner_user_id,idempotency_key,task_schedule_id,payload_version,payload_hash)
  VALUES(p_owner_user_id,p_idempotency_key,p_task_schedule_id,p_payload_version,v_hash)
  ON CONFLICT(owner_user_id,idempotency_key) DO NOTHING;
  GET DIAGNOSTICS v_claimed = ROW_COUNT;
  IF v_claimed = 0 THEN
    RAISE EXCEPTION 'TaskSchedule receipt claim changed under the owner lock; retry same key' USING ERRCODE = '40001';
  END IF;

  IF p_mutation = 'create' THEN
    INSERT INTO public.task_schedule(
      id,owner_user_id,task_id,created_by_user_id,updated_by_user_id,time_zone,
      start_local,end_local,starts_at,ends_at,start_disambiguation,end_disambiguation,
      start_gap_strategy,end_gap_strategy,resolver_metadata,schedule_status,conflict_decisions,
      created_at,updated_at
    ) VALUES(
      p_task_schedule_id,p_owner_user_id,(p_schedule_patch->>'task_id')::uuid,p_owner_user_id,p_owner_user_id,
      p_schedule_patch->>'time_zone',(p_schedule_patch->>'start_local')::timestamp,
      (p_schedule_patch->>'end_local')::timestamp,(p_schedule_patch->>'starts_at')::timestamptz,
      (p_schedule_patch->>'ends_at')::timestamptz,p_schedule_patch->>'start_disambiguation',
      p_schedule_patch->>'end_disambiguation',p_schedule_patch->>'start_gap_strategy',
      p_schedule_patch->>'end_gap_strategy',p_schedule_patch->'resolver_metadata','proposed','[]'::jsonb,p_now,p_now
    ) RETURNING * INTO v_schedule;
    v_status := 201;
  ELSIF p_mutation = 'edit' THEN
    UPDATE public.task_schedule SET
      task_id=(p_schedule_patch->>'task_id')::uuid,
      time_zone=p_schedule_patch->>'time_zone',
      start_local=(p_schedule_patch->>'start_local')::timestamp,
      end_local=(p_schedule_patch->>'end_local')::timestamp,
      starts_at=(p_schedule_patch->>'starts_at')::timestamptz,
      ends_at=(p_schedule_patch->>'ends_at')::timestamptz,
      start_disambiguation=p_schedule_patch->>'start_disambiguation',
      end_disambiguation=p_schedule_patch->>'end_disambiguation',
      start_gap_strategy=p_schedule_patch->>'start_gap_strategy',
      end_gap_strategy=p_schedule_patch->>'end_gap_strategy',
      resolver_metadata=p_schedule_patch->'resolver_metadata',
      conflict_decisions=CASE WHEN v_schedule.schedule_status='confirmed' THEN p_conflict_decisions ELSE '[]'::jsonb END,
      updated_by_user_id=p_owner_user_id
    WHERE id=p_task_schedule_id AND owner_user_id=p_owner_user_id RETURNING * INTO v_schedule;
    v_status := 200;
  ELSIF p_mutation = 'confirm' THEN
    UPDATE public.task_schedule SET schedule_status='confirmed', conflict_decisions=p_conflict_decisions,
      updated_by_user_id=p_owner_user_id
    WHERE id=p_task_schedule_id AND owner_user_id=p_owner_user_id RETURNING * INTO v_schedule;
    v_status := 200;
  ELSIF p_mutation = 'cancel' THEN
    UPDATE public.task_schedule SET schedule_status='cancelled', cancelled_at=p_now,
      conflict_decisions='[]'::jsonb, updated_by_user_id=p_owner_user_id
    WHERE id=p_task_schedule_id AND owner_user_id=p_owner_user_id RETURNING * INTO v_schedule;
    v_status := 200;
  ELSIF p_mutation = 'release' THEN
    UPDATE public.task_schedule SET schedule_status='released', released_at=p_now,
      conflict_decisions='[]'::jsonb, updated_by_user_id=p_owner_user_id
    WHERE id=p_task_schedule_id AND owner_user_id=p_owner_user_id RETURNING * INTO v_schedule;
    v_status := 200;
  ELSE
    UPDATE public.task_schedule SET schedule_status='elapsed', elapsed_at=p_now,
      updated_by_user_id=p_owner_user_id
    WHERE id=p_task_schedule_id AND owner_user_id=p_owner_user_id RETURNING * INTO v_schedule;
    v_status := 200;
  END IF;

  v_body := jsonb_build_object(
    'taskScheduleId',v_schedule.id::text,'taskId',v_schedule.task_id::text,
    'updatedAt',to_char(v_schedule.updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'scheduleStatus',v_schedule.schedule_status,
    'startsAt',to_char(v_schedule.starts_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'endsAt',to_char(v_schedule.ends_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  );
  UPDATE public.task_schedule_mutation_request SET response_http_status=v_status,
    response_body=v_body,completed_at=clock_timestamp()
  WHERE owner_user_id=p_owner_user_id AND idempotency_key=p_idempotency_key;
  RETURN QUERY SELECT v_status,v_body,false;
END;
$function$;

ALTER FUNCTION public.mutate_task_schedule_once(uuid,uuid,uuid,text,text,timestamptz,text,jsonb,jsonb,jsonb,jsonb,jsonb,timestamptz) OWNER TO postgres;
REVOKE ALL PRIVILEGES ON FUNCTION public.mutate_task_schedule_once(uuid,uuid,uuid,text,text,timestamptz,text,jsonb,jsonb,jsonb,jsonb,jsonb,timestamptz)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mutate_task_schedule_once(uuid,uuid,uuid,text,text,timestamptz,text,jsonb,jsonb,jsonb,jsonb,jsonb,timestamptz)
  TO service_role;
