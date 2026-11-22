-- Ephemeral PostgreSQL integration tests for TaskSchedule persistence.
-- Run only after the source migration replay in the disposable CI Supabase stack.
-- All fixture rows and audit entries are rolled back.

BEGIN;

INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data
) VALUES
  (
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'task-schedule-owner-a@example.invalid',
    '', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb
  ),
  (
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'task-schedule-owner-b@example.invalid',
    '', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb
  )
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.user_profile (id, auth_user_id, display_name)
VALUES
  ('019a0000-0000-7000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'TaskSchedule owner A'),
  ('019a0000-0000-7000-8000-000000000002', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'TaskSchedule owner B')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.task (
  id, owner_user_id, created_by_user_id, action, status, time_zone
) VALUES
  ('019a0000-0000-7000-8000-000000000011', '019a0000-0000-7000-8000-000000000001',
   '019a0000-0000-7000-8000-000000000001', 'Owner A task', 'todo', 'America/Havana'),
  ('019a0000-0000-7000-8000-000000000012', '019a0000-0000-7000-8000-000000000001',
   '019a0000-0000-7000-8000-000000000001', 'Owner A second task', 'todo', 'America/Havana'),
  ('019a0000-0000-7000-8000-000000000013', '019a0000-0000-7000-8000-000000000002',
   '019a0000-0000-7000-8000-000000000002', 'Owner B task', 'todo', 'America/Havana');

DO $test$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_catalog.pg_roles r ON r.oid = c.relowner
    WHERE n.nspname = 'public'
      AND c.relname = 'task_schedule'
      AND r.rolname = 'postgres'
      AND c.relrowsecurity
  ) THEN
    RAISE EXCEPTION 'task_schedule must be postgres-owned with RLS enabled';
  END IF;

  IF NOT has_table_privilege('authenticated', 'public.task_schedule', 'SELECT')
     OR has_table_privilege('authenticated', 'public.task_schedule', 'INSERT')
     OR has_table_privilege('authenticated', 'public.task_schedule', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.task_schedule', 'DELETE')
     OR has_table_privilege('authenticated', 'public.task_schedule', 'TRUNCATE') THEN
    RAISE EXCEPTION 'authenticated TaskSchedule privileges must be SELECT-only';
  END IF;

  IF NOT has_table_privilege('service_role', 'public.task_schedule', 'SELECT')
     OR NOT has_table_privilege('service_role', 'public.task_schedule', 'INSERT')
     OR NOT has_table_privilege('service_role', 'public.task_schedule', 'UPDATE')
     OR has_table_privilege('service_role', 'public.task_schedule', 'DELETE')
     OR has_table_privilege('service_role', 'public.task_schedule', 'TRUNCATE') THEN
    RAISE EXCEPTION 'service_role TaskSchedule privileges must be SELECT/INSERT/UPDATE-only';
  END IF;

  IF has_table_privilege('anon', 'public.task_schedule', 'SELECT')
     OR has_table_privilege('anon', 'public.task_schedule', 'INSERT') THEN
    RAISE EXCEPTION 'anon must not access TaskSchedule';
  END IF;

  IF NOT has_table_privilege('service_role', 'public.task_schedule_mutation_request', 'INSERT')
     OR has_table_privilege('authenticated', 'public.task_schedule_mutation_request', 'SELECT')
     OR has_table_privilege('anon', 'public.task_schedule_mutation_request', 'SELECT') THEN
    RAISE EXCEPTION 'TaskSchedule idempotency receipts must be service-role-only';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.task_schedule'::regclass
      AND conname = 'task_schedule_task_owner_fk'
      AND contype = 'f'
  ) THEN
    RAISE EXCEPTION 'TaskSchedule must enforce same-owner composite Task integrity';
  END IF;
END;
$test$;

-- The same owner's task may be scheduled multiple times. The Task itself remains untouched.
SET LOCAL ROLE service_role;

