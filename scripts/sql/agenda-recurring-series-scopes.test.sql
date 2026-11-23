-- Ephemeral PostgreSQL coverage for atomic recurring-series scope mutations.
-- Exercises actual RLS grants, row-version CAS, stable identities and audit triggers.
-- All fixtures are rolled back; no hosted database is touched.

BEGIN;

INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data
) VALUES (
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'series-scope-owner@example.invalid',
  '', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb
) ON CONFLICT (id) DO NOTHING;

INSERT INTO public.user_profile (id, auth_user_id, display_name)
VALUES ('019a0000-0000-7000-8000-000000000001',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Series scope owner')
ON CONFLICT (id) DO NOTHING;

-- Test-only audit probe. service_role intentionally has no direct audit SELECT grant.
CREATE SCHEMA agenda_series_scope_test_helpers AUTHORIZATION postgres;
REVOKE ALL ON SCHEMA agenda_series_scope_test_helpers FROM PUBLIC;
GRANT USAGE ON SCHEMA agenda_series_scope_test_helpers TO service_role;

CREATE FUNCTION agenda_series_scope_test_helpers.series_scope_audit_count(
  p_owner uuid,
  p_entity_type text,
  p_entity_id uuid,
  p_actions text[]
)
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
  SELECT count(*)::bigint
  FROM public.audit_event
  WHERE account_user_id = p_owner
    AND (p_entity_type IS NULL OR entity_type = p_entity_type)
    AND (p_entity_id IS NULL OR entity_id = p_entity_id)
    AND (p_actions IS NULL OR action = ANY(p_actions));
$function$;
ALTER FUNCTION agenda_series_scope_test_helpers.series_scope_audit_count(uuid, text, uuid, text[]) OWNER TO postgres;
-- service_role receives only EXECUTE on the narrow SECURITY DEFINER test probe.
REVOKE ALL PRIVILEGES ON FUNCTION agenda_series_scope_test_helpers.series_scope_audit_count(uuid, text, uuid, text[])
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION agenda_series_scope_test_helpers.series_scope_audit_count(uuid, text, uuid, text[])
  TO service_role;

SET LOCAL ROLE service_role;

DO $test$
DECLARE
  v_owner uuid := '019a0000-0000-7000-8000-000000000001';
  v_series uuid := '019a0000-0000-7000-8000-000000000101';
  v_occ_24 uuid := '019a0000-0000-7000-8000-000000000102';
  v_occ_25 uuid := '019a0000-0000-7000-8000-000000000103';
  v_occ_26 uuid := '019a0000-0000-7000-8000-000000000104';
  v_child uuid := '019a0000-0000-7000-8000-000000000105';
  v_now timestamptz := '2026-11-23T12:00:00Z';
  v_rule jsonb := jsonb_build_object(
    'version', 1, 'frequency', 'DAILY', 'interval', 1,
    'startDate', '2026-11-24', 'temporalKind', 'all_day',
    'count', 3, 'excludedDates', '[]'::jsonb
  );
  v_edited_rule jsonb := jsonb_build_object(
    'version', 1, 'frequency', 'DAILY', 'interval', 2,
    'startDate', '2026-11-24', 'temporalKind', 'all_day',
    'count', 3, 'excludedDates', '[]'::jsonb
  );
  v_child_rule jsonb := jsonb_build_object(
    'version', 1, 'frequency', 'DAILY', 'interval', 1,
    'startDate', '2026-11-26', 'temporalKind', 'all_day',
    'count', 3, 'excludedDates', jsonb_build_array('2026-11-26')
  );
  v_rows jsonb;
  v_patch jsonb;
  v_child_record jsonb;
  v_result record;
  v_updated_at timestamptz;
  v_seen bigint;
  v_audit bigint;
  v_original_key text;
BEGIN
  IF has_table_privilege('service_role', 'public.audit_event', 'SELECT') THEN
    RAISE EXCEPTION 'Series mutation must not widen service_role audit table privileges';
  END IF;

  INSERT INTO public.calendar_event (
    id, owner_user_id, created_by_user_id, updated_by_user_id,
    title, event_status, temporal_kind, start_date, end_date_exclusive,
    recurrence_rule, recurrence_end_local_time, recurrence_end_day_offset,
    protected_time_decisions, task_schedule_conflict_decisions,
    created_at, updated_at
  ) VALUES (
    v_series, v_owner, v_owner, v_owner,
    'Daily check-in', 'confirmed', 'all_day',
    '2026-11-24', '2026-11-25',
    v_rule, NULL, 0,
    '[]'::jsonb, '[]'::jsonb,
    v_now, v_now
  );

  INSERT INTO public.calendar_event_occurrence (
    id, owner_user_id, created_by_user_id, updated_by_user_id,
    calendar_event_id, occurrence_key,
    original_local_date, original_local_time, actual_local_date, actual_local_time,
    temporal_kind, start_date, end_date_exclusive,
    start_local, end_local, time_zone, starts_at, ends_at,
    start_disambiguation, end_disambiguation, start_gap_strategy, end_gap_strategy,
    resolver_metadata, occurrence_status, override_kind, review_candidate,
    row_version, created_at, updated_at
  ) VALUES
  (
    v_occ_24, v_owner, v_owner, v_owner, v_series,
    'v1:' || v_series::text || ':2026-11-24:ALL_DAY',
    '2026-11-24', NULL, '2026-11-24', NULL,
    'all_day', '2026-11-24', '2026-11-25',
    NULL, NULL, NULL, NULL, NULL,
    NULL, NULL, NULL, NULL, NULL,
    'scheduled', NULL, NULL, 1, v_now, v_now
  ),
  (
    v_occ_25, v_owner, v_owner, v_owner, v_series,
    'v1:' || v_series::text || ':2026-11-25:ALL_DAY',
    '2026-11-25', NULL, '2026-11-25', NULL,
    'all_day', '2026-11-25', '2026-11-26',
    NULL, NULL, NULL, NULL, NULL,
    NULL, NULL, NULL, NULL, NULL,
    'scheduled', NULL, NULL, 1, v_now, v_now
  ),
  (
    v_occ_26, v_owner, v_owner, v_owner, v_series,
    'v1:' || v_series::text || ':2026-11-26:ALL_DAY',
    '2026-11-26', NULL, '2026-11-26', NULL,
    'all_day', '2026-11-26', '2026-11-27',
    NULL, NULL, NULL, NULL, NULL,
    NULL, NULL, NULL, NULL, NULL,
    'scheduled', NULL, NULL, 1, v_now, v_now
  );

  SELECT occurrence_key INTO v_original_key
  FROM public.calendar_event_occurrence WHERE id = v_occ_24;

  -- "Entire series": update the rule from the selected future occurrence,
  -- keep same-date row identity, insert new slots, and supersede obsolete ones.
  v_rows := jsonb_build_array(
    jsonb_build_object(
      'id', '019a0000-0000-7000-8000-000000000201',
      'owner_user_id', v_owner, 'created_by_user_id', v_owner, 'updated_by_user_id', v_owner,
      'calendar_event_id', v_series,
      'occurrence_key', 'v1:' || v_series::text || ':2026-11-24:ALL_DAY',
      'original_local_date', '2026-11-24', 'original_local_time', NULL,
      'actual_local_date', '2026-11-24', 'actual_local_time', NULL, 'temporal_kind', 'all_day',
      'start_date', '2026-11-24', 'end_date_exclusive', '2026-11-25',
      'start_local', NULL, 'end_local', NULL, 'time_zone', NULL, 'starts_at', NULL, 'ends_at', NULL,
      'start_disambiguation', NULL, 'end_disambiguation', NULL,
      'start_gap_strategy', NULL, 'end_gap_strategy', NULL, 'resolver_metadata', NULL,
      'occurrence_status', 'scheduled', 'override_kind', NULL, 'review_candidate', NULL,
      'row_version', 1, 'created_at', v_now, 'updated_at', v_now
    ),
    jsonb_build_object(
      'id', '019a0000-0000-7000-8000-000000000202',
      'owner_user_id', v_owner, 'created_by_user_id', v_owner, 'updated_by_user_id', v_owner,
      'calendar_event_id', v_series,
      'occurrence_key', 'v1:' || v_series::text || ':2026-11-26:ALL_DAY',
      'original_local_date', '2026-11-26', 'original_local_time', NULL,
      'actual_local_date', '2026-11-26', 'actual_local_time', NULL, 'temporal_kind', 'all_day',
      'start_date', '2026-11-26', 'end_date_exclusive', '2026-11-27',
      'start_local', NULL, 'end_local', NULL, 'time_zone', NULL, 'starts_at', NULL, 'ends_at', NULL,
      'start_disambiguation', NULL, 'end_disambiguation', NULL,
      'start_gap_strategy', NULL, 'end_gap_strategy', NULL, 'resolver_metadata', NULL,
      'occurrence_status', 'scheduled', 'override_kind', NULL, 'review_candidate', NULL,
      'row_version', 1, 'created_at', v_now, 'updated_at', v_now
    ),
    jsonb_build_object(
      'id', '019a0000-0000-7000-8000-000000000203',
      'owner_user_id', v_owner, 'created_by_user_id', v_owner, 'updated_by_user_id', v_owner,
      'calendar_event_id', v_series,
      'occurrence_key', 'v1:' || v_series::text || ':2026-11-28:ALL_DAY',
      'original_local_date', '2026-11-28', 'original_local_time', NULL,
      'actual_local_date', '2026-11-28', 'actual_local_time', NULL, 'temporal_kind', 'all_day',
      'start_date', '2026-11-28', 'end_date_exclusive', '2026-11-29',
      'start_local', NULL, 'end_local', NULL, 'time_zone', NULL, 'starts_at', NULL, 'ends_at', NULL,
      'start_disambiguation', NULL, 'end_disambiguation', NULL,
      'start_gap_strategy', NULL, 'end_gap_strategy', NULL, 'resolver_metadata', NULL,
      'occurrence_status', 'scheduled', 'override_kind', NULL, 'review_candidate', NULL,
      'row_version', 1, 'created_at', v_now, 'updated_at', v_now
    )
  );
  v_patch := jsonb_build_object(
    'title', 'Edited every other day',
    'start_date', '2026-11-24',
    'end_date_exclusive', '2026-11-25',
    'recurrence_rule', v_edited_rule,
    'recurrence_end_local_time', NULL,
    'recurrence_end_day_offset', 0,
    'recurrence_effective_from', '2026-11-24',
    'recurrence_effective_through', NULL,
    'updated_by_user_id', v_owner,
    'protected_time_decisions', '[]'::jsonb,
    'task_schedule_conflict_decisions', '[]'::jsonb
  );
  SELECT * INTO v_result
  FROM public.mutate_recurring_calendar_event_once(
    v_owner, v_series, '019a0000-0000-7000-8000-000000000301',
    repeat('a', 64), v_now, 'entire_series', v_occ_24,
    '2026-11-23', v_patch, NULL, v_rows, '[]'::jsonb, '[]'::jsonb, v_now
  );
  IF v_result.http_status <> 200 OR v_result.replayed
     OR v_result.response_body->>'scope' <> 'entire_series'
     OR (v_result.response_body->>'materializedCount')::integer <> 3
     OR (v_result.response_body->>'supersededCount')::integer <> 1 THEN
    RAISE EXCEPTION 'Entire-series edit did not reconcile its future slots correctly: %', row_to_json(v_result);
  END IF;

  SELECT count(*) INTO v_seen FROM public.calendar_event_occurrence
  WHERE id = v_occ_24 AND calendar_event_id = v_series AND occurrence_status = 'scheduled';
  IF v_seen <> 1 THEN RAISE EXCEPTION 'Selected occurrence identity/status must be retained'; END IF;
  IF (SELECT occurrence_key FROM public.calendar_event_occurrence WHERE id = v_occ_24) <> v_original_key THEN
    RAISE EXCEPTION 'Entire-series edit must retain selected occurrence stable key';
  END IF;
  SELECT count(*) INTO v_seen FROM public.calendar_event_occurrence
  WHERE id = v_occ_25 AND occurrence_status = 'superseded';
  IF v_seen <> 1 THEN RAISE EXCEPTION 'Obsolete scheduled future row must become superseded'; END IF;

  SELECT updated_at INTO v_updated_at FROM public.calendar_event
  WHERE id = v_series AND owner_user_id = v_owner;
  -- Same key + payload replays; it must not append further audit rows.
  SELECT * INTO v_result
  FROM public.mutate_recurring_calendar_event_once(
    v_owner, v_series, '019a0000-0000-7000-8000-000000000301',
    repeat('a', 64), v_now, 'entire_series', v_occ_24,
    '2026-11-23', v_patch, NULL, v_rows, '[]'::jsonb, '[]'::jsonb, v_now
  );
  IF v_result.http_status <> 200 OR NOT v_result.replayed THEN
    RAISE EXCEPTION 'Entire-series idempotent retry did not replay its winning receipt';
  END IF;

  -- "This and following": the selected row stays on the parent, linked from
  -- a child segment whose rule excludes that inherited date to prevent a duplicate.
  v_child_rule := jsonb_build_object(
    'version', 1, 'frequency', 'DAILY', 'interval', 1,
    'startDate', '2026-11-26', 'temporalKind', 'all_day',
    'count', 3, 'excludedDates', jsonb_build_array('2026-11-26')
  );
  v_rows := jsonb_build_array(
    jsonb_build_object(
      'id', '019a0000-0000-7000-8000-000000000211',
      'owner_user_id', v_owner, 'created_by_user_id', v_owner, 'updated_by_user_id', v_owner,
      'calendar_event_id', v_child,
      'occurrence_key', 'v1:' || v_child::text || ':2026-11-27:ALL_DAY',
      'original_local_date', '2026-11-27', 'original_local_time', NULL,
      'actual_local_date', '2026-11-27', 'actual_local_time', NULL, 'temporal_kind', 'all_day',
      'start_date', '2026-11-27', 'end_date_exclusive', '2026-11-28',
      'start_local', NULL, 'end_local', NULL, 'time_zone', NULL, 'starts_at', NULL, 'ends_at', NULL,
      'start_disambiguation', NULL, 'end_disambiguation', NULL,
      'start_gap_strategy', NULL, 'end_gap_strategy', NULL, 'resolver_metadata', NULL,
      'occurrence_status', 'scheduled', 'override_kind', NULL, 'review_candidate', NULL,
      'row_version', 1, 'created_at', v_now, 'updated_at', v_now
    ),
    jsonb_build_object(
      'id', '019a0000-0000-7000-8000-000000000212',
      'owner_user_id', v_owner, 'created_by_user_id', v_owner, 'updated_by_user_id', v_owner,
      'calendar_event_id', v_child,
      'occurrence_key', 'v1:' || v_child::text || ':2026-11-28:ALL_DAY',
      'original_local_date', '2026-11-28', 'original_local_time', NULL,
      'actual_local_date', '2026-11-28', 'actual_local_time', NULL, 'temporal_kind', 'all_day',
      'start_date', '2026-11-28', 'end_date_exclusive', '2026-11-29',
      'start_local', NULL, 'end_local', NULL, 'time_zone', NULL, 'starts_at', NULL, 'ends_at', NULL,
      'start_disambiguation', NULL, 'end_disambiguation', NULL,
      'start_gap_strategy', NULL, 'end_gap_strategy', NULL, 'resolver_metadata', NULL,
      'occurrence_status', 'scheduled', 'override_kind', NULL, 'review_candidate', NULL,
      'row_version', 1, 'created_at', v_now, 'updated_at', v_now
    )
  );
  SELECT to_jsonb(event_row) INTO v_child_record
  FROM public.calendar_event AS event_row
  WHERE id = v_series AND owner_user_id = v_owner;
  v_child_record := v_child_record || jsonb_build_object(
    'id', v_child,
    'title', 'Follow-on daily check-in',
    'start_date', '2026-11-26',
    'end_date_exclusive', '2026-11-27',
    'recurrence_rule', v_child_rule,
    'recurrence_end_local_time', NULL,
    'recurrence_end_day_offset', 0,
    'recurrence_effective_from', '2026-11-26',
    'recurrence_effective_through', NULL,
    'recurrence_parent_event_id', v_series,
    'recurrence_inherited_occurrence_id', v_occ_26,
    'created_at', v_now,
    'updated_at', v_now,
    'created_by_user_id', v_owner,
    'updated_by_user_id', v_owner,
    'protected_time_decisions', '[]'::jsonb,
    'task_schedule_conflict_decisions', '[]'::jsonb
  );
  SELECT updated_at INTO v_updated_at FROM public.calendar_event
  WHERE id = v_series AND owner_user_id = v_owner;
  v_patch := jsonb_build_object(
    'recurrence_effective_through', '2026-11-26',
    'updated_by_user_id', v_owner
  );
  SELECT * INTO v_result
  FROM public.mutate_recurring_calendar_event_once(
    v_owner, v_series, '019a0000-0000-7000-8000-000000000302',
    repeat('b', 64), v_updated_at, 'this_and_following', v_occ_26,
    '2026-11-23', v_patch, v_child_record, v_rows, '[]'::jsonb, '[]'::jsonb, v_now
  );
  IF v_result.http_status <> 200 OR v_result.replayed
     OR v_result.response_body->>'childSeriesEventId' <> v_child::text
     OR (v_result.response_body->>'materializedCount')::integer <> 2 THEN
    RAISE EXCEPTION 'This-and-following split failed: %', row_to_json(v_result);
  END IF;

  SELECT count(*) INTO v_seen FROM public.calendar_event
  WHERE id = v_child AND owner_user_id = v_owner
    AND recurrence_parent_event_id = v_series
    AND recurrence_inherited_occurrence_id = v_occ_26
    AND recurrence_effective_from = '2026-11-26'
    AND recurrence_rule->'excludedDates' @> jsonb_build_array('2026-11-26');
  IF v_seen <> 1 THEN RAISE EXCEPTION 'Child segment lineage/inherited slot is missing'; END IF;
  SELECT count(*) INTO v_seen FROM public.calendar_event
  WHERE id = v_series AND recurrence_effective_through = '2026-11-26';
  IF v_seen <> 1 THEN RAISE EXCEPTION 'Previous series segment must end on the selected inherited date'; END IF;
  SELECT count(*) INTO v_seen FROM public.calendar_event_occurrence
  WHERE id = v_occ_26 AND calendar_event_id = v_series AND occurrence_status = 'scheduled';
  IF v_seen <> 1 THEN RAISE EXCEPTION 'Selected occurrence must remain on the previous segment without duplication'; END IF;
  SELECT count(*) INTO v_seen FROM public.calendar_event_occurrence
  WHERE calendar_event_id = v_child AND owner_user_id = v_owner
    AND original_local_date IN ('2026-11-27', '2026-11-28');
  IF v_seen <> 2 THEN RAISE EXCEPTION 'Child segment did not materialize the following eligible slots'; END IF;

  SELECT agenda_series_scope_test_helpers.series_scope_audit_count(
    v_owner, 'calendar_event', v_series, ARRAY['calendar_event.recurrence_updated']
  ) INTO v_audit;
  IF v_audit <> 2 THEN
    RAISE EXCEPTION 'Both entire-series edit and split parent boundary must append recurrence audit rows; got %', v_audit;
  END IF;
END;
$test$;

RESET ROLE;
ROLLBACK;
