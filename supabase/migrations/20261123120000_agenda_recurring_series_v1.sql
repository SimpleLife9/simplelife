-- Recurring Event series and bounded occurrence persistence.
-- This migration is exercised only by the disposable local Supabase CI stack.
-- It does not authorize hosted DDL, Edge deployment, cron, or release.

ALTER TABLE public.calendar_event
  ADD COLUMN recurrence_rule jsonb,
  ADD COLUMN recurrence_end_local_time time without time zone,
  ADD COLUMN recurrence_end_day_offset smallint,
  ADD CONSTRAINT calendar_event_recurrence_shape_check CHECK (
    (
      recurrence_rule IS NULL
      AND recurrence_end_local_time IS NULL
      AND recurrence_end_day_offset IS NULL
    )
    OR
    (
      jsonb_typeof(recurrence_rule) = 'object'
      AND recurrence_rule->>'version' = '1'
      AND recurrence_rule->>'temporalKind' = temporal_kind
      AND temporal_kind IN ('all_day', 'zoned_civil')
      AND recurrence_end_day_offset BETWEEN 0 AND 30
      AND (
        (temporal_kind = 'all_day' AND recurrence_end_local_time IS NULL)
        OR
        (temporal_kind = 'zoned_civil' AND recurrence_end_local_time IS NOT NULL)
      )
    )
  );

COMMENT ON COLUMN public.calendar_event.recurrence_rule IS
  'Versioned v1 recurring civil-time instruction. NULL means a one-off Event.';
COMMENT ON COLUMN public.calendar_event.recurrence_end_local_time IS
  'Explicit local end clock for timed recurring series; never inferred from durationMinutes.';
COMMENT ON COLUMN public.calendar_event.recurrence_end_day_offset IS
  'Calendar-day offset from each occurrence start to its explicit local end; for all-day rows, end_date_exclusive is offset + 1.';

