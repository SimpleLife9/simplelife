-- Ephemeral integration test for authenticated Event mutation RPC contracts.
-- Execute only against local Supabase Postgres after replaying migrations.
-- The transaction is rolled back; it creates no hosted or persistent QA rows.

BEGIN;

INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data
) VALUES
  (
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'agenda-mutate-a@example.invalid',
    '', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb
  ),
  (
    'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'agenda-mutate-b@example.invalid',
    '', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb
  )
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.user_profile (id, auth_user_id, display_name)
VALUES
  ('019a0000-0000-7000-8000-000000000011', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'Mutation owner A'),
  ('019a0000-0000-7000-8000-000000000012', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'Mutation owner B')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.task (
  id, owner_user_id, created_by_user_id, action, status, time_zone
) VALUES (
  '019a0000-0000-7000-8000-000000000013',
  '019a0000-0000-7000-8000-000000000012',
  '019a0000-0000-7000-8000-000000000012',
  'Restore Event reservation', 'todo', 'America/Havana'
);

INSERT INTO public.task_schedule (
  id, owner_user_id, created_by_user_id, updated_by_user_id, task_id,
  schedule_status, start_local, end_local, time_zone, starts_at, ends_at,
  start_disambiguation, end_disambiguation, resolver_metadata
) VALUES (
  '019a0000-0000-7000-8000-000000000014',
  '019a0000-0000-7000-8000-000000000012',
  '019a0000-0000-7000-8000-000000000012',
  '019a0000-0000-7000-8000-000000000012',
  '019a0000-0000-7000-8000-000000000013',
  'confirmed',
  timestamp '2026-12-24 05:00:00',
  timestamp '2026-12-24 06:00:00',
  'America/Havana',
  timestamptz '2026-12-24 10:00:00+00',
  timestamptz '2026-12-24 11:00:00+00',
  'earlier', 'earlier',
  '{"rulesSource":"iana-tzdb","rulesVersion":"2026f","resolverVersion":"agenda-iana-resolver-v1","authoritative":true}'::jsonb
);

INSERT INTO public.calendar_event (
  id, owner_user_id, created_by_user_id, updated_by_user_id,
  title, temporal_kind, start_date, end_date_exclusive
) VALUES
  (
    '019a0000-0000-7000-8000-000000000111',
    '019a0000-0000-7000-8000-000000000011',
    '019a0000-0000-7000-8000-000000000011',
    '019a0000-0000-7000-8000-000000000011',
    'Mutation Event A', 'all_day', DATE '2026-12-24', DATE '2026-12-25'
  ),
  (
    '019a0000-0000-7000-8000-000000000112',
    '019a0000-0000-7000-8000-000000000012',
    '019a0000-0000-7000-8000-000000000012',
    '019a0000-0000-7000-8000-000000000012',
    'Mutation Event B', 'all_day', DATE '2026-12-24', DATE '2026-12-25'
  );

INSERT INTO public.protected_time_block (
  id, owner_user_id, created_by_user_id, updated_by_user_id,
  label, category, protection_mode, pattern_kind, time_zone,
  start_local, end_local, starts_at, ends_at,
  start_disambiguation, end_disambiguation, start_gap_strategy, end_gap_strategy,
  start_date, end_date_exclusive, weekdays, start_time_local, end_time_local, ends_next_day,
  resolver_metadata
) VALUES (
  '019a0000-0000-7000-8000-000000000015',
  '019a0000-0000-7000-8000-000000000012',
  '019a0000-0000-7000-8000-000000000012',
  '019a0000-0000-7000-8000-000000000012',
  'Owner B protected rest', 'sleep', 'hard', 'one_off', 'America/Havana',
  timestamp '2026-12-24 05:00:00', timestamp '2026-12-24 07:00:00',
  timestamptz '2026-12-24 10:00:00+00', timestamptz '2026-12-24 12:00:00+00',
  'earlier', 'earlier', 'next-valid', 'next-valid',
  NULL, NULL, NULL, NULL, NULL, NULL,
  '{"rulesSource":"iana-tzdb","rulesVersion":"2026f","resolverVersion":"agenda-iana-resolver-v1","authoritative":true}'::jsonb
);