DO $test$
DECLARE
  v_meta jsonb := jsonb_build_object(
    'rulesSource', 'iana-tzdb',
    'rulesVersion', '2026f',
    'resolverVersion', 'agenda-iana-resolver-v1',
    'authoritative', true,
    'start', jsonb_build_object('resolution', 'exact'),
    'end', jsonb_build_object('resolution', 'exact')
  );
  v_patch jsonb;
  v_result record;
  v_updated_at timestamptz;
  v_audit_count bigint;
  v_schedule_count bigint;
  v_task_status text;
BEGIN
  v_patch := jsonb_build_object(
    'task_id', '019a0000-0000-7000-8000-000000000011',
    'schedule_status', 'proposed',
    'start_local', '2026-11-24 09:00:00',
    'end_local', '2026-11-24 10:00:00',
    'time_zone', 'America/Havana',
    'starts_at', '2026-11-24 14:00:00+00',
    'ends_at', '2026-11-24 15:00:00+00',
    'start_disambiguation', 'earlier',
    'end_disambiguation', 'earlier',
    'start_gap_strategy', 'next-valid',
    'end_gap_strategy', 'next-valid',
    'resolver_metadata', v_meta,
    'conflict_decisions', '[]'::jsonb,
    'conflict_snapshot', '[]'::jsonb
  );

  SELECT * INTO v_result
  FROM public.mutate_task_schedule_once(
    '019a0000-0000-7000-8000-000000000001',
    '019a0000-0000-7000-8000-000000000101',
    '019a0000-0000-7000-8000-000000000201',
    'task-schedule-mutation-v1',
    repeat('a', 64),
    NULL,
    'create',
    v_patch,
    clock_timestamp()
  );
  IF v_result.http_status <> 201 OR v_result.replayed THEN
    RAISE EXCEPTION 'TaskSchedule create should return 201 once; got %, replayed %',
      v_result.http_status, v_result.replayed;
  END IF;

  SELECT * INTO v_result
  FROM public.mutate_task_schedule_once(
    '019a0000-0000-7000-8000-000000000001',
    '019a0000-0000-7000-8000-000000000101',
    '019a0000-0000-7000-8000-000000000201',
    'task-schedule-mutation-v1',
    repeat('a', 64),
    NULL,
    'create',
    v_patch,
    clock_timestamp()
  );
  IF v_result.http_status <> 201 OR NOT v_result.replayed THEN
    RAISE EXCEPTION 'Exact create retry must replay the original receipt';
  END IF;

  SELECT updated_at INTO v_updated_at
  FROM public.task_schedule
  WHERE id = '019a0000-0000-7000-8000-000000000101'
    AND owner_user_id = '019a0000-0000-7000-8000-000000000001';

  v_patch := jsonb_set(v_patch, '{start_local}', '"2026-11-24 10:00:00"'::jsonb);
  v_patch := jsonb_set(v_patch, '{end_local}', '"2026-11-24 11:00:00"'::jsonb);
  v_patch := jsonb_set(v_patch, '{starts_at}', '"2026-11-24 15:00:00+00"'::jsonb);
  v_patch := jsonb_set(v_patch, '{ends_at}', '"2026-11-24 16:00:00+00"'::jsonb);

  SELECT * INTO v_result
  FROM public.mutate_task_schedule_once(
    '019a0000-0000-7000-8000-000000000001',
    '019a0000-0000-7000-8000-000000000101',
    '019a0000-0000-7000-8000-000000000202',
    'task-schedule-mutation-v1',
    repeat('b', 64),
    v_updated_at,
    'edit',
    v_patch,
    clock_timestamp()
  );
  IF v_result.http_status <> 200 THEN
    RAISE EXCEPTION 'TaskSchedule edit should succeed; got %', v_result.http_status;
  END IF;

  SELECT * INTO v_result
  FROM public.mutate_task_schedule_once(
    '019a0000-0000-7000-8000-000000000001',
    '019a0000-0000-7000-8000-000000000101',
    '019a0000-0000-7000-8000-000000000203',
    'task-schedule-mutation-v1',
    repeat('c', 64),
    v_updated_at,
    'edit',
    v_patch,
    clock_timestamp()
  );
  IF v_result.http_status <> 409
     OR v_result.response_body->>'error' <> 'TASK_SCHEDULE_VERSION_CONFLICT' THEN
    RAISE EXCEPTION 'A stale TaskSchedule edit must return a version conflict';
  END IF;

  SELECT updated_at INTO v_updated_at
  FROM public.task_schedule
  WHERE id = '019a0000-0000-7000-8000-000000000101';

  SELECT * INTO v_result
  FROM public.mutate_task_schedule_once(
    '019a0000-0000-7000-8000-000000000001',
    '019a0000-0000-7000-8000-000000000101',
    '019a0000-0000-7000-8000-000000000204',
    'task-schedule-mutation-v1',
    repeat('d', 64),
    v_updated_at,
    'confirm',
    '{}'::jsonb,
    clock_timestamp()
  );
  IF v_result.http_status <> 200 OR v_result.response_body->>'scheduleStatus' <> 'confirmed' THEN
    RAISE EXCEPTION 'Proposed reservation must be confirmable';
  END IF;

  SELECT updated_at INTO v_updated_at
  FROM public.task_schedule
  WHERE id = '019a0000-0000-7000-8000-000000000101';

  SELECT * INTO v_result
  FROM public.mutate_task_schedule_once(
    '019a0000-0000-7000-8000-000000000001',
    '019a0000-0000-7000-8000-000000000101',
    '019a0000-0000-7000-8000-000000000205',
    'task-schedule-mutation-v1',
    repeat('e', 64),
    v_updated_at,
    'cancel',
    '{}'::jsonb,
    clock_timestamp()
  );
  IF v_result.http_status <> 200 OR v_result.response_body->>'scheduleStatus' <> 'cancelled' THEN
    RAISE EXCEPTION 'Confirmed reservation must be cancellable';
  END IF;

  -- Create a second reservation and exercise released/elapsed as reservation-only states.
  v_patch := jsonb_set(v_patch, '{schedule_status}', '"confirmed"'::jsonb);
  SELECT * INTO v_result
  FROM public.mutate_task_schedule_once(
    '019a0000-0000-7000-8000-000000000001',
    '019a0000-0000-7000-8000-000000000102',
    '019a0000-0000-7000-8000-000000000206',
    'task-schedule-mutation-v1',
    repeat('f', 64),
    NULL,
    'create',
    v_patch,
    clock_timestamp()
  );
  IF v_result.http_status <> 201 THEN
    RAISE EXCEPTION 'Second TaskSchedule create should succeed';
  END IF;

  SELECT updated_at INTO v_updated_at
  FROM public.task_schedule
  WHERE id = '019a0000-0000-7000-8000-000000000102';

  SELECT * INTO v_result
  FROM public.mutate_task_schedule_once(
    '019a0000-0000-7000-8000-000000000001',
    '019a0000-0000-7000-8000-000000000102',
    '019a0000-0000-7000-8000-000000000207',
    'task-schedule-mutation-v1',
    repeat('1', 64),
    v_updated_at,
    'release',
    '{}'::jsonb,
    clock_timestamp()
  );
  IF v_result.http_status <> 200 OR v_result.response_body->>'scheduleStatus' <> 'released' THEN
    RAISE EXCEPTION 'Confirmed reservation must be releasable';
  END IF;

  v_patch := jsonb_set(v_patch, '{schedule_status}', '"confirmed"'::jsonb);
  SELECT * INTO v_result
  FROM public.mutate_task_schedule_once(
    '019a0000-0000-7000-8000-000000000001',
    '019a0000-0000-7000-8000-000000000103',
    '019a0000-0000-7000-8000-000000000208',
    'task-schedule-mutation-v1',
    repeat('2', 64),
    NULL,
    'create',
    v_patch,
    clock_timestamp()
  );
  IF v_result.http_status <> 201 THEN
    RAISE EXCEPTION 'Third TaskSchedule create should succeed';
  END IF;

  SELECT updated_at INTO v_updated_at
  FROM public.task_schedule
  WHERE id = '019a0000-0000-7000-8000-000000000103';

  SELECT * INTO v_result
  FROM public.mutate_task_schedule_once(
    '019a0000-0000-7000-8000-000000000001',
    '019a0000-0000-7000-8000-000000000103',
    '019a0000-0000-7000-8000-000000000209',
    'task-schedule-mutation-v1',
    repeat('3', 64),
    v_updated_at,
    'elapsed',
    '{}'::jsonb,
    clock_timestamp()
  );
  IF v_result.http_status <> 200 OR v_result.response_body->>'scheduleStatus' <> 'elapsed' THEN
    RAISE EXCEPTION 'Confirmed reservation must transition to elapsed';
  END IF;

  SELECT count(*) INTO v_schedule_count
  FROM public.task_schedule
  WHERE owner_user_id = '019a0000-0000-7000-8000-000000000001';
  IF v_schedule_count <> 3 THEN
    RAISE EXCEPTION 'One Task may have multiple schedules; expected 3, got %', v_schedule_count;
  END IF;

  SELECT status INTO v_task_status
  FROM public.task
  WHERE id = '019a0000-0000-7000-8000-000000000011';
  IF v_task_status <> 'todo' THEN
    RAISE EXCEPTION 'TaskSchedule transitions must not change Task execution status';
  END IF;

  SELECT count(*) INTO v_audit_count
  FROM public.audit_event
  WHERE entity_type = 'task_schedule'
    AND entity_id IN (
      '019a0000-0000-7000-8000-000000000101',
      '019a0000-0000-7000-8000-000000000102',
      '019a0000-0000-7000-8000-000000000103'
    );
  IF v_audit_count <> 8 THEN
    RAISE EXCEPTION 'Each TaskSchedule create/edit/status transition must append audit; got %', v_audit_count;
  END IF;
