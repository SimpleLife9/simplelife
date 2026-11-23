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
  v_event_result record;
  v_updated_at timestamptz;
  v_schedule_count bigint;
  v_task_status text;
  v_validation text;
  v_window jsonb;
  v_decisions jsonb;
  v_snapshot jsonb;
  v_event_record jsonb;
  v_event_patch jsonb;
  v_event_version timestamptz;
  v_event_now timestamptz := clock_timestamp();
  v_event_id uuid := '019a0000-0000-7000-8000-000000000104';
  v_event_key uuid := '019a0000-0000-7000-8000-000000000213';
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
    'task-schedule-mutation-v2',
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
    -- A racing caller may generate a different provisional UUIDv7; the
    -- owner/key + canonical intent must still replay the winning identity.
    '019a0000-0000-7000-8000-000000000099',
    '019a0000-0000-7000-8000-000000000201',
    'task-schedule-mutation-v2',
    repeat('a', 64),
    NULL,
    'create',
    v_patch,
    clock_timestamp()
  );
  IF v_result.http_status <> 201 OR NOT v_result.replayed
     OR v_result.response_body->>'taskScheduleId' <> '019a0000-0000-7000-8000-000000000101' THEN
    RAISE EXCEPTION 'Concurrent create retry must replay the winning schedule identity';
  END IF;

  -- A new active reservation changes the owner snapshot. An empty/stale
  -- snapshot must be rejected after the shared advisory lock is acquired.
  SELECT * INTO v_result
  FROM public.mutate_task_schedule_once(
    '019a0000-0000-7000-8000-000000000001',
    '019a0000-0000-7000-8000-000000000104',
    '019a0000-0000-7000-8000-000000000210',
    'task-schedule-mutation-v2',
    repeat('9', 64),
    NULL,
    'create',
    v_patch,
    clock_timestamp()
  );
  IF v_result.http_status <> 409
     OR v_result.response_body->>'error' <> 'TASK_SCHEDULE_CONFLICTS_CHANGED' THEN
    RAISE EXCEPTION 'A stale conflict snapshot must return TASK_SCHEDULE_CONFLICTS_CHANGED';
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
    'task-schedule-mutation-v2',
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
    'task-schedule-mutation-v2',
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
    'task-schedule-mutation-v2',
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

  -- The Event-side validator rejects a missing choice, accepts the exact versioned choice,
  -- and rejects a choice whose TaskSchedule version has changed.
  v_window := jsonb_build_object(
    'startsAt', '2026-11-24T14:30:00.000Z',
    'endsAt', '2026-11-24T15:30:00.000Z'
  );
  v_decisions := jsonb_build_array(jsonb_build_object(
    'policyVersion', 'event-task-schedule-decision-v1',
    'taskScheduleId', '019a0000-0000-7000-8000-000000000101',
    'taskScheduleUpdatedAt', v_updated_at,
    'startsAt', '2026-11-24T15:00:00.000Z',
    'endsAt', '2026-11-24T16:00:00.000Z',
    'overlapStartsAt', '2026-11-24T15:00:00.000Z',
    'overlapEndsAt', '2026-11-24T15:30:00.000Z',
    'decision', 'keep_overlap',
    'consentedAt', v_event_now
  ));
  v_validation := public.validate_event_task_schedule_conflicts(
    '019a0000-0000-7000-8000-000000000001',
    v_window,
    '[]'::jsonb
  );
  IF v_validation <> 'TASK_SCHEDULE_CONFLICTS' THEN
    RAISE EXCEPTION 'Event must not overlap an active TaskSchedule without consent; got %', v_validation;
  END IF;
  v_validation := public.validate_event_task_schedule_conflicts(
    '019a0000-0000-7000-8000-000000000001',
    v_window,
    v_decisions
  );
  IF v_validation <> 'ok' THEN
    RAISE EXCEPTION 'Exact version-bound Event TaskSchedule consent should pass; got %', v_validation;
  END IF;
  v_validation := public.validate_event_task_schedule_conflicts(
    '019a0000-0000-7000-8000-000000000001',
    v_window,
    jsonb_set(v_decisions, '{0,taskScheduleUpdatedAt}', to_jsonb(v_updated_at + interval '1 second'))
  );
  IF v_validation <> 'TASK_SCHEDULE_CONFLICTS_CHANGED' THEN
    RAISE EXCEPTION 'A stale Event TaskSchedule consent must fail closed; got %', v_validation;
  END IF;

  -- Exercise the complete Event Create RPC: stale snapshots and missing consent return
  -- 409 before claiming the idempotency key; the same key can then commit with consent.
  v_snapshot := jsonb_build_array(jsonb_build_object(
    'id', '019a0000-0000-7000-8000-000000000101',
    'updated_at', v_updated_at
  ));
  v_event_record := jsonb_build_object(
    'id', v_event_id,
    'owner_user_id', '019a0000-0000-7000-8000-000000000001',
    'created_by_user_id', '019a0000-0000-7000-8000-000000000001',
    'updated_by_user_id', '019a0000-0000-7000-8000-000000000001',
    'title', 'Event deliberately overlapping a TaskSchedule',
    'description', NULL,
    'location_label', NULL,
    'location_kind', NULL,
    'event_status', 'confirmed',
    'temporal_kind', 'fixed_instant',
    'start_date', NULL,
    'end_date_exclusive', NULL,
    'start_local', NULL,
    'end_local', NULL,
    'time_zone', 'America/Havana',
    'starts_at', '2026-11-24T14:30:00.000Z',
    'ends_at', '2026-11-24T15:30:00.000Z',
    'start_disambiguation', NULL,
    'end_disambiguation', NULL,
    'start_gap_strategy', NULL,
    'end_gap_strategy', NULL,
    'archived_at', NULL,
    'deleted_at', NULL,
    'purge_after', NULL,
    'created_at', v_event_now,
    'updated_at', v_event_now,
    'protected_time_decisions', '[]'::jsonb,
    'protected_time_snapshot', '[]'::jsonb,
    'task_schedule_conflict_decisions', '[]'::jsonb,
    'task_schedule_snapshot', v_snapshot,
    'task_schedule_window', v_window
  );

  v_event_record := jsonb_set(
    v_event_record,
    '{task_schedule_snapshot,0,updated_at}',
    to_jsonb(v_updated_at + interval '1 second')
  );
  SELECT * INTO v_event_result
  FROM public.create_calendar_event_once(
    '019a0000-0000-7000-8000-000000000001',
    v_event_key,
    'event-create-v1',
    repeat('a', 64),
    v_event_record
  );
  IF v_event_result.http_status <> 409
     OR v_event_result.response_body->>'error' <> 'TASK_SCHEDULE_CONFLICTS_CHANGED' THEN
    RAISE EXCEPTION 'Event RPC must reject a stale TaskSchedule snapshot; got % %',
      v_event_result.http_status, v_event_result.response_body;
  END IF;

  v_event_record := jsonb_set(
    v_event_record,
    '{task_schedule_snapshot,0,updated_at}',
    to_jsonb(v_updated_at)
  );
  SELECT * INTO v_event_result
  FROM public.create_calendar_event_once(
    '019a0000-0000-7000-8000-000000000001',
    v_event_key,
    'event-create-v1',
    repeat('a', 64),
    v_event_record
  );
  IF v_event_result.http_status <> 409
     OR v_event_result.response_body->>'error' <> 'TASK_SCHEDULE_CONFLICTS' THEN
    RAISE EXCEPTION 'Event RPC must reject an overlap without consent; got % %',
      v_event_result.http_status, v_event_result.response_body;
  END IF;

  v_event_record := jsonb_set(
    v_event_record,
    '{task_schedule_conflict_decisions}',
    v_decisions
  );
  SELECT * INTO v_event_result
  FROM public.create_calendar_event_once(
    '019a0000-0000-7000-8000-000000000001',
    v_event_key,
    'event-create-v1',
    repeat('a', 64),
    v_event_record
  );
  IF v_event_result.http_status <> 201 OR v_event_result.replayed THEN
    RAISE EXCEPTION 'Event RPC must commit after explicit TaskSchedule consent; got % %',
      v_event_result.http_status, v_event_result.response_body;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.calendar_event
    WHERE id = v_event_id
      AND task_schedule_conflict_decisions = v_decisions
  ) THEN
    RAISE EXCEPTION 'Event writer did not persist the exact TaskSchedule consent record';
  END IF;

  -- The Event Edit RPC also validates the owner snapshot and consent under
  -- the shared advisory lock, and refuses a missing decision before receipt claim.
  SELECT updated_at INTO v_event_version
  FROM public.calendar_event
  WHERE id = v_event_id;

  v_event_patch := jsonb_build_object(
    'title', 'Event edited while preserving TaskSchedule',
    'description', NULL,
    'location_label', NULL,
    'location_kind', NULL,
    'temporal_kind', 'fixed_instant',
    'start_date', NULL,
    'end_date_exclusive', NULL,
    'start_local', NULL,
    'end_local', NULL,
    'time_zone', 'America/Havana',
    'starts_at', '2026-11-24T14:30:00.000Z',
    'ends_at', '2026-11-24T15:30:00.000Z',
    'start_disambiguation', NULL,
    'end_disambiguation', NULL,
    'start_gap_strategy', NULL,
    'end_gap_strategy', NULL,
    'protected_time_decisions', '[]'::jsonb,
    'protected_time_snapshot', '[]'::jsonb,
    'task_schedule_conflict_decisions', '[]'::jsonb,
    'task_schedule_snapshot', v_snapshot,
    'task_schedule_window', v_window
  );

  SELECT * INTO v_event_result
  FROM public.mutate_calendar_event_once(
    '019a0000-0000-7000-8000-000000000001',
    v_event_id,
    '019a0000-0000-7000-8000-000000000214',
    'event-mutation-v1',
    repeat('b', 64),
    v_event_version,
    'edit',
    v_event_patch,
    clock_timestamp()
  );
  IF v_event_result.http_status <> 409
     OR v_event_result.response_body->>'error' <> 'TASK_SCHEDULE_CONFLICTS' THEN
    RAISE EXCEPTION 'Event Edit RPC must reject an overlap without consent; got % %',
      v_event_result.http_status, v_event_result.response_body;
  END IF;

  v_event_patch := jsonb_set(
    v_event_patch,
    '{task_schedule_conflict_decisions}',
    v_decisions
  );
  SELECT * INTO v_event_result
  FROM public.mutate_calendar_event_once(
    '019a0000-0000-7000-8000-000000000001',
    v_event_id,
    '019a0000-0000-7000-8000-000000000214',
    'event-mutation-v1',
    repeat('c', 64),
    v_event_version,
    'edit',
    v_event_patch,
    clock_timestamp()
  );
  IF v_event_result.http_status <> 200 OR v_event_result.replayed THEN
    RAISE EXCEPTION 'Event Edit RPC must commit after explicit TaskSchedule consent; got % %',
      v_event_result.http_status, v_event_result.response_body;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.calendar_event
    WHERE id = v_event_id
      AND task_schedule_conflict_decisions = v_decisions
      AND title = 'Event edited while preserving TaskSchedule'
  ) THEN
    RAISE EXCEPTION 'Event Edit did not persist the exact TaskSchedule consent record';
  END IF;

  SELECT updated_at INTO v_updated_at
  FROM public.task_schedule
  WHERE id = '019a0000-0000-7000-8000-000000000101';

  SELECT * INTO v_result
  FROM public.mutate_task_schedule_once(
    '019a0000-0000-7000-8000-000000000001',
    '019a0000-0000-7000-8000-000000000101',
    '019a0000-0000-7000-8000-000000000205',
    'task-schedule-mutation-v2',
    repeat('e', 64),
    v_updated_at,
    'cancel',
    '{}'::jsonb,
    clock_timestamp()
  );
  IF v_result.http_status <> 200 OR v_result.response_body->>'scheduleStatus' <> 'cancelled' THEN
    RAISE EXCEPTION 'Confirmed reservation must be cancellable';
  END IF;

  -- Create a second reservation outside the Event interval. Refresh the complete
  -- owner snapshot because the Event above was created after the original TaskSchedule.
  v_patch := jsonb_set(v_patch, '{schedule_status}', '"confirmed"'::jsonb);
  v_patch := jsonb_set(v_patch, '{start_local}', '"2026-11-24 11:00:00"'::jsonb);
  v_patch := jsonb_set(v_patch, '{end_local}', '"2026-11-24 12:00:00"'::jsonb);
  v_patch := jsonb_set(v_patch, '{starts_at}', '"2026-11-24 16:00:00+00"'::jsonb);
  v_patch := jsonb_set(v_patch, '{ends_at}', '"2026-11-24 17:00:00+00"'::jsonb);
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'resource_type', snapshot.resource_type,
    'id', snapshot.id,
    'updated_at', snapshot.updated_at
  ) ORDER BY snapshot.resource_type, snapshot.id), '[]'::jsonb)
  INTO v_snapshot
  FROM (
    SELECT 'calendar_event'::text AS resource_type, id, updated_at
    FROM public.calendar_event
    WHERE owner_user_id = '019a0000-0000-7000-8000-000000000001'
      AND archived_at IS NULL
      AND deleted_at IS NULL
      AND event_status IN ('preparing', 'proposed', 'confirmed')
    UNION ALL
    SELECT 'protected_time_block'::text AS resource_type, id, updated_at
    FROM public.protected_time_block
    WHERE owner_user_id = '019a0000-0000-7000-8000-000000000001'
      AND archived_at IS NULL
      AND deleted_at IS NULL
    UNION ALL
    SELECT 'task_schedule'::text AS resource_type, id, updated_at
    FROM public.task_schedule
    WHERE owner_user_id = '019a0000-0000-7000-8000-000000000001'
      AND schedule_status IN ('proposed', 'confirmed')
      AND id <> '019a0000-0000-7000-8000-000000000102'
  ) AS snapshot;
  v_patch := jsonb_set(v_patch, '{conflict_snapshot}', v_snapshot);

  SELECT * INTO v_result
  FROM public.mutate_task_schedule_once(
    '019a0000-0000-7000-8000-000000000001',
    '019a0000-0000-7000-8000-000000000102',
    '019a0000-0000-7000-8000-000000000206',
    'task-schedule-mutation-v2',
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
    'task-schedule-mutation-v2',
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
    'task-schedule-mutation-v2',
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
    'task-schedule-mutation-v2',
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

-- The Event Create decision is append-only and carries exact before/after consent.
-- Event Edit kept the same approval, so it must not append a duplicate consent row.
DO $test$
DECLARE
  v_event_decisions jsonb;
  v_details jsonb;
  v_audit_count bigint;
BEGIN
  SELECT task_schedule_conflict_decisions INTO v_event_decisions
  FROM public.calendar_event
  WHERE id = '019a0000-0000-7000-8000-000000000104';

  SELECT count(*) INTO v_audit_count
  FROM public.audit_event
  WHERE entity_type = 'calendar_event'
    AND entity_id = '019a0000-0000-7000-8000-000000000104'
    AND action = 'calendar_event.task_schedule_decisions_recorded';
  IF v_audit_count <> 1 THEN
    RAISE EXCEPTION 'One unchanged Event TaskSchedule consent should have exactly one audit row; got %', v_audit_count;
  END IF;

  SELECT details INTO v_details
  FROM public.audit_event
  WHERE entity_type = 'calendar_event'
    AND entity_id = '019a0000-0000-7000-8000-000000000104'
    AND action = 'calendar_event.task_schedule_decisions_recorded'
  ORDER BY recorded_at DESC
  LIMIT 1;

  IF v_details->'decisions_before' IS DISTINCT FROM '[]'::jsonb
     OR v_details->'decisions_after' IS DISTINCT FROM v_event_decisions
     OR v_details->>'decision_version' IS DISTINCT FROM 'event-task-schedule-decision-v1' THEN
    RAISE EXCEPTION 'Event TaskSchedule audit must preserve the exact version-bound consent: %', v_details;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.calendar_event
    WHERE id = '019a0000-0000-7000-8000-000000000104'
      AND title = 'Event edited while preserving TaskSchedule'
      AND task_schedule_conflict_decisions = v_event_decisions
  ) THEN
    RAISE EXCEPTION 'Event Edit must retain the exact consent without rewriting its evidence';
  END IF;
