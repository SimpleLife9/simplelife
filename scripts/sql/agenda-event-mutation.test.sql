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
  v_key_archive uuid := private.uuidv7();
  v_key_restore uuid := private.uuidv7();
  v_key_trash uuid := private.uuidv7();
  v_key_untrash uuid := private.uuidv7();
  v_key_cross_owner uuid := private.uuidv7();
  v_old_version timestamptz;
  v_version timestamptz;
  v_status integer;
  v_body jsonb;
  v_replayed boolean;
  v_audit_count bigint;
  v_receipt_count bigint;
  v_event_status text;
  v_lifecycle text;
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
    'end_gap_strategy', NULL
  );
BEGIN
  IF NOT row_security_active('public.event_mutation_request') THEN
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
  SET LOCAL ROLE service_role;
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
  SELECT r.http_status INTO v_status
  FROM public.mutate_calendar_event_once(
    v_owner_a, v_event_a, v_key_reopen, 'event-mutation-v1', repeat('f', 64),
    v_version, 'reopen', '{}'::jsonb, clock_timestamp()
  ) AS r;
  IF v_status <> 200 THEN RAISE EXCEPTION 'Event reopen failed'; END IF;

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
    v_version, 'restore', '{}'::jsonb, clock_timestamp()
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
    v_version, 'restore', '{}'::jsonb, clock_timestamp()
  ) AS r;
  IF v_status <> 200 THEN RAISE EXCEPTION 'Trashed Event restore failed'; END IF;

  RESET ROLE;

  SELECT event_status, title, archived_at, deleted_at
    INTO v_event_status, v_title, v_version, v_purge_after
  FROM public.calendar_event
  WHERE id = v_event_a AND owner_user_id = v_owner_a;
  IF v_event_status <> 'confirmed'
     OR v_title <> 'Mutation Event A edited'
     OR v_version IS NOT NULL
     OR v_purge_after IS NOT NULL THEN
    RAISE EXCEPTION 'Event functional state/content/lifecycle did not return to the expected active state';
  END IF;

  SELECT count(*) INTO v_audit_count
  FROM public.audit_event
  WHERE entity_type = 'calendar_event' AND entity_id = v_event_a;
  IF v_audit_count <> 8 THEN
    RAISE EXCEPTION 'Expected create + seven meaningful updates audit rows; got %', v_audit_count;
  END IF;

  SELECT count(*) INTO v_receipt_count
  FROM public.event_mutation_request
  WHERE owner_user_id = v_owner_a;
  IF v_receipt_count <> 8 THEN
    RAISE EXCEPTION 'Expected one receipt for each attempted unique mutation (including two conflicts); got %', v_receipt_count;
  END IF;

  SELECT count(*) INTO v_audit_count
  FROM public.audit_event
  WHERE entity_type = 'calendar_event' AND entity_id = v_event_b;
  IF v_audit_count <> 1 THEN
    RAISE EXCEPTION 'Cross-owner mutation changed the other owner Event audit history';
  END IF;
END;
$test$;

ROLLBACK;
