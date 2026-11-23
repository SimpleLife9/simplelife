-- Persist explicit series segment lineage and atomic scope edits.
-- Hosted DDL/deployment remains behind a separate Human Gate.

ALTER TABLE public.calendar_event
  ADD COLUMN recurrence_effective_from date,
  ADD COLUMN recurrence_effective_through date,
  ADD COLUMN recurrence_parent_event_id uuid,
  ADD COLUMN recurrence_inherited_occurrence_id uuid,
  ADD CONSTRAINT calendar_event_recurrence_segment_shape_check CHECK (
    (
      recurrence_rule IS NULL
      AND recurrence_effective_from IS NULL
      AND recurrence_effective_through IS NULL
      AND recurrence_parent_event_id IS NULL
      AND recurrence_inherited_occurrence_id IS NULL
    )
    OR (
      recurrence_rule IS NOT NULL
      AND (recurrence_effective_from IS NULL OR recurrence_effective_from >= (recurrence_rule->>'startDate')::date)
      AND (recurrence_effective_through IS NULL OR recurrence_effective_from IS NULL
        OR recurrence_effective_through >= recurrence_effective_from)
      AND ((recurrence_parent_event_id IS NULL AND recurrence_inherited_occurrence_id IS NULL)
        OR (recurrence_parent_event_id IS NOT NULL AND recurrence_inherited_occurrence_id IS NOT NULL))
    )
  ),
  ADD CONSTRAINT calendar_event_recurrence_parent_owner_fk
    FOREIGN KEY (recurrence_parent_event_id, owner_user_id)
    REFERENCES public.calendar_event(id, owner_user_id) ON DELETE RESTRICT,
  ADD CONSTRAINT calendar_event_recurrence_inherited_occurrence_owner_fk
    FOREIGN KEY (recurrence_inherited_occurrence_id, owner_user_id)
    REFERENCES public.calendar_event_occurrence(id, owner_user_id) ON DELETE RESTRICT;

CREATE INDEX calendar_event_recurrence_parent_idx
  ON public.calendar_event(owner_user_id, recurrence_parent_event_id)
  WHERE recurrence_parent_event_id IS NOT NULL;

CREATE OR REPLACE FUNCTION private.append_calendar_event_recurrence_audit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_changed_fields text[];
BEGIN
  IF TG_OP <> 'UPDATE' THEN RETURN NEW; END IF;

  SELECT coalesce(array_agg(field_name ORDER BY field_name), ARRAY[]::text[])
    INTO v_changed_fields
  FROM (VALUES
    ('recurrence_rule', to_jsonb(NEW.recurrence_rule), to_jsonb(OLD.recurrence_rule)),
    ('recurrence_end_local_time', to_jsonb(NEW.recurrence_end_local_time), to_jsonb(OLD.recurrence_end_local_time)),
    ('recurrence_end_day_offset', to_jsonb(NEW.recurrence_end_day_offset), to_jsonb(OLD.recurrence_end_day_offset)),
    ('recurrence_effective_from', to_jsonb(NEW.recurrence_effective_from), to_jsonb(OLD.recurrence_effective_from)),
    ('recurrence_effective_through', to_jsonb(NEW.recurrence_effective_through), to_jsonb(OLD.recurrence_effective_through)),
    ('recurrence_parent_event_id', to_jsonb(NEW.recurrence_parent_event_id), to_jsonb(OLD.recurrence_parent_event_id)),
    ('recurrence_inherited_occurrence_id', to_jsonb(NEW.recurrence_inherited_occurrence_id), to_jsonb(OLD.recurrence_inherited_occurrence_id))
  ) AS changed(field_name, new_value, old_value)
  WHERE new_value IS DISTINCT FROM old_value;

  IF cardinality(v_changed_fields) = 0 THEN RETURN NEW; END IF;

  INSERT INTO public.audit_event (
    id, account_user_id, actor_user_id, action, entity_type, entity_id,
    result, source, details, occurred_at, recorded_at
  ) VALUES (
    private.uuidv7(), NEW.owner_user_id, NEW.updated_by_user_id,
    'calendar_event.recurrence_updated', 'calendar_event', NEW.id,
    'success', 'user',
    jsonb_build_object(
      'changed_fields', to_jsonb(v_changed_fields),
      'recurrence_rule_before', OLD.recurrence_rule,
      'recurrence_rule_after', NEW.recurrence_rule,
      'effective_from_before', OLD.recurrence_effective_from,
      'effective_from_after', NEW.recurrence_effective_from,
      'effective_through_before', OLD.recurrence_effective_through,
      'effective_through_after', NEW.recurrence_effective_through,
      'parent_series_id', NEW.recurrence_parent_event_id,
      'inherited_occurrence_id', NEW.recurrence_inherited_occurrence_id
    ),
    clock_timestamp(), clock_timestamp()
  );
  RETURN NEW;
