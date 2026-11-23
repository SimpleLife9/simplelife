-- Ephemeral PostgreSQL integration tests for recurring Event persistence.
-- Runs only against the disposable local Supabase CI stack. All fixtures roll back.

BEGIN;

-- Initialize pg_temp before creating test-only SECURITY DEFINER audit probes.
CREATE TEMP TABLE _series_test_temp_schema_init (id boolean) ON COMMIT DROP;

INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data
) VALUES
  (
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'recurring-owner-a@example.invalid',
    '', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb
  ),
  (
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'recurring-owner-b@example.invalid',
    '', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb
  )
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.user_profile (id, auth_user_id, display_name)
VALUES
  ('019a0000-0000-7000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Recurring owner A'),
  ('019a0000-0000-7000-8000-000000000002', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Recurring owner B')
ON CONFLICT (id) DO NOTHING;


-- The backend writer is intentionally denied direct audit_event privileges.
-- This test-only SECURITY DEFINER probe lets the SQL assertions inspect rows
-- without widening service_role's production table grants.
CREATE TEMP TABLE recurring_test_context (marker boolean) ON COMMIT DROP;

CREATE FUNCTION pg_temp.recurring_test_audit_count(
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
ALTER FUNCTION pg_temp.recurring_test_audit_count(uuid, text, uuid, text[]) OWNER TO postgres;
GRANT USAGE ON SCHEMA pg_temp TO service_role;
REVOKE ALL PRIVILEGES ON FUNCTION pg_temp.recurring_test_audit_count(uuid, text, uuid, text[])
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION pg_temp.recurring_test_audit_count(uuid, text, uuid, text[])
  TO service_role;

SET LOCAL ROLE service_role;

DO $test$
DECLARE
  v_owner uuid := '019a0000-0000-7000-8000-000000000001';
  v_other_owner uuid := '019a0000-0000-7000-8000-000000000002';
  v_event_id uuid := '019a0000-0000-7000-8000-000000000101';
  v_occurrence_id uuid := '019a0000-0000-7000-8000-000000000102';
  v_idempotency uuid := '019a0000-0000-7000-8000-000000000201';
  v_now timestamptz := '2026-11-23T12:00:00Z';
  v_rule jsonb := jsonb_build_object(
    'version', 1,
    'frequency', 'DAILY',
    'interval', 1,
    'startDate', '2026-11-24',
    'temporalKind', 'all_day',
    'count', 3
  );
  v_event jsonb;
  v_occurrences jsonb;
  v_result record;
  v_audit_count bigint;
  v_seen_count bigint;
  v_top_up_inserted integer;
  v_mutation_result record;
  v_mutation_key uuid := '019a0000-0000-7000-8000-000000000301';
  v_stale_key uuid := '019a0000-0000-7000-8000-000000000302';
  v_mutation_audit bigint;
  v_rejected boolean := false;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_catalog.pg_roles r ON r.oid = c.relowner
    WHERE n.nspname = 'public'
      AND c.relname = 'calendar_event_occurrence'
      AND r.rolname = 'postgres'
      AND c.relrowsecurity
  ) THEN
    RAISE EXCEPTION 'calendar_event_occurrence must be postgres-owned with RLS enabled';
  END IF;

  IF NOT has_table_privilege('authenticated', 'public.calendar_event_occurrence', 'SELECT')
     OR has_table_privilege('authenticated', 'public.calendar_event_occurrence', 'INSERT')
     OR has_table_privilege('authenticated', 'public.calendar_event_occurrence', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.calendar_event_occurrence', 'DELETE')
     OR has_table_privilege('authenticated', 'public.calendar_event_occurrence', 'TRUNCATE') THEN
    RAISE EXCEPTION 'authenticated occurrence privileges must be SELECT-only';
  END IF;

  IF has_table_privilege('service_role', 'public.audit_event', 'SELECT')
     OR has_table_privilege('service_role', 'public.audit_event', 'INSERT')
     OR has_table_privilege('service_role', 'public.audit_event', 'UPDATE')
     OR has_table_privilege('service_role', 'public.audit_event', 'DELETE')
     OR has_table_privilege('service_role', 'public.audit_event', 'TRUNCATE') THEN
    RAISE EXCEPTION 'service_role must retain zero direct audit_event privileges';
  END IF;

  IF NOT has_table_privilege('service_role', 'public.calendar_event_occurrence', 'SELECT')
     OR NOT has_table_privilege('service_role', 'public.calendar_event_occurrence', 'INSERT')
     OR NOT has_table_privilege('service_role', 'public.calendar_event_occurrence', 'UPDATE')
     OR has_table_privilege('service_role', 'public.calendar_event_occurrence', 'DELETE')
     OR has_table_privilege('service_role', 'public.calendar_event_occurrence', 'TRUNCATE') THEN
    RAISE EXCEPTION 'service_role occurrence privileges must be SELECT/INSERT/UPDATE only';
  END IF;

  IF has_table_privilege('anon', 'public.calendar_event_occurrence', 'SELECT')
     OR has_table_privilege('anon', 'public.calendar_event_occurrence', 'INSERT') THEN
    RAISE EXCEPTION 'anon must not access recurring occurrences';
  END IF;

  IF NOT has_table_privilege('service_role', 'public.calendar_event_series_mutation_request', 'INSERT')
     OR has_table_privilege('authenticated', 'public.calendar_event_series_mutation_request', 'SELECT')
     OR has_table_privilege('anon', 'public.calendar_event_series_mutation_request', 'SELECT') THEN
    RAISE EXCEPTION 'recurring Event idempotency receipts must be service-role-only';
  END IF;

  IF NOT has_function_privilege(
       'service_role',
       'public.mutate_calendar_event_occurrence_once(uuid,uuid,uuid,text,bigint,jsonb,jsonb,jsonb,timestamp with time zone)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'authenticated',
       'public.mutate_calendar_event_occurrence_once(uuid,uuid,uuid,text,bigint,jsonb,jsonb,jsonb,timestamp with time zone)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'anon',
       'public.mutate_calendar_event_occurrence_once(uuid,uuid,uuid,text,bigint,jsonb,jsonb,jsonb,timestamp with time zone)',
       'EXECUTE'
     )
     OR has_table_privilege('authenticated', 'public.calendar_event_occurrence_mutation_request', 'SELECT') THEN
    RAISE EXCEPTION 'occurrence mutation receipts and writer RPC must be service-role-only';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.calendar_event_occurrence'::regclass
      AND conname = 'calendar_event_occurrence_event_owner_fk'
      AND contype = 'f'
  ) THEN
    RAISE EXCEPTION 'occurrences must enforce same-owner Event integrity';
  END IF;

  v_event := jsonb_build_object(
    'id', v_event_id,
    'owner_user_id', v_owner,
    'created_by_user_id', v_owner,
    'updated_by_user_id', v_owner,
    'title', 'Daily family check-in',
    'description', 'Recurring all-day test',
    'location_label', NULL,
    'location_kind', NULL,
    'event_status', 'confirmed',
    'temporal_kind', 'all_day',
    'start_date', '2026-11-24',
    'end_date_exclusive', '2026-11-25',
    'start_local', NULL,
    'end_local', NULL,
    'time_zone', NULL,
    'starts_at', NULL,
    'ends_at', NULL,
    'start_disambiguation', NULL,
    'end_disambiguation', NULL,
    'start_gap_strategy', NULL,
    'end_gap_strategy', NULL,
    'archived_at', NULL,
    'deleted_at', NULL,
    'purge_after', NULL,
    'created_at', v_now,
    'updated_at', v_now,
    'protected_time_decisions', '[]'::jsonb,
    'protected_time_snapshot', '[]'::jsonb,
    'task_schedule_conflict_decisions', '[]'::jsonb,
    'task_schedule_snapshot', '[]'::jsonb,
    'task_schedule_window', '{}'::jsonb,
    'recurrence_rule', v_rule,
    'recurrence_end_local_time', NULL,
    'recurrence_end_day_offset', 0
  );

  v_occurrences := jsonb_build_array(jsonb_build_object(
    'id', v_occurrence_id,
    'owner_user_id', v_owner,
    'created_by_user_id', v_owner,
    'updated_by_user_id', v_owner,
    'calendar_event_id', v_event_id,
    'occurrence_key', 'v1:019a0000-0000-7000-8000-000000000101:2026-11-24:ALL_DAY',
    'original_local_date', '2026-11-24',
    'original_local_time', NULL,
    'actual_local_date', '2026-11-24',
    'actual_local_time', NULL,
    'temporal_kind', 'all_day',
    'start_date', '2026-11-24',
    'end_date_exclusive', '2026-11-25',
    'start_local', NULL,
    'end_local', NULL,
    'time_zone', NULL,
    'starts_at', NULL,
    'ends_at', NULL,
    'start_disambiguation', NULL,
    'end_disambiguation', NULL,
    'start_gap_strategy', NULL,
    'end_gap_strategy', NULL,
    'resolver_metadata', NULL,
    'occurrence_status', 'scheduled',
    'override_kind', NULL,
    'review_candidate', NULL,
    'row_version', 1,
    'created_at', v_now,
    'updated_at', v_now
  ));

  SELECT * INTO v_result
  FROM public.create_recurring_calendar_event_once(
    v_owner, v_idempotency, repeat('a', 64), v_event, v_occurrences, v_now
  );

  IF v_result.http_status <> 201 OR v_result.replayed
     OR v_result.response_body->>'seriesEventId' <> v_event_id::text
     OR (v_result.response_body->>'materializedCount')::integer <> 1 THEN
    RAISE EXCEPTION 'Recurring Event create did not atomically persist one series occurrence: %', row_to_json(v_result);
  END IF;

  SELECT count(*) INTO v_seen_count
  FROM public.calendar_event_occurrence
  WHERE calendar_event_id = v_event_id AND owner_user_id = v_owner;
  IF v_seen_count <> 1 THEN
    RAISE EXCEPTION 'Expected exactly one persisted occurrence; got %', v_seen_count;
  END IF;

  SELECT pg_temp.recurring_test_audit_count(
    v_owner, NULL, NULL,
    ARRAY['calendar_event.created', 'calendar_event_occurrence.created']
  ) INTO v_audit_count;
  IF v_audit_count <> 2 THEN
    RAISE EXCEPTION 'Series and occurrence must append two audit rows in the same transaction; got %', v_audit_count;
  END IF;

  -- Authenticated calendar reads top up only missing keys. Existing rows and
  -- their lifecycle/override state are never rewritten; duplicate retries insert zero.
  SELECT public.materialize_recurring_calendar_event_once(
    v_owner,
    v_event_id,
    '2026-11-24'::date,
    jsonb_build_array(jsonb_build_object(
      'id', '019a0000-0000-7000-8000-000000000105',
      'owner_user_id', v_owner,
      'created_by_user_id', v_owner,
      'updated_by_user_id', v_owner,
      'calendar_event_id', v_event_id,
      'occurrence_key', 'v1:019a0000-0000-7000-8000-000000000101:2026-11-25:ALL_DAY',
      'original_local_date', '2026-11-25',
      'original_local_time', NULL,
      'actual_local_date', '2026-11-25',
      'actual_local_time', NULL,
      'temporal_kind', 'all_day',
      'start_date', '2026-11-25',
      'end_date_exclusive', '2026-11-26',
      'start_local', NULL,
      'end_local', NULL,
      'time_zone', NULL,
      'starts_at', NULL,
      'ends_at', NULL,
      'start_disambiguation', NULL,
      'end_disambiguation', NULL,
      'start_gap_strategy', NULL,
      'end_gap_strategy', NULL,
      'resolver_metadata', NULL,
      'occurrence_status', 'scheduled',
      'override_kind', NULL,
      'review_candidate', NULL,
      'row_version', 1,
      'created_at', v_now,
      'updated_at', v_now
    )),
    '[]'::jsonb,
    '[]'::jsonb
  ) INTO v_top_up_inserted;
  IF v_top_up_inserted <> 1 THEN
    RAISE EXCEPTION 'First materialization top-up should insert one missing occurrence; got %', v_top_up_inserted;
  END IF;

  SELECT public.materialize_recurring_calendar_event_once(
    v_owner,
    v_event_id,
    '2026-11-24'::date,
    jsonb_build_array(jsonb_build_object(
      'id', '019a0000-0000-7000-8000-000000000106',
      'owner_user_id', v_owner,
      'created_by_user_id', v_owner,
      'updated_by_user_id', v_owner,
      'calendar_event_id', v_event_id,
      'occurrence_key', 'v1:019a0000-0000-7000-8000-000000000101:2026-11-25:ALL_DAY',
      'original_local_date', '2026-11-25',
      'original_local_time', NULL,
      'actual_local_date', '2026-11-25',
      'actual_local_time', NULL,
      'temporal_kind', 'all_day',
      'start_date', '2026-11-25',
      'end_date_exclusive', '2026-11-26',
      'start_local', NULL,
      'end_local', NULL,
      'time_zone', NULL,
      'starts_at', NULL,
      'ends_at', NULL,
      'start_disambiguation', NULL,
      'end_disambiguation', NULL,
      'start_gap_strategy', NULL,
      'end_gap_strategy', NULL,
      'resolver_metadata', NULL,
      'occurrence_status', 'scheduled',
      'override_kind', NULL,
      'review_candidate', NULL,
      'row_version', 1,
      'created_at', v_now,
      'updated_at', v_now
    )),
    '[]'::jsonb,
    '[]'::jsonb
  ) INTO v_top_up_inserted;
  IF v_top_up_inserted <> 0 THEN
    RAISE EXCEPTION 'Repeated materialization must not duplicate an existing occurrence; inserted %', v_top_up_inserted;
  END IF;

  SELECT count(*) INTO v_seen_count
  FROM public.calendar_event_occurrence
  WHERE calendar_event_id = v_event_id AND owner_user_id = v_owner;
  IF v_seen_count <> 2 THEN
    RAISE EXCEPTION 'Recurring top-up must leave exactly two occurrence rows; got %', v_seen_count;
  END IF;

  SELECT pg_temp.recurring_test_audit_count(
    v_owner, 'calendar_event_occurrence', '019a0000-0000-7000-8000-000000000105', NULL
  ) INTO v_audit_count;
  IF v_audit_count <> 1 THEN
    RAISE EXCEPTION 'Top-up must append exactly one occurrence audit row; got %', v_audit_count;
  END IF;

  -- Cancel one occurrence using optimistic row-version CAS. The original
  -- occurrence identity remains immutable and the audit append is atomic.
  SELECT * INTO v_mutation_result
  FROM public.mutate_calendar_event_occurrence_once(
    v_owner,
    '019a0000-0000-7000-8000-000000000105',
    v_mutation_key,
    repeat('c', 64),
    1,
    jsonb_build_object(
      'occurrence_status', 'cancelled',
      'override_kind', 'cancelled',
      'review_candidate', NULL
    ),
    '[]'::jsonb,
    '[]'::jsonb,
    v_now
  );
  IF v_mutation_result.http_status <> 200 OR v_mutation_result.replayed
     OR v_mutation_result.response_body->>'occurrenceStatus' <> 'cancelled'
     OR (v_mutation_result.response_body->>'rowVersion')::bigint <> 2 THEN
    RAISE EXCEPTION 'Occurrence cancellation must update only the selected row with CAS: %', row_to_json(v_mutation_result);
  END IF;

  -- Same owner/key/payload replays the original receipt before checking the now-stale version.
  SELECT * INTO v_mutation_result
  FROM public.mutate_calendar_event_occurrence_once(
    v_owner,
    '019a0000-0000-7000-8000-000000000105',
    v_mutation_key,
    repeat('c', 64),
    1,
    jsonb_build_object(
      'occurrence_status', 'cancelled',
      'override_kind', 'cancelled',
      'review_candidate', NULL
    ),
    '[]'::jsonb,
    '[]'::jsonb,
    v_now
  );
  IF v_mutation_result.http_status <> 200 OR NOT v_mutation_result.replayed
     OR v_mutation_result.response_body->>'occurrenceStatus' <> 'cancelled' THEN
    RAISE EXCEPTION 'Occurrence mutation retry must replay its committed result';
  END IF;

  SELECT * INTO v_mutation_result
  FROM public.mutate_calendar_event_occurrence_once(
    v_owner,
    '019a0000-0000-7000-8000-000000000105',
    v_mutation_key,
    repeat('d', 64),
    1,
    jsonb_build_object(
      'occurrence_status', 'cancelled',
      'override_kind', 'cancelled',
      'review_candidate', NULL
    ),
    '[]'::jsonb,
    '[]'::jsonb,
    v_now
  );
  IF v_mutation_result.http_status <> 409
     OR v_mutation_result.response_body->>'error' <> 'IDEMPOTENCY_KEY_REUSED' THEN
    RAISE EXCEPTION 'Reusing an occurrence mutation key with changed intent must return 409';
  END IF;

  SELECT * INTO v_mutation_result
  FROM public.mutate_calendar_event_occurrence_once(
    v_owner,
    '019a0000-0000-7000-8000-000000000105',
    v_stale_key,
    repeat('e', 64),
    1,
    jsonb_build_object(
      'occurrence_status', 'cancelled',
      'override_kind', 'cancelled',
      'review_candidate', NULL
    ),
    '[]'::jsonb,
    '[]'::jsonb,
    v_now
  );
  IF v_mutation_result.http_status <> 409
     OR v_mutation_result.response_body->>'error' <> 'OCCURRENCE_VERSION_CONFLICT' THEN
    RAISE EXCEPTION 'Stale occurrence row version must be rejected with 409';
  END IF;

  SELECT pg_temp.recurring_test_audit_count(
    v_owner, 'calendar_event_occurrence', '019a0000-0000-7000-8000-000000000105',
    ARRAY['calendar_event_occurrence.updated']
  ) INTO v_mutation_audit;
  IF v_mutation_audit <> 1 THEN
    RAISE EXCEPTION 'Occurrence cancellation and replay must append exactly one mutation audit row; got %', v_mutation_audit;
  END IF;

  -- A retry may use a newly generated provisional series/occurrence ID, but the
  -- same owner + key + canonical payload must replay the original winning IDs.
  v_event := jsonb_set(v_event, '{id}', to_jsonb('019a0000-0000-7000-8000-000000000199'::text));
  v_occurrences := jsonb_set(v_occurrences, '{0,id}', to_jsonb('019a0000-0000-7000-8000-000000000198'::text));
  SELECT * INTO v_result
  FROM public.create_recurring_calendar_event_once(
    v_owner, v_idempotency, repeat('a', 64), v_event, v_occurrences, v_now
  );
  IF v_result.http_status <> 201 OR NOT v_result.replayed
     OR v_result.response_body->>'seriesEventId' <> v_event_id::text THEN
    RAISE EXCEPTION 'Recurring Event create retry must replay its original committed identity';
  END IF;

  SELECT * INTO v_result
  FROM public.create_recurring_calendar_event_once(
    v_owner, v_idempotency, repeat('b', 64), v_event, v_occurrences, v_now
  );
  IF v_result.http_status <> 409
     OR v_result.response_body->>'error' <> 'IDEMPOTENCY_KEY_REUSED' THEN
    RAISE EXCEPTION 'Reusing a recurring Event key with a changed payload must return 409';
  END IF;

  -- The same occurrence key cannot be claimed by a different Event series.
  v_rejected := false;
  BEGIN
    INSERT INTO public.calendar_event_occurrence (
      id, owner_user_id, created_by_user_id, updated_by_user_id,
      calendar_event_id, occurrence_key, original_local_date, original_local_time,
      actual_local_date, actual_local_time, temporal_kind,
      start_date, end_date_exclusive,
      occurrence_status, created_at, updated_at
    ) VALUES (
      '019a0000-0000-7000-8000-000000000103',
      v_owner, v_owner, v_owner,
      v_event_id,
      'v1:019a0000-0000-7000-8000-000000000101:2026-11-24:ALL_DAY',
      '2026-11-24', NULL, '2026-11-24', NULL, 'all_day',
      '2026-11-24', '2026-11-25',
      'scheduled', v_now, v_now
    );
  EXCEPTION WHEN unique_violation THEN
    v_rejected := true;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'A repeated series/occurrence key must be rejected';
  END IF;

  -- A row cannot claim another owner while referencing the original owner's Event.
  v_rejected := false;
  BEGIN
    INSERT INTO public.calendar_event_occurrence (
      id, owner_user_id, created_by_user_id, updated_by_user_id,
      calendar_event_id, occurrence_key, original_local_date, original_local_time,
      actual_local_date, actual_local_time, temporal_kind,
      start_date, end_date_exclusive,
      occurrence_status, created_at, updated_at
    ) VALUES (
      '019a0000-0000-7000-8000-000000000104',
      v_other_owner, v_other_owner, v_other_owner,
      v_event_id,
      'v1:other-owner:2026-11-24:ALL_DAY',
      '2026-11-24', NULL, '2026-11-24', NULL, 'all_day',
      '2026-11-24', '2026-11-25',
      'scheduled', v_now, v_now
    );
  EXCEPTION WHEN foreign_key_violation THEN
    v_rejected := true;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'Cross-owner occurrence relation must be rejected';
  END IF;

END;
$test$;

RESET ROLE;

-- Authenticated users can read their own occurrences only; they cannot mutate.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', true);

DO $test$
DECLARE
  v_seen bigint;
BEGIN
  SELECT count(*) INTO v_seen
  FROM public.calendar_event_occurrence
  WHERE calendar_event_id = '019a0000-0000-7000-8000-000000000101';
  IF v_seen <> 2 THEN
    RAISE EXCEPTION 'Owner A should read its two own recurring occurrences; got %', v_seen;
  END IF;
END;
$test$;

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', true);

DO $test$
DECLARE
  v_seen bigint;
BEGIN
  SELECT count(*) INTO v_seen
  FROM public.calendar_event_occurrence
  WHERE calendar_event_id = '019a0000-0000-7000-8000-000000000101';
  IF v_seen <> 0 THEN
    RAISE EXCEPTION 'Owner B must not read Owner A recurring occurrences; got %', v_seen;
  END IF;
END;
$test$;

ROLLBACK;