END;
$test$;

RESET ROLE;

-- The composite foreign key rejects cross-owner reservations even for a trusted writer.
SET LOCAL ROLE service_role;
DO $test$
BEGIN
  BEGIN
    INSERT INTO public.task_schedule (
      id, owner_user_id, created_by_user_id, updated_by_user_id, task_id,
      schedule_status, start_local, end_local, time_zone, starts_at, ends_at,
      start_disambiguation, end_disambiguation, resolver_metadata
    ) VALUES (
      '019a0000-0000-7000-8000-000000000111',
      '019a0000-0000-7000-8000-000000000002',
      '019a0000-0000-7000-8000-000000000002',
      '019a0000-0000-7000-8000-000000000002',
      '019a0000-0000-7000-8000-000000000011',
      'confirmed',
      timestamp '2026-11-24 09:00:00',
      timestamp '2026-11-24 10:00:00',
      'America/Havana',
      timestamptz '2026-11-24 14:00:00+00',
      timestamptz '2026-11-24 15:00:00+00',
      'earlier', 'earlier',
      '{"rulesSource":"iana-tzdb","rulesVersion":"2026f","resolverVersion":"agenda-iana-resolver-v1","authoritative":true}'::jsonb
    );
    RAISE EXCEPTION 'Cross-owner TaskSchedule unexpectedly succeeded';
  EXCEPTION WHEN foreign_key_violation THEN
    NULL;
  END;
END;
$test$;
RESET ROLE;

-- Authenticated reads are owner-scoped; direct browser writes are not granted.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', true);
DO $test$
DECLARE
  v_count bigint;
BEGIN
  SELECT count(*) INTO v_count FROM public.task_schedule;
  IF v_count <> 3 THEN
    RAISE EXCEPTION 'Owner A should read exactly their three TaskSchedules; got %', v_count;
  END IF;
END;
$test$;
SELECT set_config('request.jwt.claim.sub', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', true);
DO $test$
DECLARE
  v_count bigint;
BEGIN
  SELECT count(*) INTO v_count FROM public.task_schedule;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'Owner B must not read Owner A TaskSchedules; got %', v_count;
  END IF;
END;
$test$;
RESET ROLE;

ROLLBACK;