CREATE TABLE public.calendar_event_occurrence (
  id uuid PRIMARY KEY,
  owner_user_id uuid NOT NULL REFERENCES public.user_profile(id) ON DELETE RESTRICT,
  created_by_user_id uuid NOT NULL REFERENCES public.user_profile(id) ON DELETE RESTRICT,
  updated_by_user_id uuid NOT NULL REFERENCES public.user_profile(id) ON DELETE RESTRICT,
  calendar_event_id uuid NOT NULL,

  occurrence_key text NOT NULL CHECK (length(occurrence_key) BETWEEN 1 AND 250),
  original_local_date date NOT NULL,
  original_local_time time without time zone,
  actual_local_date date NOT NULL,
  actual_local_time time without time zone,
  temporal_kind text NOT NULL CHECK (temporal_kind IN ('all_day', 'zoned_civil')),

  start_date date,
  end_date_exclusive date,
  start_local timestamp without time zone,
  end_local timestamp without time zone,
  time_zone text,
  starts_at timestamptz,
  ends_at timestamptz,
  start_disambiguation text CHECK (start_disambiguation IS NULL OR start_disambiguation IN ('earlier', 'later')),
  end_disambiguation text CHECK (end_disambiguation IS NULL OR end_disambiguation IN ('earlier', 'later')),
  start_gap_strategy text CHECK (start_gap_strategy IS NULL OR start_gap_strategy = 'next-valid'),
  end_gap_strategy text CHECK (end_gap_strategy IS NULL OR end_gap_strategy = 'next-valid'),
  resolver_metadata jsonb,

  occurrence_status text NOT NULL DEFAULT 'scheduled'
    CHECK (occurrence_status IN ('scheduled', 'completed', 'cancelled', 'skipped', 'needs_review', 'superseded')),
  override_kind text CHECK (override_kind IS NULL OR override_kind IN ('cancelled', 'moved', 'modified')),
  review_candidate jsonb CHECK (review_candidate IS NULL OR jsonb_typeof(review_candidate) = 'object'),
  row_version bigint NOT NULL DEFAULT 1 CHECK (row_version >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT calendar_event_occurrence_id_uuidv7_check
    CHECK ((get_byte(uuid_send(id), 6) >> 4) = 7 AND (get_byte(uuid_send(id), 8) & 192) = 128),
  CONSTRAINT calendar_event_occurrence_owner_actor_check
    CHECK (owner_user_id = created_by_user_id AND owner_user_id = updated_by_user_id),
  CONSTRAINT calendar_event_occurrence_event_owner_fk
    FOREIGN KEY (calendar_event_id, owner_user_id)
    REFERENCES public.calendar_event (id, owner_user_id) ON DELETE RESTRICT,
  CONSTRAINT calendar_event_occurrence_owner_identity_uq UNIQUE (id, owner_user_id),
  CONSTRAINT calendar_event_occurrence_series_key_uq UNIQUE (calendar_event_id, occurrence_key),
  CONSTRAINT calendar_event_occurrence_temporal_shape_check CHECK (
    (
      temporal_kind = 'all_day'
      AND original_local_time IS NULL
      AND actual_local_time IS NULL
      AND start_date IS NOT NULL
      AND end_date_exclusive IS NOT NULL
      AND isfinite(start_date)
      AND isfinite(end_date_exclusive)
      AND end_date_exclusive > start_date
      AND start_date = actual_local_date
      AND start_local IS NULL
      AND end_local IS NULL
      AND time_zone IS NULL
      AND starts_at IS NULL
      AND ends_at IS NULL
      AND start_disambiguation IS NULL
      AND end_disambiguation IS NULL
      AND start_gap_strategy IS NULL
      AND end_gap_strategy IS NULL
      AND resolver_metadata IS NULL
    )
    OR
    (
      temporal_kind = 'zoned_civil'
      AND original_local_time IS NOT NULL
      AND actual_local_time IS NOT NULL
      AND start_date IS NULL
      AND end_date_exclusive IS NULL
      AND start_local IS NOT NULL
      AND end_local IS NOT NULL
      AND isfinite(start_local)
      AND isfinite(end_local)
      AND time_zone IS NOT NULL
      AND length(btrim(time_zone)) BETWEEN 1 AND 100
      AND starts_at IS NOT NULL
      AND ends_at IS NOT NULL
      AND isfinite(starts_at)
      AND isfinite(ends_at)
      AND ends_at > starts_at
      AND start_disambiguation IS NOT NULL
      AND end_disambiguation IS NOT NULL
      AND start_gap_strategy = 'next-valid'
      AND end_gap_strategy = 'next-valid'
      AND jsonb_typeof(resolver_metadata) = 'object'
      AND resolver_metadata->>'rulesSource' = 'iana-tzdb'
      AND resolver_metadata->>'authoritative' = 'true'
      AND length(coalesce(resolver_metadata->>'rulesVersion', '')) > 0
      AND length(coalesce(resolver_metadata->>'resolverVersion', '')) > 0
    )
  )
);

CREATE INDEX calendar_event_occurrence_owner_all_day_idx
  ON public.calendar_event_occurrence (owner_user_id, start_date, end_date_exclusive)
  WHERE temporal_kind = 'all_day' AND occurrence_status IN ('scheduled', 'needs_review');

CREATE INDEX calendar_event_occurrence_owner_timed_idx
  ON public.calendar_event_occurrence (owner_user_id, starts_at, ends_at)
  WHERE temporal_kind = 'zoned_civil' AND occurrence_status IN ('scheduled', 'needs_review');

CREATE INDEX calendar_event_occurrence_series_status_idx
  ON public.calendar_event_occurrence (calendar_event_id, occurrence_status, original_local_date);

ALTER TABLE public.calendar_event_occurrence ENABLE ROW LEVEL SECURITY;
CREATE POLICY calendar_event_occurrence_read_self
  ON public.calendar_event_occurrence
  FOR SELECT
  TO authenticated
  USING (
    owner_user_id IN (
      SELECT id FROM public.user_profile
      WHERE auth_user_id = (SELECT auth.uid())
    )
  );

REVOKE ALL PRIVILEGES ON TABLE public.calendar_event_occurrence
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.calendar_event_occurrence TO authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.calendar_event_occurrence TO service_role;

COMMENT ON TABLE public.calendar_event_occurrence IS
  'Owner-private, materialized civil-time occurrences for recurring calendar_event series. One-off Events have no occurrence rows.';
COMMENT ON COLUMN public.calendar_event_occurrence.occurrence_key IS
  'Stable v1 identity derived from series ID + original local date/time; excludes UTC offsets, TZDB versions and fold choices.';
COMMENT ON COLUMN public.calendar_event_occurrence.review_candidate IS
  'Version-bound proposed resolution. Existing confirmed UTC instants remain unchanged until explicit user acceptance.';

CREATE OR REPLACE FUNCTION private.touch_calendar_event_occurrence_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $function$
BEGIN
  NEW.updated_at := GREATEST(clock_timestamp(), OLD.updated_at + interval '1 microsecond');
  NEW.row_version := OLD.row_version + 1;
  RETURN NEW;
END;
$function$;

ALTER FUNCTION private.touch_calendar_event_occurrence_updated_at() OWNER TO postgres;
REVOKE ALL PRIVILEGES ON FUNCTION private.touch_calendar_event_occurrence_updated_at()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER calendar_event_occurrence_touch_updated_at
  BEFORE UPDATE ON public.calendar_event_occurrence
  FOR EACH ROW EXECUTE FUNCTION private.touch_calendar_event_occurrence_updated_at();

CREATE OR REPLACE FUNCTION private.append_calendar_event_occurrence_audit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_changed_fields text[];
  v_details jsonb;
BEGIN
  IF NEW.owner_user_id IS NULL
     OR NEW.created_by_user_id IS NULL
     OR NEW.updated_by_user_id IS NULL
     OR NEW.owner_user_id <> NEW.created_by_user_id
     OR NEW.owner_user_id <> NEW.updated_by_user_id THEN
    RAISE EXCEPTION 'Occurrence owner and actor fields must match the verified owner';
  END IF;

  IF TG_OP = 'INSERT' THEN
    v_details := jsonb_build_object(
      'changed_fields', to_jsonb(ARRAY['created']::text[]),
      'calendar_event_id', NEW.calendar_event_id,
      'occurrence_key', NEW.occurrence_key,
      'occurrence_status_after', NEW.occurrence_status,
      'temporal_kind', NEW.temporal_kind,
      'rules_version', NEW.resolver_metadata->>'rulesVersion'
    );
    INSERT INTO public.audit_event (
      id, account_user_id, actor_user_id, action, entity_type, entity_id,
      result, source, details, occurred_at, recorded_at
    ) VALUES (
      private.uuidv7(), NEW.owner_user_id, NEW.updated_by_user_id,
      'calendar_event_occurrence.created', 'calendar_event_occurrence', NEW.id,
      'success', 'user', v_details, clock_timestamp(), clock_timestamp()
    );
    RETURN NEW;
  END IF;

  IF TG_OP <> 'UPDATE' THEN
    RAISE EXCEPTION 'Unsupported calendar_event_occurrence audit operation: %', TG_OP;
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.owner_user_id IS DISTINCT FROM OLD.owner_user_id
     OR NEW.created_by_user_id IS DISTINCT FROM OLD.created_by_user_id
     OR NEW.calendar_event_id IS DISTINCT FROM OLD.calendar_event_id
     OR NEW.occurrence_key IS DISTINCT FROM OLD.occurrence_key
     OR NEW.original_local_date IS DISTINCT FROM OLD.original_local_date
     OR NEW.original_local_time IS DISTINCT FROM OLD.original_local_time
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Occurrence identity, owner, original civil slot and creation time are immutable';
  END IF;

  SELECT coalesce(array_agg(k ORDER BY k), ARRAY[]::text[])
    INTO v_changed_fields
  FROM jsonb_object_keys(to_jsonb(NEW)) AS keys(k)
  WHERE k NOT IN ('updated_at', 'row_version')
    AND (to_jsonb(NEW)->k) IS DISTINCT FROM (to_jsonb(OLD)->k);

  IF cardinality(v_changed_fields) = 0 THEN
    RETURN NEW;
  END IF;

  v_details := jsonb_build_object(
    'changed_fields', to_jsonb(v_changed_fields),
    'calendar_event_id', NEW.calendar_event_id,
    'occurrence_key', NEW.occurrence_key,
    'occurrence_status_before', OLD.occurrence_status,
    'occurrence_status_after', NEW.occurrence_status,
    'override_kind_before', OLD.override_kind,
    'override_kind_after', NEW.override_kind,
    'resolver_rules_version_before', OLD.resolver_metadata->>'rulesVersion',
    'resolver_rules_version_after', NEW.resolver_metadata->>'rulesVersion',
    'review_candidate', NEW.review_candidate
  );
  INSERT INTO public.audit_event (
    id, account_user_id, actor_user_id, action, entity_type, entity_id,
    result, source, details, occurred_at, recorded_at
  ) VALUES (
    private.uuidv7(), NEW.owner_user_id, NEW.updated_by_user_id,
    'calendar_event_occurrence.updated', 'calendar_event_occurrence', NEW.id,
    'success', 'user', v_details, clock_timestamp(), clock_timestamp()
  );
  RETURN NEW;
END;
$function$;

ALTER FUNCTION private.append_calendar_event_occurrence_audit() OWNER TO postgres;
REVOKE ALL PRIVILEGES ON FUNCTION private.append_calendar_event_occurrence_audit()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER calendar_event_occurrence_append_audit
  AFTER INSERT OR UPDATE ON public.calendar_event_occurrence
  FOR EACH ROW EXECUTE FUNCTION private.append_calendar_event_occurrence_audit();

CREATE TABLE public.calendar_event_series_mutation_request (
  owner_user_id uuid NOT NULL REFERENCES public.user_profile(id) ON DELETE RESTRICT,
  idempotency_key uuid NOT NULL,
  series_event_id uuid NOT NULL,
  payload_version text NOT NULL CHECK (payload_version = 'recurring-event-create-v1'),
  payload_hash bytea NOT NULL CHECK (octet_length(payload_hash) = 32),
  response_http_status integer,
  response_body jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  PRIMARY KEY (owner_user_id, idempotency_key),
  CONSTRAINT calendar_event_series_mutation_key_uuidv7_check
    CHECK ((get_byte(uuid_send(idempotency_key), 6) >> 4) = 7
      AND (get_byte(uuid_send(idempotency_key), 8) & 192) = 128),
  CONSTRAINT calendar_event_series_mutation_series_uuidv7_check
    CHECK ((get_byte(uuid_send(series_event_id), 6) >> 4) = 7
      AND (get_byte(uuid_send(series_event_id), 8) & 192) = 128),
  CONSTRAINT calendar_event_series_mutation_response_check
    CHECK (
      (response_http_status IS NULL AND response_body IS NULL AND completed_at IS NULL)
      OR (response_http_status IN (201, 409)
        AND response_body IS NOT NULL AND completed_at IS NOT NULL)
    )
);

ALTER TABLE public.calendar_event_series_mutation_request ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.calendar_event_series_mutation_request
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.calendar_event_series_mutation_request TO service_role;

COMMENT ON TABLE public.calendar_event_series_mutation_request IS
  'Server-only idempotency receipts for recurring Event series creation.';

CREATE OR REPLACE FUNCTION public.create_recurring_calendar_event_once(
  p_owner_user_id uuid,
  p_idempotency_key uuid,
  p_payload_hash_hex text,
  p_event_record jsonb,
  p_occurrence_rows jsonb,
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
  v_existing public.calendar_event_series_mutation_request%ROWTYPE;
  v_occurrence_count integer;
  v_claimed_rows integer;
  v_payload_hash bytea;
  v_response jsonb;
  v_recurrence_anchor date;
BEGIN
  IF current_user <> 'service_role' THEN
    RAISE EXCEPTION 'create_recurring_calendar_event_once requires service_role'
      USING ERRCODE = '42501';
  END IF;

  IF p_owner_user_id IS NULL OR p_idempotency_key IS NULL OR p_now IS NULL THEN
    RAISE EXCEPTION 'Verified owner, UUIDv7 idempotency key and timestamp are required'
      USING ERRCODE = '22023';
  END IF;
  IF (get_byte(uuid_send(p_idempotency_key), 6) >> 4) <> 7
     OR (get_byte(uuid_send(p_idempotency_key), 8) & 192) <> 128 THEN
    RAISE EXCEPTION 'Idempotency key must be UUIDv7' USING ERRCODE = '22023';
  END IF;
  IF p_payload_hash_hex IS NULL OR p_payload_hash_hex !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Payload hash must be 64 lowercase SHA-256 hexadecimal characters'
      USING ERRCODE = '22023';
  END IF;
  v_payload_hash := decode(p_payload_hash_hex, 'hex');

  IF p_event_record IS NULL OR jsonb_typeof(p_event_record) IS DISTINCT FROM 'object'
     OR (SELECT count(*) FROM jsonb_object_keys(p_event_record)) <> 34
     OR EXISTS (
       SELECT 1 FROM jsonb_object_keys(p_event_record) AS supplied(key)
       WHERE supplied.key <> ALL (ARRAY[
         'id','owner_user_id','created_by_user_id','updated_by_user_id',
         'title','description','location_label','location_kind','event_status','temporal_kind',
         'start_date','end_date_exclusive','start_local','end_local','time_zone','starts_at','ends_at',
         'start_disambiguation','end_disambiguation','start_gap_strategy','end_gap_strategy',
         'archived_at','deleted_at','purge_after','created_at','updated_at',
         'protected_time_decisions','protected_time_snapshot','task_schedule_conflict_decisions',
         'task_schedule_snapshot','task_schedule_window',
         'recurrence_rule','recurrence_end_local_time','recurrence_end_day_offset'
       ]::text[])
     ) THEN
    RAISE EXCEPTION 'Recurring Event record contains missing or unsupported fields'
      USING ERRCODE = '22023';
  END IF;

  IF jsonb_typeof(p_event_record->'recurrence_rule') IS DISTINCT FROM 'object'
     OR p_event_record->'recurrence_rule'->>'version' IS DISTINCT FROM '1'
     OR p_event_record->'recurrence_rule'->>'temporalKind' IS DISTINCT FROM p_event_record->>'temporal_kind'
     OR (p_event_record->>'recurrence_end_day_offset')::integer NOT BETWEEN 0 AND 30
     OR jsonb_typeof(p_event_record->'protected_time_snapshot') IS DISTINCT FROM 'array'
     OR jsonb_typeof(p_event_record->'task_schedule_snapshot') IS DISTINCT FROM 'array'
     OR jsonb_typeof(p_event_record->'protected_time_decisions') IS DISTINCT FROM 'array'
     OR jsonb_typeof(p_event_record->'task_schedule_conflict_decisions') IS DISTINCT FROM 'array'
     OR jsonb_typeof(p_event_record->'task_schedule_window') IS DISTINCT FROM 'object'
     OR jsonb_typeof(p_occurrence_rows) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Recurring Event rule, conflict evidence or occurrence rows are malformed'
      USING ERRCODE = '22023';
  END IF;

  v_occurrence_count := jsonb_array_length(p_occurrence_rows);
  IF v_occurrence_count < 1 OR v_occurrence_count > 500
     OR jsonb_array_length(p_event_record->'protected_time_snapshot') > 500
     OR jsonb_array_length(p_event_record->'task_schedule_snapshot') > 500
     OR jsonb_array_length(p_event_record->'protected_time_decisions') > 500
     OR jsonb_array_length(p_event_record->'task_schedule_conflict_decisions') > 500 THEN
    RAISE EXCEPTION 'Recurring Event occurrence/conflict batches exceed the 500-item bound'
      USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_occurrence_rows) AS item(value)
    WHERE jsonb_typeof(item.value) IS DISTINCT FROM 'object'
       OR (SELECT count(*) FROM jsonb_object_keys(item.value)) <> 29
       OR EXISTS (
         SELECT 1 FROM jsonb_object_keys(item.value) AS supplied(key)
         WHERE supplied.key <> ALL (ARRAY[
           'id','owner_user_id','created_by_user_id','updated_by_user_id','calendar_event_id',
           'occurrence_key','original_local_date','original_local_time','actual_local_date','actual_local_time',
           'temporal_kind','start_date','end_date_exclusive','start_local','end_local','time_zone',
           'starts_at','ends_at','start_disambiguation','end_disambiguation','start_gap_strategy','end_gap_strategy',
           'resolver_metadata','occurrence_status','override_kind','review_candidate','row_version','created_at','updated_at'
         ]::text[])
       )
  ) THEN
    RAISE EXCEPTION 'A materialized occurrence contains missing or unsupported fields'
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_event
  FROM jsonb_populate_record(NULL::public.calendar_event, p_event_record);

  IF v_event.temporal_kind = 'all_day' THEN
    v_recurrence_anchor := v_event.start_date;
  ELSIF v_event.temporal_kind = 'zoned_civil' THEN
    v_recurrence_anchor := v_event.start_local::date;
  END IF;

  IF v_event.id IS NULL
     OR (get_byte(uuid_send(v_event.id), 6) >> 4) <> 7
     OR (get_byte(uuid_send(v_event.id), 8) & 192) <> 128
     OR v_event.owner_user_id IS DISTINCT FROM p_owner_user_id
     OR v_event.created_by_user_id IS DISTINCT FROM p_owner_user_id
     OR v_event.updated_by_user_id IS DISTINCT FROM p_owner_user_id
     OR v_event.event_status NOT IN ('preparing', 'proposed', 'confirmed')
     OR v_event.archived_at IS NOT NULL OR v_event.deleted_at IS NOT NULL OR v_event.purge_after IS NOT NULL
     OR v_event.recurrence_rule IS NULL
     OR v_event.recurrence_end_day_offset NOT BETWEEN 0 AND 30
     OR v_event.recurrence_rule->>'startDate' IS DISTINCT FROM v_recurrence_anchor::text THEN
    RAISE EXCEPTION 'Recurring Event identity, owner or recurrence anchor is invalid'
      USING ERRCODE = '22023';
  END IF;

  IF (v_event.temporal_kind = 'all_day' AND (
       v_event.recurrence_end_local_time IS NOT NULL
       OR v_event.end_date_exclusive IS DISTINCT FROM
         (v_event.start_date + v_event.recurrence_end_day_offset + 1)
     ))
     OR (v_event.temporal_kind = 'zoned_civil' AND (
       v_event.recurrence_end_local_time IS NULL
       OR v_event.time_zone IS DISTINCT FROM v_event.recurrence_rule->>'timeZone'
       OR v_event.start_local::time IS DISTINCT FROM (v_event.recurrence_rule->>'localTime')::time
       OR v_event.end_local::time IS DISTINCT FROM v_event.recurrence_end_local_time
       OR v_event.end_local::date IS DISTINCT FROM
         (v_event.start_local::date + v_event.recurrence_end_day_offset)
     )) THEN
    RAISE EXCEPTION 'Recurring Event master local start/end do not match its recurrence rule'
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.calendar_event_series_mutation_request (
    owner_user_id, idempotency_key, series_event_id, payload_version, payload_hash
  ) VALUES (
    p_owner_user_id, p_idempotency_key, v_event.id, 'recurring-event-create-v1', v_payload_hash
  )
  ON CONFLICT (owner_user_id, idempotency_key) DO NOTHING;
  GET DIAGNOSTICS v_claimed_rows = ROW_COUNT;

  IF v_claimed_rows = 0 THEN
    SELECT * INTO v_existing
    FROM public.calendar_event_series_mutation_request
    WHERE owner_user_id = p_owner_user_id AND idempotency_key = p_idempotency_key
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Concurrent recurring Event claim is not visible; retry the same key'
        USING ERRCODE = '40001';
    END IF;
    IF v_existing.payload_version IS DISTINCT FROM 'recurring-event-create-v1'
       OR v_existing.payload_hash IS DISTINCT FROM v_payload_hash THEN
      RETURN QUERY SELECT 409, jsonb_build_object('error', 'IDEMPOTENCY_KEY_REUSED'), false;
      RETURN;
    END IF;
    IF v_existing.response_http_status IS NULL OR v_existing.response_body IS NULL THEN
      RAISE EXCEPTION 'Committed recurring Event receipt is incomplete' USING ERRCODE = '55000';
    END IF;
    RETURN QUERY SELECT v_existing.response_http_status, v_existing.response_body, true;
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_occurrence_rows) AS item(value)
    WHERE item.value->>'calendar_event_id' IS DISTINCT FROM v_event.id::text
       OR item.value->>'owner_user_id' IS DISTINCT FROM p_owner_user_id::text
       OR item.value->>'created_by_user_id' IS DISTINCT FROM p_owner_user_id::text
       OR item.value->>'updated_by_user_id' IS DISTINCT FROM p_owner_user_id::text
       OR item.value->>'occurrence_status' IS DISTINCT FROM 'scheduled'
       OR item.value->>'override_kind' IS NOT NULL
       OR item.value->'review_candidate' IS DISTINCT FROM 'null'::jsonb
       OR (item.value->>'row_version')::bigint IS DISTINCT FROM 1
       OR item.value->>'temporal_kind' IS DISTINCT FROM v_event.temporal_kind
       OR item.value->>'occurrence_key' NOT LIKE 'v1:' || v_event.id::text || ':%'
       OR item.value->>'actual_local_date' IS DISTINCT FROM item.value->>'original_local_date'
       OR (
         v_event.temporal_kind = 'all_day'
         AND (
           item.value->>'original_local_time' IS NOT NULL
           OR item.value->>'actual_local_time' IS NOT NULL
           OR item.value->>'start_date' IS DISTINCT FROM item.value->>'actual_local_date'
           OR item.value->>'end_date_exclusive' IS DISTINCT FROM
             ((item.value->>'actual_local_date')::date + v_event.recurrence_end_day_offset + 1)::text
           OR item.value->>'starts_at' IS NOT NULL
           OR item.value->>'ends_at' IS NOT NULL
           OR item.value->>'time_zone' IS NOT NULL
         )
       )
       OR (
         v_event.temporal_kind = 'zoned_civil'
         AND (
           (item.value->>'original_local_time')::time IS DISTINCT FROM (v_event.recurrence_rule->>'localTime')::time
           OR (item.value->>'actual_local_time')::time IS DISTINCT FROM (v_event.recurrence_rule->>'localTime')::time
           OR (item.value->>'start_local')::timestamp IS DISTINCT FROM
             ((item.value->>'original_local_date')::date + (v_event.recurrence_rule->>'localTime')::time)
           OR (item.value->>'end_local')::timestamp IS DISTINCT FROM
             (((item.value->>'original_local_date')::date + v_event.recurrence_end_day_offset)
               + v_event.recurrence_end_local_time)
           OR item.value->>'time_zone' IS DISTINCT FROM v_event.time_zone
           OR (item.value->>'starts_at')::timestamptz >= (item.value->>'ends_at')::timestamptz
           OR item.value->'resolver_metadata'->>'rulesSource' IS DISTINCT FROM 'iana-tzdb'
           OR item.value->'resolver_metadata'->>'authoritative' IS DISTINCT FROM 'true'
           OR nullif(item.value->'resolver_metadata'->>'rulesVersion', '') IS NULL
           OR nullif(item.value->'resolver_metadata'->>'resolverVersion', '') IS NULL
         )
       )
  ) THEN
    RAISE EXCEPTION 'Recurring Event occurrence rows do not match the master rule or authoritative time contract'
      USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_owner_user_id::text, 8102026));

  -- Recheck the full owner snapshots after the shared lock. The Edge handler
  -- performed conflict analysis for every occurrence; no other Event,
  -- Protected Time or TaskSchedule writer can change these sets until commit.
  IF EXISTS (
    WITH actual AS (
      SELECT id, updated_at FROM public.protected_time_block
      WHERE owner_user_id = p_owner_user_id AND archived_at IS NULL AND deleted_at IS NULL
    ),
    supplied AS (
      SELECT id, updated_at
      FROM jsonb_to_recordset(p_event_record->'protected_time_snapshot')
        AS snapshot(id uuid, updated_at timestamptz)
    )
    SELECT 1 FROM actual FULL OUTER JOIN supplied USING (id)
    WHERE actual.id IS NULL OR supplied.id IS NULL OR actual.updated_at IS DISTINCT FROM supplied.updated_at
  ) OR EXISTS (
    WITH actual AS (
      SELECT id, updated_at FROM public.task_schedule
      WHERE owner_user_id = p_owner_user_id AND schedule_status IN ('proposed', 'confirmed')
    ),
    supplied AS (
      SELECT id, updated_at
      FROM jsonb_to_recordset(p_event_record->'task_schedule_snapshot')
        AS snapshot(id uuid, updated_at timestamptz)
    )
    SELECT 1 FROM actual FULL OUTER JOIN supplied USING (id)
    WHERE actual.id IS NULL OR supplied.id IS NULL OR actual.updated_at IS DISTINCT FROM supplied.updated_at
  ) THEN
    RAISE EXCEPTION 'Recurring Event conflict snapshot changed; reload and retry'
      USING ERRCODE = '40001';
  END IF;

  INSERT INTO public.calendar_event
  SELECT (jsonb_populate_record(NULL::public.calendar_event, p_event_record)).*;

  INSERT INTO public.calendar_event_occurrence
  SELECT (jsonb_populate_record(NULL::public.calendar_event_occurrence, item.value)).*
  FROM jsonb_array_elements(p_occurrence_rows) AS item(value);

  v_response := jsonb_build_object(
    'seriesEventId', v_event.id::text,
    'materializedCount', v_occurrence_count,
    'horizonStart', (
      SELECT min(original_local_date)::text
      FROM public.calendar_event_occurrence
      WHERE calendar_event_id = v_event.id AND owner_user_id = p_owner_user_id
    ),
    'horizonEnd', (
      SELECT max(original_local_date)::text
      FROM public.calendar_event_occurrence
      WHERE calendar_event_id = v_event.id AND owner_user_id = p_owner_user_id
    )
  );

  UPDATE public.calendar_event_series_mutation_request
  SET response_http_status = 201,
      response_body = v_response,
      completed_at = p_now
  WHERE owner_user_id = p_owner_user_id AND idempotency_key = p_idempotency_key;

  RETURN QUERY SELECT 201, v_response, false;
END;
$function$;

ALTER FUNCTION public.create_recurring_calendar_event_once(uuid, uuid, text, jsonb, jsonb, timestamptz)
  OWNER TO postgres;
REVOKE ALL PRIVILEGES ON FUNCTION public.create_recurring_calendar_event_once(uuid, uuid, text, jsonb, jsonb, timestamptz)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_recurring_calendar_event_once(uuid, uuid, text, jsonb, jsonb, timestamptz)
  TO service_role;
