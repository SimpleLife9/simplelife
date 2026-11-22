
-- Ephemeral CI integration test for the first Agenda Event persistence migration.
-- Run only against the local Supabase Postgres container after migration replay.
-- Every test row and temporary trigger is rolled back at the end.

BEGIN;

-- Synthetic Auth identities and profile IDs. Both profile IDs satisfy UUIDv7.
INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data
) VALUES
  (
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'agenda-owner-a-20261122@example.invalid',
    '', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb
  ),
  (
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'agenda-owner-b-20261122@example.invalid',
    '', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb
  )
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.user_profile (id, auth_user_id, display_name)
VALUES
  ('019a0000-0000-7000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Agenda CI owner A'),
  ('019a0000-0000-7000-8000-000000000002', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Agenda CI owner B')
ON CONFLICT (id) DO NOTHING;

DO $test$
DECLARE
  v_id uuid;
  v_bytes bytea;
  v_unix_ms bigint;
  v_now_ms bigint;
  v_count bigint;
  v_distinct bigint;
  v_audit_count bigint;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_catalog.pg_roles r ON r.oid = c.relowner
    WHERE n.nspname = 'public'
      AND c.relname = 'calendar_event'
      AND r.rolname = 'postgres'
      AND c.relrowsecurity
  ) THEN
    RAISE EXCEPTION 'calendar_event must be postgres-owned with RLS enabled';
  END IF;

  IF NOT has_table_privilege('authenticated', 'public.calendar_event', 'SELECT')
     OR has_table_privilege('authenticated', 'public.calendar_event', 'INSERT')
     OR has_table_privilege('authenticated', 'public.calendar_event', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.calendar_event', 'DELETE')
     OR has_table_privilege('authenticated', 'public.calendar_event', 'TRUNCATE') THEN
    RAISE EXCEPTION 'authenticated Event privileges are not SELECT-only';
  END IF;

  IF NOT has_table_privilege('service_role', 'public.calendar_event', 'SELECT')
     OR NOT has_table_privilege('service_role', 'public.calendar_event', 'INSERT')
     OR NOT has_table_privilege('service_role', 'public.calendar_event', 'UPDATE')
     OR has_table_privilege('service_role', 'public.calendar_event', 'DELETE')
     OR has_table_privilege('service_role', 'public.calendar_event', 'TRUNCATE') THEN
    RAISE EXCEPTION 'service_role Event privileges are not SELECT/INSERT/UPDATE only';
  END IF;

  IF has_table_privilege('anon', 'public.calendar_event', 'SELECT')
     OR has_table_privilege('anon', 'public.calendar_event', 'INSERT')
     OR has_table_privilege('anon', 'public.calendar_event', 'UPDATE')
     OR has_table_privilege('anon', 'public.calendar_event', 'DELETE') THEN
    RAISE EXCEPTION 'anon unexpectedly has Event privileges';
  END IF;

  IF NOT has_table_privilege('authenticated', 'public.audit_event', 'SELECT')
     OR has_table_privilege('authenticated', 'public.audit_event', 'INSERT')
     OR has_table_privilege('authenticated', 'public.audit_event', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.audit_event', 'DELETE')
     OR has_table_privilege('authenticated', 'public.audit_event', 'TRUNCATE') THEN
    RAISE EXCEPTION 'authenticated audit_event privileges are not SELECT-only';
  END IF;

  IF has_table_privilege('service_role', 'public.audit_event', 'SELECT')
     OR has_table_privilege('service_role', 'public.audit_event', 'INSERT')
     OR has_table_privilege('service_role', 'public.audit_event', 'UPDATE')
     OR has_table_privilege('service_role', 'public.audit_event', 'DELETE')
     OR has_table_privilege('service_role', 'public.audit_event', 'TRUNCATE')
     OR has_table_privilege('service_role', 'public.audit_event', 'REFERENCES')
     OR has_table_privilege('service_role', 'public.audit_event', 'TRIGGER')
     OR has_table_privilege('service_role', 'public.audit_event', 'MAINTAIN') THEN
    RAISE EXCEPTION 'service_role retains direct audit_event privileges';
  END IF;

  IF has_table_privilege('anon', 'public.audit_event', 'SELECT')
     OR has_table_privilege('anon', 'public.audit_event', 'INSERT') THEN
    RAISE EXCEPTION 'anon unexpectedly has audit_event privileges';
  END IF;

  IF has_schema_privilege('anon', 'private', 'USAGE')
     OR has_schema_privilege('authenticated', 'private', 'USAGE')
     OR has_schema_privilege('service_role', 'private', 'USAGE') THEN
    RAISE EXCEPTION 'private schema unexpectedly exposed to an API role';
  END IF;

  IF has_function_privilege('anon', 'private.uuidv7()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'private.uuidv7()', 'EXECUTE')
     OR has_function_privilege('service_role', 'private.uuidv7()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'private.append_calendar_event_audit()', 'EXECUTE')
     OR has_function_privilege('service_role', 'private.append_calendar_event_audit()', 'EXECUTE') THEN
    RAISE EXCEPTION 'private Agenda functions are directly executable by an API role';
  END IF;

  -- Check the UUIDv7 bit layout, plausible timestamp prefix, and uniqueness.
  v_id := private.uuidv7();
  v_bytes := uuid_send(v_id);
  IF (get_byte(v_bytes, 6) >> 4) <> 7 OR (get_byte(v_bytes, 8) & 192) <> 128 THEN
    RAISE EXCEPTION 'private.uuidv7() generated invalid version/variant bits: %', v_id;
  END IF;

  v_unix_ms :=
      get_byte(v_bytes, 0)::bigint * 1099511627776
    + get_byte(v_bytes, 1)::bigint * 4294967296
    + get_byte(v_bytes, 2)::bigint * 16777216
    + get_byte(v_bytes, 3)::bigint * 65536
    + get_byte(v_bytes, 4)::bigint * 256
    + get_byte(v_bytes, 5)::bigint;
  v_now_ms := floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint;
  IF v_unix_ms < v_now_ms - 10000 OR v_unix_ms > v_now_ms + 10000 THEN
    RAISE EXCEPTION 'UUIDv7 timestamp prefix is not plausible: %, current %', v_unix_ms, v_now_ms;
  END IF;

  SELECT count(*), count(DISTINCT generated.id)
    INTO v_count, v_distinct
  FROM (
    SELECT private.uuidv7() AS id
    FROM generate_series(1, 1000)
  ) AS generated;
  IF v_count <> 1000 OR v_distinct <> 1000 THEN
    RAISE EXCEPTION 'UUIDv7 1000-ID uniqueness sample failed: %, %', v_count, v_distinct;
  END IF;
END;
$test$;

-- Simulate the trusted backend writer. service_role bypasses RLS but has only
-- SELECT/INSERT/UPDATE on calendar_event; the audit trigger runs as postgres.
SET LOCAL ROLE service_role;

INSERT INTO public.calendar_event (
  id, owner_user_id, created_by_user_id, updated_by_user_id,
  title, temporal_kind, start_date, end_date_exclusive
) VALUES (
  '019a0000-0000-7000-8000-000000000101',
  '019a0000-0000-7000-8000-000000000001',
  '019a0000-0000-7000-8000-000000000001',
  '019a0000-0000-7000-8000-000000000001',
  'Owner A all-day test',
  'all_day',
  DATE '2026-11-23',
  DATE '2026-11-24'
);

INSERT INTO public.calendar_event (
  id, owner_user_id, created_by_user_id, updated_by_user_id,
  title, temporal_kind, starts_at, ends_at
) VALUES (
  '019a0000-0000-7000-8000-000000000102',
  '019a0000-0000-7000-8000-000000000002',
  '019a0000-0000-7000-8000-000000000002',
  '019a0000-0000-7000-8000-000000000002',
  'Owner B fixed-instant test',
  'fixed_instant',
  TIMESTAMPTZ '2026-11-23 15:00:00+00',
  TIMESTAMPTZ '2026-11-23 16:00:00+00'
);

RESET ROLE;

DO $test$
DECLARE
  v_count bigint;
  v_audit public.audit_event%ROWTYPE;
BEGIN
  SELECT count(*) INTO v_count
  FROM public.audit_event
  WHERE entity_type = 'calendar_event'
    AND entity_id IN (
      '019a0000-0000-7000-8000-000000000101',
      '019a0000-0000-7000-8000-000000000102'
    );
  IF v_count <> 2 THEN
    RAISE EXCEPTION 'Each Event insert must append exactly one audit row; got %', v_count;
  END IF;

  SELECT * INTO v_audit
  FROM public.audit_event
  WHERE entity_id = '019a0000-0000-7000-8000-000000000101';

  IF v_audit.action <> 'calendar_event.created'
     OR v_audit.account_user_id <> '019a0000-0000-7000-8000-000000000001'
     OR v_audit.actor_user_id <> '019a0000-0000-7000-8000-000000000001'
     OR v_audit.source <> 'user'
     OR v_audit.result <> 'success' THEN
    RAISE EXCEPTION 'Creation audit identity/action fields are incorrect';
  END IF;

  IF v_audit.details::text LIKE '%Owner A all-day test%' THEN
    RAISE EXCEPTION 'Audit details must not duplicate Event content';
  END IF;

  SELECT count(*) INTO v_count
  FROM public.audit_event
  WHERE entity_id = '019a0000-0000-7000-8000-000000000102';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'Owner B should have exactly one creation audit row; got %', v_count;
  END IF;
END;
$test$;

-- A zoned-civil row cannot bypass authoritative DST resolution metadata.
DO $test$
DECLARE
  v_failed boolean := false;
BEGIN
  BEGIN
    INSERT INTO public.calendar_event (
      id, owner_user_id, created_by_user_id, updated_by_user_id,
      title, temporal_kind, start_local, end_local, time_zone, starts_at, ends_at,
      start_disambiguation, end_disambiguation
    ) VALUES (
      '019a0000-0000-7000-8000-000000000104',
      '019a0000-0000-7000-8000-000000000001',
      '019a0000-0000-7000-8000-000000000001',
      '019a0000-0000-7000-8000-000000000001',
      'Invalid zoned-civil test',
      'zoned_civil',
      TIMESTAMP '2026-11-23 10:00:00',
      TIMESTAMP '2026-11-23 11:00:00',
      'America/Havana',
      TIMESTAMPTZ '2026-11-23 15:00:00+00',
      TIMESTAMPTZ '2026-11-23 16:00:00+00',
      'earlier',
      'earlier'
    );
  EXCEPTION WHEN check_violation THEN
    v_failed := true;
  END;
  IF NOT v_failed THEN
    RAISE EXCEPTION 'Zoned-civil row without explicit gap strategy was accepted';
  END IF;
END;
$test$;

-- A meaningful update appends one record. An updated_at-only/no-op update does not.
SET LOCAL ROLE service_role;
UPDATE public.calendar_event
SET title = 'Owner A all-day test updated'
WHERE id = '019a0000-0000-7000-8000-000000000101';

UPDATE public.calendar_event
SET title = title
WHERE id = '019a0000-0000-7000-8000-000000000101';
RESET ROLE;

DO $test$
DECLARE
  v_count bigint;
  v_details jsonb;
BEGIN
  SELECT count(*) INTO v_count
  FROM public.audit_event
  WHERE entity_id = '019a0000-0000-7000-8000-000000000101';
  IF v_count <> 2 THEN
    RAISE EXCEPTION 'Meaningful update must append once and no-op must append zero; got %', v_count;
  END IF;

  SELECT details INTO v_details
  FROM public.audit_event
  WHERE entity_id = '019a0000-0000-7000-8000-000000000101'
    AND action = 'calendar_event.updated';
  IF NOT (v_details -> 'changed_fields' ? 'title')
     OR v_details::text LIKE '%Owner A all-day test updated%' THEN
    RAISE EXCEPTION 'Update audit must record changed field names only';
  END IF;
END;
$test$;

-- Force the audit append to fail and prove that the Event UPDATE rolls back.
CREATE FUNCTION pg_temp.agenda_force_audit_failure()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  RAISE EXCEPTION 'forced Agenda audit append failure' USING ERRCODE = 'P0001';
END;
$function$;

CREATE TRIGGER agenda_test_force_audit_failure
BEFORE INSERT ON public.audit_event
FOR EACH ROW
WHEN (NEW.entity_id = '019a0000-0000-7000-8000-000000000102'::uuid)
EXECUTE FUNCTION pg_temp.agenda_force_audit_failure();

SET LOCAL ROLE service_role;
DO $test$
DECLARE
  v_failed boolean := false;
BEGIN
  BEGIN
    UPDATE public.calendar_event
    SET title = 'This update must roll back'
    WHERE id = '019a0000-0000-7000-8000-000000000102';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    v_failed := true;
  END;

  IF NOT v_failed THEN
    RAISE EXCEPTION 'Expected forced audit append failure was not raised';
  END IF;
END;
$test$;
RESET ROLE;

DROP TRIGGER agenda_test_force_audit_failure ON public.audit_event;

DO $test$
DECLARE
  v_title text;
  v_count bigint;
BEGIN
  SELECT title INTO v_title
  FROM public.calendar_event
  WHERE id = '019a0000-0000-7000-8000-000000000102';
  IF v_title <> 'Owner B fixed-instant test' THEN
    RAISE EXCEPTION 'Event row was not rolled back after audit failure';
  END IF;

  SELECT count(*) INTO v_count
  FROM public.audit_event
  WHERE entity_id = '019a0000-0000-7000-8000-000000000102';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'Failed Event transaction must not leave an audit row; got %', v_count;
  END IF;
END;
$test$;

-- Existing audit history remains append-only under direct UPDATE/DELETE attempts.
DO $test$
DECLARE
  v_audit_id uuid;
  v_failed boolean;
BEGIN
  SELECT id INTO v_audit_id
  FROM public.audit_event
  WHERE entity_id = '019a0000-0000-7000-8000-000000000101'
  LIMIT 1;

  v_failed := false;
  BEGIN
    UPDATE public.audit_event SET action = action WHERE id = v_audit_id;
  EXCEPTION WHEN SQLSTATE '55000' THEN
    v_failed := true;
  END;
  IF NOT v_failed THEN
    RAISE EXCEPTION 'audit_event UPDATE unexpectedly succeeded';
  END IF;

  v_failed := false;
  BEGIN
    DELETE FROM public.audit_event WHERE id = v_audit_id;
  EXCEPTION WHEN SQLSTATE '55000' THEN
    v_failed := true;
  END;
  IF NOT v_failed THEN
    RAISE EXCEPTION 'audit_event DELETE unexpectedly succeeded';
  END IF;
END;
$test$;

-- service_role cannot call the audit table directly even though the trusted
-- Event row trigger can append under its SECURITY DEFINER owner.
SET LOCAL ROLE service_role;
DO $test$
DECLARE
  v_failed boolean := false;
BEGIN
  BEGIN
    INSERT INTO public.audit_event (
      id, account_user_id, actor_user_id, action, entity_type, entity_id,
      result, source, details
    ) VALUES (
      '019a0000-0000-7000-8000-000000000103',
      '019a0000-0000-7000-8000-000000000001',
      '019a0000-0000-7000-8000-000000000001',
      'forbidden.direct_insert', 'calendar_event',
      '019a0000-0000-7000-8000-000000000101',
      'success', 'user', '{}'::jsonb
    );
  EXCEPTION WHEN insufficient_privilege THEN
    v_failed := true;
  END;

  IF NOT v_failed THEN
    RAISE EXCEPTION 'service_role direct audit_event INSERT unexpectedly succeeded';
  END IF;
END;
$test$;
RESET ROLE;

-- Authenticated can read only their own Event and audit rows; no write grants.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', true);
DO $test$
DECLARE
  v_count bigint;
BEGIN
  IF auth.uid() <> 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid THEN
    RAISE EXCEPTION 'Test JWT subject was not resolved for owner A';
  END IF;
  SELECT count(*) INTO v_count FROM public.calendar_event;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'Owner A should see exactly one Event; got %', v_count;
  END IF;
  SELECT count(*) INTO v_count
  FROM public.calendar_event
  WHERE id = '019a0000-0000-7000-8000-000000000102';
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'Owner A can read owner B Event';
  END IF;
  SELECT count(*) INTO v_count
  FROM public.audit_event
  WHERE entity_id = '019a0000-0000-7000-8000-000000000101';
  IF v_count <> 2 THEN
    RAISE EXCEPTION 'Owner A should read only its two audit rows; got %', v_count;
  END IF;
END;
$test$;

SELECT set_config('request.jwt.claim.sub', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', true);
DO $test$
DECLARE
  v_count bigint;
BEGIN
  IF auth.uid() <> 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::uuid THEN
    RAISE EXCEPTION 'Test JWT subject was not resolved for owner B';
  END IF;
  SELECT count(*) INTO v_count FROM public.calendar_event;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'Owner B should see exactly one Event; got %', v_count;
  END IF;
  SELECT count(*) INTO v_count
  FROM public.calendar_event
  WHERE id = '019a0000-0000-7000-8000-000000000101';
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'Owner B can read owner A Event';
  END IF;
  SELECT count(*) INTO v_count
  FROM public.audit_event
  WHERE entity_id = '019a0000-0000-7000-8000-000000000101';
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'Owner B can read owner A audit history';
  END IF;
END;
$test$;
RESET ROLE;


-- Accepted Event status and lifecycle transitions have explicit audit actions.
-- These checks run after owner-isolation assertions so they cannot weaken those tests.
SET LOCAL ROLE service_role;

UPDATE public.calendar_event
SET event_status = 'cancelled'
WHERE id = '019a0000-0000-7000-8000-000000000101';

UPDATE public.calendar_event
SET event_status = 'confirmed'
WHERE id = '019a0000-0000-7000-8000-000000000101';

UPDATE public.calendar_event
SET event_status = 'finished'
WHERE id = '019a0000-0000-7000-8000-000000000101';

UPDATE public.calendar_event
SET archived_at = clock_timestamp()
WHERE id = '019a0000-0000-7000-8000-000000000101';

UPDATE public.calendar_event
SET archived_at = NULL
WHERE id = '019a0000-0000-7000-8000-000000000101';

WITH stamp AS (SELECT clock_timestamp() AS value)
UPDATE public.calendar_event AS event
SET deleted_at = stamp.value,
    purge_after = stamp.value + interval '30 days'
FROM stamp
WHERE event.id = '019a0000-0000-7000-8000-000000000101';

UPDATE public.calendar_event
SET deleted_at = NULL,
    purge_after = NULL
WHERE id = '019a0000-0000-7000-8000-000000000101';

RESET ROLE;

DO $test$
DECLARE
  v_actions text[];
BEGIN
  SELECT array_agg(action ORDER BY recorded_at)
  INTO v_actions
  FROM public.audit_event
  WHERE entity_id = '019a0000-0000-7000-8000-000000000101';

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
    RAISE EXCEPTION 'Event audit action sequence is incorrect: %', v_actions;
  END IF;
END;
$test$;

ROLLBACK;