DO $test$
DECLARE
  v_event_a uuid := '019a0000-0000-7000-8000-000000000111';
  v_owner_a uuid := '019a0000-0000-7000-8000-000000000011';
  v_event_b uuid := '019a0000-0000-7000-8000-000000000112';
  v_owner_b uuid := '019a0000-0000-7000-8000-000000000012';
  v_key_edit uuid := private.uuidv7();
  v_key_stale uuid := private.uuidv7();
  v_key_cancel uuid := private.uuidv7();
  v_key_reopen uuid := private.uuidv7();
  v_key_finish uuid := private.uuidv7();
  v_key_cancel_finished uuid := private.uuidv7();
  v_key_archive uuid := private.uuidv7();
  v_key_restore uuid := private.uuidv7();
  v_key_trash uuid := private.uuidv7();
  v_key_untrash uuid := private.uuidv7();
  v_key_cross_owner uuid := private.uuidv7();
  v_key_b_archive uuid := private.uuidv7();
  v_key_b_restore uuid := private.uuidv7();
  v_key_b_cancel uuid := private.uuidv7();
  v_key_b_reopen uuid := private.uuidv7();
  v_schedule_b uuid := '019a0000-0000-7000-8000-000000000014';
  v_block_b uuid := '019a0000-0000-7000-8000-000000000015';
  v_schedule_version timestamptz;
  v_block_version timestamptz;
  v_protected_decisions jsonb;
  v_lifecycle_patch jsonb;
  v_schedule_decisions jsonb;
  v_old_version timestamptz;
  v_version timestamptz;
  v_status integer;
  v_body jsonb;
  v_replayed boolean;
  v_audit_count bigint;
  v_receipt_count bigint;
  v_event_status text;
  v_lifecycle text;
  v_actions text[];
  v_title text;
  v_purge_after timestamptz;
  v_patch jsonb := jsonb_build_object(
    'title', 'Mutation Event A edited',
    'description', 'Edited by authenticated mutation RPC',
    'location_label', 'Room 12',
    'location_kind', 'physical',
    'temporal_kind', 'all_day',
    'start_date', '2026-12-25',
    'end_date_exclusive', '2026-12-27',
    'start_local', NULL,
    'end_local', NULL,
    'time_zone', NULL,
    'starts_at', NULL,
    'ends_at', NULL,
    'start_disambiguation', NULL,
    'end_disambiguation', NULL,
    'start_gap_strategy', NULL,
    'end_gap_strategy', NULL,
    'protected_time_decisions', '[]'::jsonb,
    'protected_time_snapshot', '[]'::jsonb,
    'task_schedule_conflict_decisions', '[]'::jsonb,
    'task_schedule_snapshot', '[]'::jsonb,
    'task_schedule_window', jsonb_build_object(
      'startsAt', '2026-12-25T00:00:00.000Z',
      'endsAt', '2026-12-27T00:00:00.000Z'
    )
  );
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'event_mutation_request' AND c.relrowsecurity
  ) THEN
    RAISE EXCEPTION 'Event mutation receipt RLS must be enabled';
  END IF;
  IF NOT has_table_privilege('service_role', 'public.event_mutation_request', 'SELECT')
     OR NOT has_table_privilege('service_role', 'public.event_mutation_request', 'INSERT')
     OR NOT has_table_privilege('service_role', 'public.event_mutation_request', 'UPDATE')
     OR has_table_privilege('service_role', 'public.event_mutation_request', 'DELETE')
     OR has_table_privilege('service_role', 'public.event_mutation_request', 'TRUNCATE') THEN
    RAISE EXCEPTION 'service_role mutation receipt privileges are not SELECT/INSERT/UPDATE only';
  END IF;
  IF has_table_privilege('authenticated', 'public.event_mutation_request', 'SELECT')
     OR has_table_privilege('authenticated', 'public.event_mutation_request', 'INSERT')
     OR has_table_privilege('authenticated', 'public.event_mutation_request', 'UPDATE')
     OR has_table_privilege('anon', 'public.event_mutation_request', 'SELECT') THEN
    RAISE EXCEPTION 'browser/API roles unexpectedly have mutation receipt access';
  END IF;
  IF NOT has_function_privilege(
       'service_role',
       'public.mutate_calendar_event_once(uuid,uuid,uuid,text,text,timestamp with time zone,text,jsonb,timestamp with time zone)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'authenticated',
       'public.mutate_calendar_event_once(uuid,uuid,uuid,text,text,timestamp with time zone,text,jsonb,timestamp with time zone)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'anon',
       'public.mutate_calendar_event_once(uuid,uuid,uuid,text,text,timestamp with time zone,text,jsonb,timestamp with time zone)',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'mutation RPC execute privileges are incorrect';
  END IF;

  SELECT updated_at INTO v_old_version
  FROM public.calendar_event
  WHERE id = v_event_a AND owner_user_id = v_owner_a;

  -- The server-style edit uses an exact updated_at compare-and-swap and appends one audit row.
  EXECUTE 'SET LOCAL ROLE service_role';
  SELECT r.http_status, r.response_body, r.replayed
    INTO v_status, v_body, v_replayed
  FROM public.mutate_calendar_event_once(
    v_owner_a, v_event_a, v_key_edit, 'event-mutation-v1', repeat('a', 64),
    v_old_version, 'edit', v_patch, clock_timestamp()
  ) AS r;
  IF v_status <> 200 OR v_replayed IS NOT FALSE OR v_body ->> 'eventId' <> v_event_a::text THEN
    RAISE EXCEPTION 'Initial Event edit failed: %, %, %', v_status, v_body, v_replayed;
  END IF;

  -- Same owner/key/hash returns the stored receipt before checking the old version again.
  SELECT r.http_status, r.response_body, r.replayed
    INTO v_status, v_body, v_replayed
  FROM public.mutate_calendar_event_once(
    v_owner_a, v_event_a, v_key_edit, 'event-mutation-v1', repeat('a', 64),
    v_old_version, 'edit', v_patch, clock_timestamp()
  ) AS r;
  IF v_status <> 200 OR v_replayed IS NOT TRUE THEN
    RAISE EXCEPTION 'Identical edit retry did not replay its receipt';
  END IF;

  -- The same key cannot be repurposed for a different mutation.
  SELECT r.http_status, r.response_body, r.replayed
    INTO v_status, v_body, v_replayed
  FROM public.mutate_calendar_event_once(
    v_owner_a, v_event_a, v_key_edit, 'event-mutation-v1', repeat('b', 64),
    v_old_version, 'cancel', '{}'::jsonb, clock_timestamp()
  ) AS r;
  IF v_status <> 409 OR v_body ->> 'error' <> 'IDEMPOTENCY_KEY_REUSED' THEN
    RAISE EXCEPTION 'Mutation idempotency key reuse was not rejected';
  END IF;

  SELECT updated_at INTO v_version
  FROM public.calendar_event
  WHERE id = v_event_a AND owner_user_id = v_owner_a;

  -- Stale version must conflict and leave the Event unchanged.
  SELECT r.http_status, r.response_body
    INTO v_status, v_body
  FROM public.mutate_calendar_event_once(
    v_owner_a, v_event_a, v_key_stale, 'event-mutation-v1', repeat('c', 64),
    v_old_version, 'cancel', '{}'::jsonb, clock_timestamp()
  ) AS r;
  IF v_status <> 409 OR v_body ->> 'error' <> 'EVENT_VERSION_CONFLICT' THEN
    RAISE EXCEPTION 'Stale Event version was not rejected';
  END IF;

  -- Another owner's Event is indistinguishable from a missing Event.
  SELECT r.http_status, r.response_body
    INTO v_status, v_body
  FROM public.mutate_calendar_event_once(
    v_owner_a, v_event_b, v_key_cross_owner, 'event-mutation-v1', repeat('d', 64),
    v_version, 'cancel', '{}'::jsonb, clock_timestamp()
  ) AS r;
  IF v_status <> 404 OR v_body ->> 'error' <> 'EVENT_NOT_FOUND' THEN
    RAISE EXCEPTION 'Cross-owner Event mutation was not hidden as not-found';
  END IF;

  -- Cancel and reopen are explicit functional-status transitions.
  SELECT r.http_status INTO v_status
  FROM public.mutate_calendar_event_once(
    v_owner_a, v_event_a, v_key_cancel, 'event-mutation-v1', repeat('e', 64),
    v_version, 'cancel', '{}'::jsonb, clock_timestamp()
  ) AS r;
  IF v_status <> 200 THEN RAISE EXCEPTION 'Event cancel failed'; END IF;

  SELECT updated_at INTO v_version FROM public.calendar_event WHERE id = v_event_a;
  v_lifecycle_patch := jsonb_build_object(
    'protected_time_decisions', '[]'::jsonb,
    'protected_time_snapshot', '[]'::jsonb,
    'task_schedule_conflict_decisions', '[]'::jsonb,
    'task_schedule_snapshot', '[]'::jsonb,
    'task_schedule_window', jsonb_build_object(
      'startsAt', '2026-12-25T05:00:00Z', 'endsAt', '2026-12-27T05:00:00Z'
    )
  );
  SELECT r.http_status INTO v_status
  FROM public.mutate_calendar_event_once(
    v_owner_a, v_event_a, v_key_reopen, 'event-mutation-v1', repeat('f', 64),
    v_version, 'reopen', v_lifecycle_patch, clock_timestamp()
  ) AS r;
  IF v_status <> 200 THEN RAISE EXCEPTION 'Event reopen failed'; END IF;

  SELECT updated_at INTO v_version FROM public.calendar_event WHERE id = v_event_a;
  SELECT r.http_status INTO v_status
  FROM public.mutate_calendar_event_once(
    v_owner_a, v_event_a, v_key_finish, 'event-mutation-v1', repeat('5', 64),
    v_version, 'finish', '{}'::jsonb, clock_timestamp()
  ) AS r;
  IF v_status <> 200 THEN RAISE EXCEPTION 'Event finish failed'; END IF;

  SELECT updated_at INTO v_version FROM public.calendar_event WHERE id = v_event_a;
  SELECT r.http_status, r.response_body INTO v_status, v_body
  FROM public.mutate_calendar_event_once(
    v_owner_a, v_event_a, v_key_cancel_finished, 'event-mutation-v1', repeat('6', 64),
    v_version, 'cancel', '{}'::jsonb, clock_timestamp()
  ) AS r;
  IF v_status <> 409 OR v_body ->> 'error' <> 'EVENT_CANNOT_BE_CANCELLED' THEN
    RAISE EXCEPTION 'A finished Event must not be cancellable';
  END IF;

  -- Archive is separate from functional status and is recoverable.
  SELECT updated_at INTO v_version FROM public.calendar_event WHERE id = v_event_a;
  SELECT r.http_status INTO v_status
  FROM public.mutate_calendar_event_once(
    v_owner_a, v_event_a, v_key_archive, 'event-mutation-v1', repeat('1', 64),
    v_version, 'archive', '{}'::jsonb, clock_timestamp()
  ) AS r;
  IF v_status <> 200 THEN RAISE EXCEPTION 'Event archive failed'; END IF;

  SELECT updated_at INTO v_version FROM public.calendar_event WHERE id = v_event_a;
  SELECT r.http_status INTO v_status
  FROM public.mutate_calendar_event_once(
    v_owner_a, v_event_a, v_key_restore, 'event-mutation-v1', repeat('2', 64),
    v_version, 'restore', v_lifecycle_patch, clock_timestamp()
  ) AS r;
  IF v_status <> 200 THEN RAISE EXCEPTION 'Archived Event restore failed'; END IF;

  -- Trash is a logical 30-day tombstone; restore clears it without physical DELETE.
  SELECT updated_at INTO v_version FROM public.calendar_event WHERE id = v_event_a;
  SELECT r.http_status INTO v_status
  FROM public.mutate_calendar_event_once(
    v_owner_a, v_event_a, v_key_trash, 'event-mutation-v1', repeat('3', 64),
    v_version, 'trash', '{}'::jsonb, clock_timestamp()
  ) AS r;
  IF v_status <> 200 THEN RAISE EXCEPTION 'Event trash failed'; END IF;

  SELECT deleted_at, purge_after INTO v_version, v_purge_after
  FROM public.calendar_event WHERE id = v_event_a;
  IF v_purge_after IS DISTINCT FROM v_version + interval '30 days' THEN
    RAISE EXCEPTION 'Event trash did not assign the exact 30-day recovery window';
  END IF;

  SELECT updated_at INTO v_version FROM public.calendar_event WHERE id = v_event_a;
  SELECT r.http_status INTO v_status
  FROM public.mutate_calendar_event_once(
    v_owner_a, v_event_a, v_key_untrash, 'event-mutation-v1', repeat('4', 64),
    v_version, 'restore', v_lifecycle_patch, clock_timestamp()
  ) AS r;
  IF v_status <> 200 THEN RAISE EXCEPTION 'Trashed Event restore failed'; END IF;


  -- An archived Event that overlaps a TaskSchedule cannot be restored without consent.
  SELECT updated_at INTO v_version FROM public.calendar_event
  WHERE id = v_event_b AND owner_user_id = v_owner_b;
  SELECT r.http_status INTO v_status
  FROM public.mutate_calendar_event_once(
    v_owner_b, v_event_b, v_key_b_archive, 'event-mutation-v1', repeat('7', 64),
    v_version, 'archive', '{}'::jsonb, clock_timestamp()
  ) AS r;
  IF v_status <> 200 THEN RAISE EXCEPTION 'Owner B Event archive failed'; END IF;

  SELECT updated_at INTO v_version FROM public.calendar_event
  WHERE id = v_event_b AND owner_user_id = v_owner_b;
  SELECT updated_at INTO v_schedule_version FROM public.task_schedule
  WHERE id = v_schedule_b AND owner_user_id = v_owner_b;
  SELECT updated_at INTO v_block_version FROM public.protected_time_block
  WHERE id = v_block_b AND owner_user_id = v_owner_b;
  v_protected_decisions := jsonb_build_array(jsonb_build_object(
    'policyVersion', 'protected-time-decision-v1',
    'blockId', v_block_b,
    'blockUpdatedAt', v_block_version,
    'protectionMode', 'hard',
    'occurrenceDate', '2026-12-24',
    'occurrenceStartsAt', '2026-12-24T10:00:00.000Z',
    'occurrenceEndsAt', '2026-12-24T12:00:00.000Z',
    'overlapStartsAt', '2026-12-24T10:00:00.000Z',
    'overlapEndsAt', '2026-12-24T12:00:00.000Z',
    'timeZone', 'America/Havana',
    'decision', 'override_hard',
    'consentedAt', clock_timestamp()
  ));
  v_lifecycle_patch := jsonb_build_object(
    'protected_time_decisions', v_protected_decisions,
    'protected_time_snapshot', jsonb_build_array(jsonb_build_object('id', v_block_b, 'updated_at', v_block_version)),
    'task_schedule_conflict_decisions', '[]'::jsonb,
    'task_schedule_snapshot', jsonb_build_array(jsonb_build_object('id', v_schedule_b, 'updated_at', v_schedule_version)),
    'task_schedule_window', jsonb_build_object('startsAt', '2026-12-24T05:00:00Z', 'endsAt', '2026-12-25T05:00:00Z')
  );

  SELECT r.http_status, r.response_body INTO v_status, v_body
  FROM public.mutate_calendar_event_once(
    v_owner_b, v_event_b, v_key_b_restore, 'event-mutation-v1', repeat('8', 64),
    v_version, 'restore', v_lifecycle_patch, clock_timestamp()
  ) AS r;
  IF v_status <> 409 OR v_body->>'error' <> 'TASK_SCHEDULE_CONFLICTS' THEN
    RAISE EXCEPTION 'Restore must require TaskSchedule consent; got % %', v_status, v_body;
  END IF;
  SELECT count(*) INTO v_receipt_count FROM public.event_mutation_request
  WHERE owner_user_id = v_owner_b AND idempotency_key = v_key_b_restore;
  IF v_receipt_count <> 0 THEN RAISE EXCEPTION 'Denied restore consumed its idempotency key'; END IF;

  v_schedule_decisions := jsonb_build_array(jsonb_build_object(
    'policyVersion', 'event-task-schedule-decision-v1',
    'taskScheduleId', v_schedule_b,
    'taskScheduleUpdatedAt', v_schedule_version,
    'startsAt', '2026-12-24T10:00:00Z',
    'endsAt', '2026-12-24T11:00:00Z',
    'overlapStartsAt', '2026-12-24T10:00:00Z',
    'overlapEndsAt', '2026-12-24T11:00:00Z',
    'decision', 'keep_overlap',
    'consentedAt', clock_timestamp()
  ));
  v_lifecycle_patch := jsonb_set(v_lifecycle_patch, '{task_schedule_conflict_decisions}', v_schedule_decisions);

  SELECT r.http_status, r.response_body INTO v_status, v_body
  FROM public.mutate_calendar_event_once(
    v_owner_b, v_event_b, v_key_b_restore, 'event-mutation-v1', repeat('9', 64),
    v_version, 'restore', v_lifecycle_patch, clock_timestamp()
  ) AS r;
  IF v_status <> 200 THEN RAISE EXCEPTION 'Restore with explicit consent failed: % %', v_status, v_body; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.calendar_event WHERE id = v_event_b AND owner_user_id = v_owner_b
      AND archived_at IS NULL AND deleted_at IS NULL
      AND task_schedule_conflict_decisions = v_schedule_decisions
      AND protected_time_decisions = v_protected_decisions
  ) THEN RAISE EXCEPTION 'Restore did not persist the exact Protected Time and TaskSchedule consent evidence'; END IF;

  SELECT updated_at INTO v_version FROM public.calendar_event WHERE id = v_event_b;
  SELECT r.http_status INTO v_status
  FROM public.mutate_calendar_event_once(
    v_owner_b, v_event_b, v_key_b_cancel, 'event-mutation-v1', repeat('a', 64),
    v_version, 'cancel', '{}'::jsonb, clock_timestamp()
  ) AS r;
  IF v_status <> 200 THEN RAISE EXCEPTION 'Owner B Event cancel failed'; END IF;

  SELECT updated_at INTO v_version FROM public.calendar_event WHERE id = v_event_b;
  SELECT r.http_status, r.response_body INTO v_status, v_body
  FROM public.mutate_calendar_event_once(
    v_owner_b, v_event_b, v_key_b_reopen, 'event-mutation-v1', repeat('b', 64),
    v_version, 'reopen', v_lifecycle_patch, clock_timestamp()
  ) AS r;
  IF v_status <> 200 THEN RAISE EXCEPTION 'Reopen with prior valid consent failed: % %', v_status, v_body; END IF;

  SELECT r.http_status, r.replayed INTO v_status, v_replayed
  FROM public.mutate_calendar_event_once(
    v_owner_b, v_event_b, v_key_b_reopen, 'event-mutation-v1', repeat('b', 64),
    v_version, 'reopen', v_lifecycle_patch, clock_timestamp()
  ) AS r;
  IF v_status <> 200 OR NOT v_replayed THEN RAISE EXCEPTION 'Reopen retry did not replay'; END IF;

  EXECUTE 'RESET ROLE';
  EXECUTE 'SET LOCAL ROLE postgres';

  SELECT event_status, title, archived_at, deleted_at
    INTO v_event_status, v_title, v_version, v_purge_after
  FROM public.calendar_event
  WHERE id = v_event_a AND owner_user_id = v_owner_a;
  IF v_event_status <> 'finished'
     OR v_title <> 'Mutation Event A edited'
     OR v_version IS NOT NULL
     OR v_purge_after IS NOT NULL THEN
    RAISE EXCEPTION 'Event functional state/content/lifecycle did not return to the expected active state';
  END IF;

  SELECT count(*) INTO v_audit_count
  FROM public.audit_event
  WHERE entity_type = 'calendar_event'
    AND entity_id = v_event_b
    AND action = 'calendar_event.task_schedule_decisions_recorded';
  IF v_audit_count <> 1 THEN
    RAISE EXCEPTION 'Restore + unchanged-consent reopen must append exactly one TaskSchedule decision audit row; got %',
      v_audit_count;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.audit_event
    WHERE entity_type = 'calendar_event'
      AND entity_id = v_event_b
      AND action = 'calendar_event.task_schedule_decisions_recorded'
      AND details->'decisions_after' = v_schedule_decisions
  ) THEN
    RAISE EXCEPTION 'Event TaskSchedule audit must preserve the exact accepted version-bound decisions';
  END IF;

  SELECT count(*) INTO v_audit_count
  FROM public.audit_event
  WHERE entity_type = 'calendar_event' AND entity_id = v_event_a;
  IF v_audit_count <> 9 THEN
    RAISE EXCEPTION 'Expected create + eight meaningful updates audit rows; got %', v_audit_count;
  END IF;

  SELECT array_agg(action ORDER BY recorded_at)
    INTO v_actions
  FROM public.audit_event
  WHERE entity_type = 'calendar_event'
    AND entity_id = v_event_a
    AND account_user_id = v_owner_a;
  IF v_actions IS DISTINCT FROM ARRAY[
    'calendar_event.created',
    'calendar_event.updated',
    'calendar_event.cancelled',
    'calendar_event.reopened',
    'calendar_event.finished',
    'calendar_event.archived',
    'calendar_event.restored',
    'calendar_event.trashed',
    'calendar_event.restored'
  ]::text[] THEN
    RAISE EXCEPTION 'Explicit Event audit action sequence is incorrect: %', v_actions;
  END IF;

  SELECT count(*) INTO v_receipt_count
  FROM public.event_mutation_request
  WHERE owner_user_id = v_owner_a;
  IF v_receipt_count <> 11 THEN
    RAISE EXCEPTION 'Expected one receipt for each attempted unique mutation (including four conflicts); got %', v_receipt_count;
  END IF;

  SELECT count(*) INTO v_audit_count
  FROM public.audit_event
  WHERE entity_type = 'calendar_event'
    AND entity_id = v_event_b
    AND action = 'calendar_event.protected_time_decisions_recorded'
    AND details->>'decision_version' = 'protected-time-decision-v1'
    AND details->'decisions_before' = '[]'::jsonb
    AND details->'decisions_after' = v_protected_decisions;
  IF v_audit_count <> 1 THEN
    RAISE EXCEPTION 'Event Protected Time consent must be audited exactly once across restore, reopen and replay; got %', v_audit_count;
  END IF;

  SELECT count(*) INTO v_audit_count
  FROM public.audit_event
  WHERE entity_type = 'calendar_event' AND entity_id = v_event_b;
  IF v_audit_count <> 7 THEN
    RAISE EXCEPTION 'Expected Event B create/archive/restore/cancel/reopen plus two consent audit rows; got %', v_audit_count;
  END IF;
END;
$test$;

ROLLBACK;