END;
$function$;

ALTER FUNCTION private.append_calendar_event_recurrence_audit() OWNER TO postgres;
REVOKE ALL PRIVILEGES ON FUNCTION private.append_calendar_event_recurrence_audit()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER calendar_event_recurrence_audit_append
  AFTER UPDATE ON public.calendar_event
  FOR EACH ROW EXECUTE FUNCTION private.append_calendar_event_recurrence_audit();

CREATE TABLE public.calendar_event_series_edit_request (
  owner_user_id uuid NOT NULL REFERENCES public.user_profile(id) ON DELETE RESTRICT,
  idempotency_key uuid NOT NULL,
  series_event_id uuid NOT NULL,
  payload_version text NOT NULL CHECK (payload_version = 'recurring-series-edit-v1'),
  payload_hash bytea NOT NULL CHECK (octet_length(payload_hash) = 32),
  response_http_status integer,
  response_body jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  PRIMARY KEY (owner_user_id, idempotency_key),
  CONSTRAINT calendar_event_series_edit_key_uuidv7_check
    CHECK ((get_byte(uuid_send(idempotency_key), 6) >> 4) = 7
      AND (get_byte(uuid_send(idempotency_key), 8) & 192) = 128),
  CONSTRAINT calendar_event_series_edit_series_uuidv7_check
    CHECK ((get_byte(uuid_send(series_event_id), 6) >> 4) = 7
      AND (get_byte(uuid_send(series_event_id), 8) & 192) = 128),
  CONSTRAINT calendar_event_series_edit_owner_fk
    FOREIGN KEY (series_event_id, owner_user_id)
    REFERENCES public.calendar_event(id, owner_user_id) ON DELETE RESTRICT,
  CONSTRAINT calendar_event_series_edit_receipt_check CHECK (
    (response_http_status IS NULL AND response_body IS NULL AND completed_at IS NULL)
    OR (response_http_status IN (200, 409) AND response_body IS NOT NULL AND completed_at IS NOT NULL)
  )
);

ALTER TABLE public.calendar_event_series_edit_request ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.calendar_event_series_edit_request
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.calendar_event_series_edit_request TO service_role;

COMMENT ON TABLE public.calendar_event_series_edit_request IS
  'Server-only UUIDv7 idempotency receipts for atomic recurring-series scope edits.';

