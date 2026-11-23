-- Protected Time -> TaskSchedule conflict consent, atomic snapshot checks and audit.
-- Runs only after the source migrations in the disposable CI database.
-- All fixtures and audit events are rolled back.

BEGIN;

INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data
) VALUES (
  'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'protected-time-task-schedule-20261123@example.invalid',
  '', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.user_profile (id, auth_user_id, display_name)
VALUES (
  '019a0000-0000-7000-8000-000000000071',
  'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  'Protected Time TaskSchedule owner'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.task (
  id, owner_user_id, created_by_user_id, action, status, time_zone
) VALUES (
  '019a0000-0000-7000-8000-000000000072',
  '019a0000-0000-7000-8000-000000000071',
  '019a0000-0000-7000-8000-000000000071',
  'Reservation backing task', 'todo', 'America/Havana'
);

SET LOCAL ROLE service_role;

DO $test$
DECLARE
  v_owner uuid := '019a0000-0000-7000-8000-000000000071';
  v_task uuid := '019a0000-0000-7000-8000-000000000072';
  v_schedule uuid := '019a0000-0000-7000-8000-000000000073';
  v_block uuid := '019a0000-0000-7000-8000-000000000074';
  v_create_key uuid := '019a0000-0000-7000-8000-000000000075';
  v_edit_key uuid := '019a0000-0000-7000-8000-000000000076';
  v_archive_key uuid := '019a0000-0000-7000-8000-000000000077';
  v_restore_key uuid := '019a0000-0000-7000-8000-000000000078';
  v_schedule_version timestamptz;
  v_block_version timestamptz;
  v_patch jsonb;
  v_decisions jsonb;
  v_snapshot jsonb;
  v_restore_patch jsonb;
  v_result record;
  v_receipts bigint;
  v_replayed boolean;
  v_now timestamptz := clock_timestamp();
BEGIN
  INSERT INTO public.protected_time_block (
    id, owner_user_id, created_by_user_id, updated_by_user_id,
    label, category, protection_mode, pattern_kind, time_zone,
    start_local, end_local, starts_at, ends_at,
    start_disambiguation, end_disambiguation, start_gap_strategy, end_gap_strategy,
    start_date, end_date_exclusive, weekdays, start_time_local, end_time_local,
    ends_next_day, resolver_metadata
  ) VALUES (
    v_block, v_owner, v_owner, v_owner,
    'Sueño protegido', 'sleep', 'hard', 'one_off', 'America/Havana',
    timestamp '2026-12-24 22:00:00', timestamp '2026-12-25 06:30:00',
    timestamptz '2026-12-25 03:00:00+00', timestamptz '2026-12-25 11:30:00+00',
    'earlier', 'earlier', 'next-valid', 'next-valid',
    NULL, NULL, NULL, NULL, NULL, NULL,
    '{"rulesSource":"iana-tzdb","rulesVersion":"2026f","resolverVersion":"agenda-iana-resolver-v1","authoritative":true}'::jsonb
  );

  INSERT INTO public.task_schedule (
    id, owner_user_id, created_by_user_id, updated_by_user_id, task_id,
    schedule_status, start_local, end_local, time_zone, starts_at, ends_at,
    start_disambiguation, end_disambiguation, resolver_metadata
  ) VALUES (
    v_schedule, v_owner, v_owner, v_owner, v_task,
    'confirmed', timestamp '2026-12-24 23:00:00', timestamp '2026-12-25 00:00:00',
    'America/Havana', timestamptz '2026-12-25 04:00:00+00', timestamptz '2026-12-25 05:00:00+00',
    'earlier', 'earlier',
    '{"rulesSource":"iana-tzdb","rulesVersion":"2026f","resolverVersion":"agenda-iana-resolver-v1","authoritative":true}'::jsonb
  )
  RETURNING updated_at INTO v_schedule_version;

  SELECT updated_at INTO v_block_version
  FROM public.protected_time_block
  WHERE id = v_block AND owner_user_id = v_owner;

  v_patch := jsonb_build_object(
    'label', 'Sueño protegido editado',
    'category', 'sleep',
    'protection_mode', 'hard',
    'pattern_kind', 'one_off',
    'time_zone', 'America/Havana',
    'start_local', '2026-12-24T22:00:00',
    'end_local', '2026-12-25T06:30:00',
    'starts_at', '2026-12-25T03:00:00Z',
    'ends_at', '2026-12-25T11:30:00Z',
    'start_disambiguation', 'earlier',
    'end_disambiguation', 'earlier',
    'start_gap_strategy', 'next-valid',
    'end_gap_strategy', 'next-valid',
    'start_date', NULL,
    'end_date_exclusive', NULL,
    'weekdays', NULL,
    'start_time_local', NULL,
    'end_time_local', NULL,
    'ends_next_day', NULL,
    'resolver_metadata', jsonb_build_object(
      'rulesSource', 'iana-tzdb',
      'rulesVersion', '2026f',
      'resolverVersion', 'agenda-iana-resolver-v1',
      'authoritative', true
    ),
    'task_schedule_conflict_decisions', '[]'::jsonb,
    'task_schedule_snapshot', '[]'::jsonb
  );

  -- A task reservation appeared after the Edge conflict analysis. The shared
  -- lock + full outer join must reject the stale owner snapshot before receipt claim.
  SELECT * INTO v_result
  FROM public.mutate_protected_time_block_once(
    v_owner, v_block, v_edit_key, 'protected-time-mutation-v1', repeat('a', 64),
    v_block_version, 'edit', v_patch, clock_timestamp()
  );
  IF v_result.http_status <> 409
     OR v_result.response_body->>'error' <> 'TASK_SCHEDULE_CONFLICTS_CHANGED' THEN
    RAISE EXCEPTION 'Protected Time edit must reject a stale TaskSchedule snapshot; got % %',
      v_result.http_status, v_result.response_body;
  END IF;

  SELECT count(*) INTO v_receipts
  FROM public.protected_time_block_mutation_request
  WHERE owner_user_id = v_owner AND idempotency_key = v_edit_key;
  IF v_receipts <> 0 THEN
    RAISE EXCEPTION 'A stale Protected Time snapshot must not consume its idempotency key';
  END IF;

  v_snapshot := jsonb_build_array(jsonb_build_object(
    'id', v_schedule,
    'updated_at', v_schedule_version
  ));
  v_decisions := jsonb_build_array(jsonb_build_object(
    'policyVersion', 'protected-time-task-schedule-decision-v1',
    'taskScheduleId', v_schedule,
    'taskScheduleUpdatedAt', v_schedule_version,
    'startsAt', '2026-12-25T04:00:00.000Z',
    'endsAt', '2026-12-25T05:00:00.000Z',
    'occurrenceDate', '2026-12-24',
    'occurrenceStartsAt', '2026-12-25T03:00:00.000Z',
    'occurrenceEndsAt', '2026-12-25T11:30:00.000Z',
    'overlapStartsAt', '2026-12-25T04:00:00.000Z',
    'overlapEndsAt', '2026-12-25T05:00:00.000Z',
    'protectionMode', 'hard',
    'timeZone', 'America/Havana',
    'decision', 'keep_overlap',
    'consentedAt', v_now
  ));
  v_patch := jsonb_set(v_patch, '{task_schedule_conflict_decisions}', v_decisions);
  v_patch := jsonb_set(v_patch, '{task_schedule_snapshot}', v_snapshot);

  -- Retry the same key with a versioned affirmative decision and the current
  -- full snapshot. It must commit and persist the exact consent evidence.
  SELECT * INTO v_result
  FROM public.mutate_protected_time_block_once(
    v_owner, v_block, v_edit_key, 'protected-time-mutation-v2', repeat('b', 64),
    v_block_version, 'edit', v_patch, clock_timestamp()
  );
  IF v_result.http_status <> 200 OR v_result.replayed THEN
    RAISE EXCEPTION 'Protected Time edit with explicit TaskSchedule consent must commit; got % %',
      v_result.http_status, v_result.response_body;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.protected_time_block
    WHERE id = v_block AND task_schedule_conflict_decisions = v_decisions
  ) THEN
    RAISE EXCEPTION 'Protected Time edit did not persist the version-bound TaskSchedule decision';
  END IF;

  -- Archive, then prove restore has the same stale-snapshot gate and the
  -- exact same idempotency-safe consent semantics.
  SELECT updated_at INTO v_block_version
  FROM public.protected_time_block WHERE id = v_block;
  SELECT * INTO v_result
  FROM public.mutate_protected_time_block_once(
    v_owner, v_block, v_archive_key, 'protected-time-mutation-v1', repeat('c', 64),
    v_block_version, 'archive', '{}'::jsonb, clock_timestamp()
  );
  IF v_result.http_status <> 200 THEN
    RAISE EXCEPTION 'Protected Time archive failed before restore test';
  END IF;
  SELECT updated_at INTO v_block_version
  FROM public.protected_time_block WHERE id = v_block;

  v_restore_patch := jsonb_build_object(
    'task_schedule_conflict_decisions', '[]'::jsonb,
    'task_schedule_snapshot', '[]'::jsonb
  );
  SELECT * INTO v_result
  FROM public.mutate_protected_time_block_once(
    v_owner, v_block, v_restore_key, 'protected-time-mutation-v1', repeat('d', 64),
    v_block_version, 'restore', v_restore_patch, clock_timestamp()
  );
  IF v_result.http_status <> 409
     OR v_result.response_body->>'error' <> 'TASK_SCHEDULE_CONFLICTS_CHANGED' THEN
    RAISE EXCEPTION 'Protected Time restore must reject a stale TaskSchedule snapshot; got % %',
      v_result.http_status, v_result.response_body;
  END IF;
  SELECT count(*) INTO v_receipts
  FROM public.protected_time_block_mutation_request
  WHERE owner_user_id = v_owner AND idempotency_key = v_restore_key;
  IF v_receipts <> 0 THEN
    RAISE EXCEPTION 'A stale Protected Time restore must not consume its idempotency key';
  END IF;

  v_decisions := jsonb_set(v_decisions, '{0,consentedAt}', to_jsonb(clock_timestamp()));
  v_restore_patch := jsonb_build_object(
    'task_schedule_conflict_decisions', v_decisions,
    'task_schedule_snapshot', v_snapshot
  );
  SELECT * INTO v_result
  FROM public.mutate_protected_time_block_once(
    v_owner, v_block, v_restore_key, 'protected-time-mutation-v2', repeat('e', 64),
    v_block_version, 'restore', v_restore_patch, clock_timestamp()
  );
  IF v_result.http_status <> 200 OR v_result.replayed THEN
    RAISE EXCEPTION 'Protected Time restore with current TaskSchedule consent must commit; got % %',
      v_result.http_status, v_result.response_body;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.protected_time_block
    WHERE id = v_block AND (archived_at IS NOT NULL OR deleted_at IS NOT NULL
      OR task_schedule_conflict_decisions IS DISTINCT FROM v_decisions)
  ) THEN
    RAISE EXCEPTION 'Protected Time restore did not reactivate the row and persist its consent';
  END IF;


  -- Replay must not append another decision audit row.
  SELECT * INTO v_result
  FROM public.mutate_protected_time_block_once(
    v_owner, v_block, v_restore_key, 'protected-time-mutation-v2', repeat('e', 64),
    v_block_version, 'restore', v_restore_patch, clock_timestamp()
  );
  IF v_result.http_status <> 200 OR NOT v_result.replayed THEN
    RAISE EXCEPTION 'Protected Time restore retry should replay the exact winning response';
  END IF;
