-- Idempotent rolling-horizon top-up for recurring Event occurrences.
-- Called only through the authenticated server path; no cron or hosted deployment is implied.

CREATE OR REPLACE FUNCTION public.materialize_recurring_calendar_event_once(
  p_owner_user_id uuid,
  p_series_event_id uuid,
  p_materialization_date date,
  p_occurrence_rows jsonb,
  p_protected_time_snapshot jsonb,
  p_task_schedule_snapshot jsonb
)
RETURNS integer
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_event public.calendar_event%ROWTYPE;
  v_inserted integer := 0;
  v_count integer;
BEGIN
  IF current_user <> 'service_role' THEN
    RAISE EXCEPTION 'materialize_recurring_calendar_event_once requires service_role'
      USING ERRCODE = '42501';
  END IF;

  IF p_owner_user_id IS NULL OR p_series_event_id IS NULL OR p_materialization_date IS NULL
     OR p_occurrence_rows IS NULL OR jsonb_typeof(p_occurrence_rows) IS DISTINCT FROM 'array'
     OR p_protected_time_snapshot IS NULL OR jsonb_typeof(p_protected_time_snapshot) IS DISTINCT FROM 'array'
     OR p_task_schedule_snapshot IS NULL OR jsonb_typeof(p_task_schedule_snapshot) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Owner, series, date, occurrence rows and owner snapshots are required'
      USING ERRCODE = '22023';
  END IF;

  v_count := jsonb_array_length(p_occurrence_rows);
  IF v_count < 1 OR v_count > 500
     OR jsonb_array_length(p_protected_time_snapshot) > 500
     OR jsonb_array_length(p_task_schedule_snapshot) > 500 THEN
    RAISE EXCEPTION 'Recurring Event materialization batch exceeds the 500-item bound'
      USING ERRCODE = '22023';
  END IF;

  -- Use the same owner lock as Event, Protected Time and TaskSchedule writers
  -- before taking any row locks, avoiding lock-order inversions across domains.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_owner_user_id::text, 8102026));

  SELECT * INTO v_event
  FROM public.calendar_event
  WHERE id = p_series_event_id AND owner_user_id = p_owner_user_id
  FOR UPDATE;
  IF NOT FOUND OR v_event.recurrence_rule IS NULL
     OR v_event.archived_at IS NOT NULL OR v_event.deleted_at IS NOT NULL
     OR v_event.event_status IN ('cancelled', 'finished') THEN
    RAISE EXCEPTION 'Active owner recurring Event series was not found'
      USING ERRCODE = 'P0002';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_occurrence_rows) AS item(value)
    WHERE jsonb_typeof(item.value) IS DISTINCT FROM 'object'
       OR (SELECT count(*) FROM jsonb_object_keys(item.value)) <> 29
       OR (item.value->>'owner_user_id')::uuid IS DISTINCT FROM p_owner_user_id
       OR (item.value->>'created_by_user_id')::uuid IS DISTINCT FROM p_owner_user_id
       OR (item.value->>'updated_by_user_id')::uuid IS DISTINCT FROM p_owner_user_id
       OR (item.value->>'calendar_event_id')::uuid IS DISTINCT FROM p_series_event_id
       OR item.value->>'occurrence_status' IS DISTINCT FROM 'scheduled'
       OR item.value->>'override_kind' IS NOT NULL
       OR item.value->'review_candidate' IS DISTINCT FROM 'null'::jsonb
       OR (item.value->>'row_version')::bigint IS DISTINCT FROM 1
       OR item.value->>'occurrence_key' NOT LIKE 'v1:' || p_series_event_id::text || ':%'
       OR (item.value->>'original_local_date')::date < p_materialization_date
       OR (item.value->>'original_local_date')::date > p_materialization_date + 89
       OR (v_event.recurrence_effective_from IS NOT NULL
         AND (item.value->>'original_local_date')::date < v_event.recurrence_effective_from)
       OR (v_event.recurrence_effective_through IS NOT NULL
         AND (item.value->>'original_local_date')::date > v_event.recurrence_effective_through)
       OR item.value->>'actual_local_date' IS DISTINCT FROM item.value->>'original_local_date'
       OR item.value->>'temporal_kind' IS DISTINCT FROM v_event.temporal_kind
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
    RAISE EXCEPTION 'Recurring Event top-up rows do not match the series, current horizon or authoritative time contract'
      USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    WITH actual AS (
      SELECT id, updated_at FROM public.protected_time_block
      WHERE owner_user_id = p_owner_user_id AND archived_at IS NULL AND deleted_at IS NULL
    ),
    supplied AS (
      SELECT id, updated_at
      FROM jsonb_to_recordset(p_protected_time_snapshot)
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
      FROM jsonb_to_recordset(p_task_schedule_snapshot)
        AS snapshot(id uuid, updated_at timestamptz)
    )
    SELECT 1 FROM actual FULL OUTER JOIN supplied USING (id)
    WHERE actual.id IS NULL OR supplied.id IS NULL OR actual.updated_at IS DISTINCT FROM supplied.updated_at
  ) THEN
    RAISE EXCEPTION 'Recurring Event materialization conflict snapshot changed; reload and retry'
      USING ERRCODE = '40001';
  END IF;

  INSERT INTO public.calendar_event_occurrence
  SELECT (jsonb_populate_record(NULL::public.calendar_event_occurrence, item.value)).*
  FROM jsonb_array_elements(p_occurrence_rows) AS item(value)
  ON CONFLICT (calendar_event_id, occurrence_key) DO NOTHING;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  RETURN v_inserted;
END;
$function$;

ALTER FUNCTION public.materialize_recurring_calendar_event_once(uuid, uuid, date, jsonb, jsonb, jsonb)
  OWNER TO postgres;
REVOKE ALL PRIVILEGES ON FUNCTION public.materialize_recurring_calendar_event_once(uuid, uuid, date, jsonb, jsonb, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.materialize_recurring_calendar_event_once(uuid, uuid, date, jsonb, jsonb, jsonb)
  TO service_role;
