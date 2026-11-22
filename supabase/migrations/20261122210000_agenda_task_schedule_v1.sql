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