CREATE OR REPLACE FUNCTION public.mutate_recurring_calendar_event_once(
  p_owner_user_id uuid,
  p_series_event_id uuid,
  p_idempotency_key uuid,
  p_payload_hash_hex text,
  p_expected_updated_at timestamptz,
  p_scope text,
  p_selected_occurrence_id uuid,
  p_materialization_date date,
  p_series_patch jsonb,
  p_new_series_record jsonb,
  p_occurrence_rows jsonb,
  p_protected_time_snapshot jsonb,
  p_task_schedule_snapshot jsonb,
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
  v_current public.calendar_event%ROWTYPE;
  v_next public.calendar_event%ROWTYPE;
  v_child public.calendar_event%ROWTYPE;
  v_selected public.calendar_event_occurrence%ROWTYPE;
  v_existing public.calendar_event_series_edit_request%ROWTYPE;
  v_payload_hash bytea;
  v_claimed integer;
  v_updated integer := 0;
  v_inserted integer := 0;
  v_superseded integer := 0;
  v_target_series_id uuid;
  v_horizon_end date;
  v_response jsonb;
BEGIN
  IF current_user <> 'service_role' THEN
    RAISE EXCEPTION 'mutate_recurring_calendar_event_once requires service_role'
      USING ERRCODE = '42501';
  END IF;

  IF p_owner_user_id IS NULL OR p_series_event_id IS NULL OR p_idempotency_key IS NULL
     OR p_expected_updated_at IS NULL OR p_materialization_date IS NULL OR p_now IS NULL
     OR p_selected_occurrence_id IS NULL THEN
    RAISE EXCEPTION 'Verified owner, series, selected occurrence, key, version and timestamps are required'
      USING ERRCODE = '22023';
  END IF;
  IF (get_byte(uuid_send(p_idempotency_key), 6) >> 4) <> 7
     OR (get_byte(uuid_send(p_idempotency_key), 8) & 192) <> 128 THEN
    RAISE EXCEPTION 'Series edit idempotency key must be UUIDv7' USING ERRCODE = '22023';
  END IF;
  IF p_payload_hash_hex IS NULL OR p_payload_hash_hex !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Series edit payload hash must be 64 lowercase SHA-256 hexadecimal characters'
      USING ERRCODE = '22023';
  END IF;
  IF p_scope NOT IN ('entire_series', 'this_and_following') THEN
    RAISE EXCEPTION 'Series edit scope must be entire_series or this_and_following'
      USING ERRCODE = '22023';
  END IF;
  IF p_series_patch IS NULL OR jsonb_typeof(p_series_patch) IS DISTINCT FROM 'object'
     OR p_occurrence_rows IS NULL OR jsonb_typeof(p_occurrence_rows) IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_occurrence_rows) > 90
     OR p_protected_time_snapshot IS NULL OR jsonb_typeof(p_protected_time_snapshot) IS DISTINCT FROM 'array'
     OR p_task_schedule_snapshot IS NULL OR jsonb_typeof(p_task_schedule_snapshot) IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_protected_time_snapshot) > 500
     OR jsonb_array_length(p_task_schedule_snapshot) > 500 THEN
    RAISE EXCEPTION 'Series edit patch, rows or conflict snapshots are malformed or exceed bounds'
      USING ERRCODE = '22023';
  END IF;
  IF (p_scope = 'entire_series' AND p_new_series_record IS NOT NULL)
     OR (p_scope = 'this_and_following' AND (
       p_new_series_record IS NULL OR jsonb_typeof(p_new_series_record) IS DISTINCT FROM 'object'
     )) THEN
    RAISE EXCEPTION 'Split scope requires exactly one child series record; entire-series does not'
      USING ERRCODE = '22023';
  END IF;

  v_payload_hash := decode(p_payload_hash_hex, 'hex');
  v_horizon_end := p_materialization_date + 89;

  -- Every Agenda writer uses this same owner lock before row locks.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_owner_user_id::text, 8102026));

  SELECT * INTO v_existing
  FROM public.calendar_event_series_edit_request
  WHERE owner_user_id = p_owner_user_id AND idempotency_key = p_idempotency_key
  FOR UPDATE;
  IF FOUND THEN
    IF v_existing.series_event_id IS DISTINCT FROM p_series_event_id
       OR v_existing.payload_version IS DISTINCT FROM 'recurring-series-edit-v1'
       OR v_existing.payload_hash IS DISTINCT FROM v_payload_hash THEN
      RETURN QUERY SELECT 409, jsonb_build_object('error', 'IDEMPOTENCY_KEY_REUSED'), false;
      RETURN;
    END IF;
    IF v_existing.response_http_status IS NULL OR v_existing.response_body IS NULL THEN
      RAISE EXCEPTION 'Committed series edit receipt is incomplete' USING ERRCODE = '55000';
    END IF;
    RETURN QUERY SELECT v_existing.response_http_status, v_existing.response_body, true;
    RETURN;
  END IF;

  SELECT * INTO v_current
  FROM public.calendar_event
  WHERE id = p_series_event_id AND owner_user_id = p_owner_user_id
  FOR UPDATE;
  IF NOT FOUND OR v_current.recurrence_rule IS NULL
     OR v_current.archived_at IS NOT NULL OR v_current.deleted_at IS NOT NULL
     OR v_current.event_status IN ('cancelled', 'finished') THEN
    RETURN QUERY SELECT 404, jsonb_build_object('error', 'RECURRING_SERIES_NOT_FOUND'), false;
    RETURN;
  END IF;
  IF v_current.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RETURN QUERY SELECT 409, jsonb_build_object(
      'error', 'RECURRING_SERIES_VERSION_CONFLICT',
      'updatedAt', v_current.updated_at
    ), false;
    RETURN;
  END IF;

  SELECT * INTO v_selected
  FROM public.calendar_event_occurrence
  WHERE id = p_selected_occurrence_id
    AND owner_user_id = p_owner_user_id
    AND calendar_event_id = p_series_event_id
  FOR UPDATE;
  IF NOT FOUND OR v_selected.original_local_date < p_materialization_date
     OR v_selected.occurrence_status <> 'scheduled'
     OR v_selected.override_kind IS NOT NULL
     OR v_selected.review_candidate IS NOT NULL THEN
    RETURN QUERY SELECT 409, jsonb_build_object('error', 'SERIES_EDIT_OCCURRENCE_NOT_EDITABLE'), false;
    RETURN;
  END IF;

  IF v_selected.original_local_date < greatest(p_materialization_date, coalesce(v_current.recurrence_effective_from, (v_current.recurrence_rule->>'startDate')::date))
     OR (v_current.recurrence_effective_through IS NOT NULL
       AND v_selected.original_local_date > v_current.recurrence_effective_through) THEN
    RETURN QUERY SELECT 409, jsonb_build_object('error', 'SERIES_EDIT_OCCURRENCE_OUTSIDE_ACTIVE_SEGMENT'), false;
    RETURN;
  END IF;

  -- Recheck complete active owner sets under the shared lock.
  IF EXISTS (
    WITH actual AS (
      SELECT id, updated_at FROM public.protected_time_block
      WHERE owner_user_id = p_owner_user_id AND archived_at IS NULL AND deleted_at IS NULL
    ),
    supplied AS (
      SELECT id, updated_at FROM jsonb_to_recordset(p_protected_time_snapshot)
        AS snapshot(id uuid, updated_at timestamptz)
    )
    SELECT 1 FROM actual FULL OUTER JOIN supplied USING(id)
    WHERE actual.id IS NULL OR supplied.id IS NULL OR actual.updated_at IS DISTINCT FROM supplied.updated_at
  ) OR EXISTS (
    WITH actual AS (
      SELECT id, updated_at FROM public.task_schedule
      WHERE owner_user_id = p_owner_user_id AND schedule_status IN ('proposed','confirmed')
    ),
    supplied AS (
      SELECT id, updated_at FROM jsonb_to_recordset(p_task_schedule_snapshot)
        AS snapshot(id uuid, updated_at timestamptz)
    )
    SELECT 1 FROM actual FULL OUTER JOIN supplied USING(id)
    WHERE actual.id IS NULL OR supplied.id IS NULL OR actual.updated_at IS DISTINCT FROM supplied.updated_at
  ) THEN
    RAISE EXCEPTION 'Recurring series edit conflict snapshot changed; reload and retry'
      USING ERRCODE = '40001';
  END IF;

  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_occurrence_rows) AS item(value)
    WHERE jsonb_typeof(item.value) IS DISTINCT FROM 'object'
       OR (item.value->>'owner_user_id')::uuid IS DISTINCT FROM p_owner_user_id
       OR (item.value->>'created_by_user_id')::uuid IS DISTINCT FROM p_owner_user_id
       OR (item.value->>'updated_by_user_id')::uuid IS DISTINCT FROM p_owner_user_id
       OR (item.value->>'calendar_event_id')::uuid IS DISTINCT FROM
         CASE WHEN p_scope = 'entire_series' THEN p_series_event_id
              ELSE (p_new_series_record->>'id')::uuid END
       OR item.value->>'occurrence_status' IS DISTINCT FROM 'scheduled'
       OR item.value->>'override_kind' IS NOT NULL
       OR item.value->'review_candidate' IS DISTINCT FROM 'null'::jsonb
       OR (item.value->>'original_local_date')::date < greatest(p_materialization_date, v_selected.original_local_date)
       OR (item.value->>'original_local_date')::date > v_horizon_end
       OR (p_scope = 'this_and_following'
         AND (item.value->>'original_local_date')::date = v_selected.original_local_date)
  ) THEN
    RAISE EXCEPTION 'Series edit occurrence batch includes invalid identity or dates outside its forward horizon'
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.calendar_event_series_edit_request (
    owner_user_id, idempotency_key, series_event_id, payload_version, payload_hash
  ) VALUES (
    p_owner_user_id, p_idempotency_key, p_series_event_id,
    'recurring-series-edit-v1', v_payload_hash
  );

  IF p_scope = 'entire_series' THEN
    IF p_series_patch->>'recurrence_rule' IS NULL
       OR jsonb_typeof(p_series_patch->'recurrence_rule') IS DISTINCT FROM 'object'
       OR p_series_patch->'recurrence_rule'->>'startDate' IS DISTINCT FROM v_selected.original_local_date::text
       OR p_series_patch->'recurrence_rule'->>'temporalKind' IS DISTINCT FROM v_current.temporal_kind THEN
      RAISE EXCEPTION 'Entire-series replacement rule must keep temporal kind and anchor at the selected date'
        USING ERRCODE = '22023';
    END IF;

    SELECT (jsonb_populate_record(v_current, p_series_patch)).* INTO v_next;
    IF v_next.id IS DISTINCT FROM v_current.id
       OR v_next.owner_user_id IS DISTINCT FROM p_owner_user_id
       OR v_next.created_by_user_id IS DISTINCT FROM v_current.created_by_user_id
       OR v_next.created_at IS DISTINCT FROM v_current.created_at
       OR v_next.updated_by_user_id IS DISTINCT FROM p_owner_user_id
       OR v_next.recurrence_effective_from IS DISTINCT FROM v_selected.original_local_date THEN
      RAISE EXCEPTION 'Entire-series patch changed immutable identity or has the wrong effective boundary'
        USING ERRCODE = '22023';
    END IF;

    UPDATE public.calendar_event
    SET title = v_next.title,
        description = v_next.description,
        location_label = v_next.location_label,
        location_kind = v_next.location_kind,
        event_status = v_next.event_status,
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
        recurrence_rule = v_next.recurrence_rule,
        recurrence_end_local_time = v_next.recurrence_end_local_time,
        recurrence_end_day_offset = v_next.recurrence_end_day_offset,
        recurrence_effective_from = v_next.recurrence_effective_from,
        updated_by_user_id = p_owner_user_id
    WHERE id = p_series_event_id AND owner_user_id = p_owner_user_id
      AND updated_at = p_expected_updated_at;

    IF NOT FOUND THEN
      RETURN QUERY SELECT 409, jsonb_build_object('error', 'RECURRING_SERIES_VERSION_CONFLICT'), false;
      RETURN;
    END IF;

    v_target_series_id := p_series_event_id;

    -- Future scheduled rows that no longer occur are tombstoned as superseded.
    UPDATE public.calendar_event_occurrence AS existing
    SET occurrence_status = 'superseded',
        updated_by_user_id = p_owner_user_id
    WHERE existing.calendar_event_id = p_series_event_id
      AND existing.owner_user_id = p_owner_user_id
      AND existing.original_local_date >= v_selected.original_local_date
      AND existing.original_local_date <= v_horizon_end
      AND existing.occurrence_status = 'scheduled'
      AND existing.override_kind IS NULL
      AND existing.review_candidate IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(p_occurrence_rows) AS candidate(value)
        WHERE (candidate.value->>'original_local_date')::date = existing.original_local_date
      );

    GET DIAGNOSTICS v_superseded = ROW_COUNT;

    -- Retain stable row ID/key/original slot for same-date future occurrences.
    UPDATE public.calendar_event_occurrence AS existing
    SET actual_local_date = candidate.value->>'actual_local_date',
        actual_local_time = nullif(candidate.value->>'actual_local_time', '')::time,
        start_date = nullif(candidate.value->>'start_date', '')::date,
        end_date_exclusive = nullif(candidate.value->>'end_date_exclusive', '')::date,
        start_local = nullif(candidate.value->>'start_local', '')::timestamp,
        end_local = nullif(candidate.value->>'end_local', '')::timestamp,
        time_zone = candidate.value->>'time_zone',
        starts_at = nullif(candidate.value->>'starts_at', '')::timestamptz,
        ends_at = nullif(candidate.value->>'ends_at', '')::timestamptz,
        start_disambiguation = candidate.value->>'start_disambiguation',
        end_disambiguation = candidate.value->>'end_disambiguation',
        start_gap_strategy = candidate.value->>'start_gap_strategy',
        end_gap_strategy = candidate.value->>'end_gap_strategy',
        resolver_metadata = candidate.value->'resolver_metadata',
        occurrence_status = 'scheduled',
        override_kind = NULL,
        review_candidate = NULL,
        updated_by_user_id = p_owner_user_id
    FROM jsonb_array_elements(p_occurrence_rows) AS candidate(value)
    WHERE existing.calendar_event_id = p_series_event_id
      AND existing.owner_user_id = p_owner_user_id
      AND existing.original_local_date = (candidate.value->>'original_local_date')::date
      AND existing.occurrence_status = 'scheduled'
      AND existing.override_kind IS NULL
      AND existing.review_candidate IS NULL;

    GET DIAGNOSTICS v_updated = ROW_COUNT;

    INSERT INTO public.calendar_event_occurrence
    SELECT (jsonb_populate_record(NULL::public.calendar_event_occurrence, candidate.value)).*
    FROM jsonb_array_elements(p_occurrence_rows) AS candidate(value)
    WHERE NOT EXISTS (
      SELECT 1 FROM public.calendar_event_occurrence existing
      WHERE existing.calendar_event_id = p_series_event_id
        AND existing.owner_user_id = p_owner_user_id
        AND existing.original_local_date = (candidate.value->>'original_local_date')::date
    )
    ON CONFLICT (calendar_event_id, occurrence_key) DO NOTHING;
    GET DIAGNOSTICS v_inserted = ROW_COUNT;
  ELSE
    IF p_series_patch->>'recurrence_effective_through' IS DISTINCT FROM v_selected.original_local_date::text THEN
      RAISE EXCEPTION 'The previous series segment must end on the selected inherited occurrence date'
        USING ERRCODE = '22023';
    END IF;

    SELECT * INTO v_child
    FROM jsonb_populate_record(NULL::public.calendar_event, p_new_series_record);
    IF v_child.id IS NULL OR v_child.id = p_series_event_id
       OR (get_byte(uuid_send(v_child.id), 6) >> 4) <> 7
       OR v_child.owner_user_id IS DISTINCT FROM p_owner_user_id
       OR v_child.created_by_user_id IS DISTINCT FROM p_owner_user_id
       OR v_child.updated_by_user_id IS DISTINCT FROM p_owner_user_id
       OR v_child.recurrence_parent_event_id IS DISTINCT FROM p_series_event_id
       OR v_child.recurrence_inherited_occurrence_id IS DISTINCT FROM p_selected_occurrence_id
       OR v_child.recurrence_effective_from IS DISTINCT FROM v_selected.original_local_date
       OR v_child.recurrence_rule IS NULL
       OR NOT (v_child.recurrence_rule->'excludedDates' @> jsonb_build_array(v_selected.original_local_date::text))
       OR v_child.recurrence_rule->>'startDate' IS DISTINCT FROM v_selected.original_local_date::text THEN
      RAISE EXCEPTION 'Split child series must inherit the selected occurrence and exclude its original slot'
        USING ERRCODE = '22023';
    END IF;

    UPDATE public.calendar_event
    SET recurrence_effective_through = v_selected.original_local_date,
        updated_by_user_id = p_owner_user_id
    WHERE id = p_series_event_id AND owner_user_id = p_owner_user_id
      AND updated_at = p_expected_updated_at;
    IF NOT FOUND THEN
      RETURN QUERY SELECT 409, jsonb_build_object('error', 'RECURRING_SERIES_VERSION_CONFLICT'), false;
      RETURN;
    END IF;

    UPDATE public.calendar_event_occurrence
    SET occurrence_status = 'superseded',
        updated_by_user_id = p_owner_user_id
    WHERE calendar_event_id = p_series_event_id
      AND owner_user_id = p_owner_user_id
      AND original_local_date > v_selected.original_local_date
      AND original_local_date <= v_horizon_end
      AND occurrence_status = 'scheduled'
      AND override_kind IS NULL
      AND review_candidate IS NULL;

    GET DIAGNOSTICS v_superseded = ROW_COUNT;
    v_target_series_id := v_child.id;

    INSERT INTO public.calendar_event
    SELECT (jsonb_populate_record(NULL::public.calendar_event, p_new_series_record)).*;

    INSERT INTO public.calendar_event_occurrence
    SELECT (jsonb_populate_record(NULL::public.calendar_event_occurrence, candidate.value)).*
    FROM jsonb_array_elements(p_occurrence_rows) AS candidate(value)
    ON CONFLICT (calendar_event_id, occurrence_key) DO NOTHING;
    GET DIAGNOSTICS v_inserted = ROW_COUNT;
  END IF;

  v_response := jsonb_build_object(
    'seriesEventId', p_series_event_id::text,
    'scope', p_scope,
    'childSeriesEventId', CASE WHEN p_scope = 'this_and_following' THEN v_target_series_id::text ELSE NULL END,
    'selectedOccurrenceId', p_selected_occurrence_id::text,
    'materializedCount', v_inserted + v_updated,
    'supersededCount', v_superseded,
    'updatedAt', (SELECT updated_at FROM public.calendar_event WHERE id = p_series_event_id AND owner_user_id = p_owner_user_id)
  );

  UPDATE public.calendar_event_series_edit_request
  SET response_http_status = 200,
      response_body = v_response,
      completed_at = p_now
  WHERE owner_user_id = p_owner_user_id AND idempotency_key = p_idempotency_key;

  RETURN QUERY SELECT 200, v_response, false;
END;
$function$;

ALTER FUNCTION public.mutate_recurring_calendar_event_once(uuid, uuid, uuid, text, timestamptz, text, uuid, date, jsonb, jsonb, jsonb, jsonb, jsonb, timestamptz)
  OWNER TO postgres;
REVOKE ALL PRIVILEGES ON FUNCTION public.mutate_recurring_calendar_event_once(uuid, uuid, uuid, text, timestamptz, text, uuid, date, jsonb, jsonb, jsonb, jsonb, jsonb, timestamptz)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mutate_recurring_calendar_event_once(uuid, uuid, uuid, text, timestamptz, text, uuid, date, jsonb, jsonb, jsonb, jsonb, jsonb, timestamptz)
  TO service_role;