END;
$test$;

-- Verify protected audit evidence as postgres, not service_role.
DO $test$
DECLARE
  v_audit_count bigint;
BEGIN
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

-- The append-only audit preserves the exact version-bound consent, not just its count.
SET LOCAL ROLE service_role;
UPDATE public.task_schedule
SET conflict_decisions = '[{
  "policyVersion": "task-schedule-overlap-decision-v1",
  "taskScheduleId": "019a0000-0000-7000-8000-000000000102",
  "taskScheduleUpdatedAt": "2026-11-24T14:59:00.000Z",
  "startsAt": "2026-11-24T14:30:00.000Z",
  "endsAt": "2026-11-24T15:30:00.000Z",
  "overlapStartsAt": "2026-11-24T14:30:00.000Z",
  "overlapEndsAt": "2026-11-24T15:00:00.000Z",
  "decision": "keep_overlap",
  "consentedAt": "2026-11-22T18:10:00.000Z"
}]'::jsonb
WHERE id = '019a0000-0000-7000-8000-000000000101'
  AND owner_user_id = '019a0000-0000-7000-8000-000000000001';
RESET ROLE;

-- Read the protected audit evidence as postgres, not service_role.
DO $test$
DECLARE
  v_decisions jsonb := '[{
    "policyVersion": "task-schedule-overlap-decision-v1",
    "taskScheduleId": "019a0000-0000-7000-8000-000000000102",
    "taskScheduleUpdatedAt": "2026-11-24T14:59:00.000Z",
    "startsAt": "2026-11-24T14:30:00.000Z",
    "endsAt": "2026-11-24T15:30:00.000Z",
    "overlapStartsAt": "2026-11-24T14:30:00.000Z",
    "overlapEndsAt": "2026-11-24T15:00:00.000Z",
    "decision": "keep_overlap",
    "consentedAt": "2026-11-22T18:10:00.000Z"
  }]'::jsonb;
  v_details jsonb;
BEGIN
  SELECT details INTO v_details
  FROM public.audit_event
  WHERE entity_type = 'task_schedule'
    AND entity_id = '019a0000-0000-7000-8000-000000000101'
    AND action = 'task_schedule.updated'
  ORDER BY recorded_at DESC
  LIMIT 1;

  IF v_details->'conflict_decisions_before' IS DISTINCT FROM '[]'::jsonb
     OR v_details->'conflict_decisions_after' IS DISTINCT FROM v_decisions THEN
    RAISE EXCEPTION 'Append-only TaskSchedule audit must preserve exact before/after conflict decisions: %', v_details;
  END IF;
END;
$test$;

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