END;
$test$;

RESET ROLE;

DO $audit_assertions$
DECLARE
  v_details jsonb;
  v_audit_count bigint;
  v_expected_decisions jsonb;
BEGIN
  SELECT count(*) INTO v_audit_count
  FROM public.audit_event
  WHERE entity_type = 'protected_time_block'
    AND entity_id = '019a0000-0000-7000-8000-000000000074'::uuid
    AND action = 'protected_time_block.task_schedule_decisions_recorded';

  IF v_audit_count <> 2 THEN
    RAISE EXCEPTION 'Protected Time edit + restore must append exactly two decision audit rows; replay must add none; got %',
      v_audit_count;
  END IF;

  SELECT details INTO v_details
  FROM public.audit_event
  WHERE entity_type = 'protected_time_block'
    AND entity_id = '019a0000-0000-7000-8000-000000000074'::uuid
    AND action = 'protected_time_block.task_schedule_decisions_recorded'
  ORDER BY recorded_at DESC
  LIMIT 1;

  SELECT task_schedule_conflict_decisions INTO v_expected_decisions
  FROM public.protected_time_block
  WHERE id = '019a0000-0000-7000-8000-000000000074'::uuid;

  IF v_details->>'decision_version' IS DISTINCT FROM 'protected-time-task-schedule-decision-v1'
     OR v_details->'decisions' IS DISTINCT FROM v_expected_decisions
     OR jsonb_array_length(v_details->'decisions') <> 1
     OR v_details->'decisions'->0->>'decision' IS DISTINCT FROM 'keep_overlap' THEN
    RAISE EXCEPTION 'Protected Time audit must preserve exact version-bound TaskSchedule decisions: %',
      v_details;
  END IF;
END;
$audit_assertions$;

ROLLBACK;
