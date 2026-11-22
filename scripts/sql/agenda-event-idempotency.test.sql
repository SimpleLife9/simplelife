
-- Ephemeral CI integration tests for Event create idempotency.
-- Run only against local Supabase Postgres after all migrations are applied.
-- This fixture intentionally remains in the disposable CI database so the
-- companion concurrency smoke can exercise independent PostgreSQL sessions.

INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data
) VALUES
  (
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'agenda-idempotency-owner-a@example.invalid',
    '', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb
  ),
  (
    'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'agenda-idempotency-owner-b@example.invalid',
    '', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb
  ),
  (
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'agenda-idempotency-owner-c@example.invalid',
    '', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb
  )
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.user_profile (id, auth_user_id, display_name)
VALUES
  ('019a0000-0000-7000-8000-000000000011', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'Agenda idempotency owner A'),
  ('019a0000-0000-7000-8000-000000000012', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'Agenda idempotency owner B'),
  ('019a0000-0000-7000-8000-000000000013', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'Agenda idempotency owner C')
ON CONFLICT (id) DO NOTHING;

-- Exact serialized insert shape emitted by buildEventInsertRecord().
CREATE FUNCTION pg_temp.agenda_idempotency_event_record(
  p_id uuid,
  p_owner uuid,
  p_title text,
  p_created_at timestamptz DEFAULT TIMESTAMPTZ '2026-11-22 18:00:00+00'
)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
AS $function$
  SELECT jsonb_build_object(
    'id', p_id,
    'owner_user_id', p_owner,
    'created_by_user_id', p_owner,
    'updated_by_user_id', p_owner,
    'title', p_title,
    'description', NULL,
    'location_label', NULL,
    'location_kind', NULL,
    'event_status', 'confirmed',
    'temporal_kind', 'all_day',
    'start_date', DATE '2026-11-23',
    'end_date_exclusive', DATE '2026-11-24',
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
    'created_at', p_created_at,
    'updated_at', p_created_at
  );
$function$;

DO $test$
DECLARE
  v_status integer;
  v_body jsonb;
  v_replayed boolean;
  v_event_id uuid;
  v_count bigint;
BEGIN
  -- Catalog and least-privilege checks.
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_catalog.pg_roles r ON r.oid = c.relowner
    WHERE n.nspname = 'public'
      AND c.relname = 'event_create_request'
      AND r.rolname = 'postgres'
      AND c.relrowsecurity
  ) THEN
    RAISE EXCEPTION 'event_create_request must be postgres-owned with RLS enabled';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_policy p
    WHERE p.polrelid = 'public.event_create_request'::regclass
  ) THEN
    RAISE EXCEPTION 'event_create_request must not have browser-facing RLS policies';
  END IF;

  IF has_table_privilege('anon', 'public.event_create_request', 'SELECT')
     OR has_table_privilege('anon', 'public.event_create_request', 'INSERT')
     OR has_table_privilege('authenticated', 'public.event_create_request', 'SELECT')
     OR has_table_privilege('authenticated', 'public.event_create_request', 'INSERT')
     OR has_table_privilege('authenticated', 'public.event_create_request', 'UPDATE') THEN
    RAISE EXCEPTION 'anon/authenticated unexpectedly have idempotency ledger privileges';
  END IF;

  IF NOT has_table_privilege('service_role', 'public.event_create_request', 'SELECT')
     OR NOT has_table_privilege('service_role', 'public.event_create_request', 'INSERT')
     OR NOT has_table_privilege('service_role', 'public.event_create_request', 'UPDATE')
     OR has_table_privilege('service_role', 'public.event_create_request', 'DELETE')
     OR has_table_privilege('service_role', 'public.event_create_request', 'TRUNCATE')
     OR has_table_privilege('service_role', 'public.event_create_request', 'REFERENCES')
     OR has_table_privilege('service_role', 'public.event_create_request', 'TRIGGER')
     OR has_table_privilege('service_role', 'public.event_create_request', 'MAINTAIN') THEN
    RAISE EXCEPTION 'service_role idempotency ledger privileges are not SELECT/INSERT/UPDATE only';
  END IF;

  IF NOT has_function_privilege(
       'service_role',
       'public.create_calendar_event_once(uuid,uuid,text,text,jsonb)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'anon',
       'public.create_calendar_event_once(uuid,uuid,text,text,jsonb)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'authenticated',
       'public.create_calendar_event_once(uuid,uuid,text,text,jsonb)',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'create_calendar_event_once execute grants are incorrect';
  END IF;

  IF has_table_privilege('service_role', 'public.audit_event', 'SELECT')
     OR has_table_privilege('service_role', 'public.audit_event', 'INSERT')
     OR has_table_privilege('service_role', 'public.audit_event', 'UPDATE')
     OR has_table_privilege('service_role', 'public.audit_event', 'DELETE')
     OR has_table_privilege('service_role', 'public.audit_event', 'TRUNCATE') THEN
    RAISE EXCEPTION 'service_role must not receive direct audit_event privileges';
  END IF;
END;
$test$;

-- Run the exact SQL routine with service_role, as the future Edge Function will.
SET ROLE service_role;

DO $test$
DECLARE
  v_status integer;
  v_body jsonb;
  v_replayed boolean;
  v_event_id uuid;
  v_count bigint;
BEGIN
  -- First request claims the owner/key and creates the Event/audit/receipt.
  SELECT r.http_status, r.response_body, r.replayed
    INTO v_status, v_body, v_replayed
  FROM public.create_calendar_event_once(
    '019a0000-0000-7000-8000-000000000011',
    '019a0000-0000-7000-8000-000000000301',
    'event-create-v1',
    repeat('a', 64),
    pg_temp.agenda_idempotency_event_record(
      '019a0000-0000-7000-8000-000000000401',
      '019a0000-0000-7000-8000-000000000011',
      'Idempotent Event A'
    )
  ) AS r;

  IF v_status <> 201 OR v_replayed IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'First Event create must return 201 and replayed=false';
  END IF;
  IF v_body->>'eventId' <> '019a0000-0000-7000-8000-000000000401'
     OR v_body->>'createdAt' <> '2026-11-22T18:00:00.000Z'
     OR v_body->>'eventStatus' <> 'confirmed' THEN
    RAISE EXCEPTION 'First Event create receipt is incorrect: %', v_body;
  END IF;
  v_event_id := (v_body->>'eventId')::uuid;

  -- Same owner/key/hash replays the original receipt even if the retry generated
  -- a different candidate Event UUID. It must not create a second Event/audit.
  SELECT r.http_status, r.response_body, r.replayed
    INTO v_status, v_body, v_replayed
  FROM public.create_calendar_event_once(
    '019a0000-0000-7000-8000-000000000011',
    '019a0000-0000-7000-8000-000000000301',
    'event-create-v1',
    repeat('a', 64),
    pg_temp.agenda_idempotency_event_record(
      '019a0000-0000-7000-8000-000000000402',
      '019a0000-0000-7000-8000-000000000011',
      'Idempotent Event A'
    )
  ) AS r;

  IF v_status <> 201 OR v_replayed IS DISTINCT FROM true
     OR v_body->>'eventId' <> v_event_id::text THEN
    RAISE EXCEPTION 'Matching retry must replay original receipt: % / %', v_status, v_body;
  END IF;

  -- Reusing the same owner/key with a different request hash returns 409 and
  -- cannot create another Event or overwrite the winning receipt.
  SELECT r.http_status, r.response_body, r.replayed
    INTO v_status, v_body, v_replayed
  FROM public.create_calendar_event_once(
    '019a0000-0000-7000-8000-000000000011',
    '019a0000-0000-7000-8000-000000000301',
    'event-create-v1',
    repeat('b', 64),
    pg_temp.agenda_idempotency_event_record(
      '019a0000-0000-7000-8000-000000000403',
      '019a0000-0000-7000-8000-000000000011',
      'Different payload'
    )
  ) AS r;

  IF v_status <> 409
     OR v_replayed IS DISTINCT FROM false
     OR v_body->>'error' <> 'IDEMPOTENCY_KEY_REUSED' THEN
    RAISE EXCEPTION 'Different payload with same key must return 409: % / %', v_status, v_body;
  END IF;

  -- Same key under a different verified owner is a separate namespace.
  SELECT r.http_status, r.response_body, r.replayed
    INTO v_status, v_body, v_replayed
  FROM public.create_calendar_event_once(
    '019a0000-0000-7000-8000-000000000012',
    '019a0000-0000-7000-8000-000000000301',
    'event-create-v1',
    repeat('a', 64),
    pg_temp.agenda_idempotency_event_record(
      '019a0000-0000-7000-8000-000000000404',
      '019a0000-0000-7000-8000-000000000012',
      'Idempotent Event A'
    )
  ) AS r;

  IF v_status <> 201 OR v_replayed IS DISTINCT FROM false
     OR v_body->>'eventId' <> '019a0000-0000-7000-8000-000000000404' THEN
    RAISE EXCEPTION 'Same key under a second owner must create an independent Event';
  END IF;

  -- Same payload with a new key is a separate intentional creation.
  SELECT r.http_status, r.response_body, r.replayed
    INTO v_status, v_body, v_replayed
  FROM public.create_calendar_event_once(
    '019a0000-0000-7000-8000-000000000011',
    '019a0000-0000-7000-8000-000000000302',
    'event-create-v1',
    repeat('a', 64),
    pg_temp.agenda_idempotency_event_record(
      '019a0000-0000-7000-8000-000000000405',
      '019a0000-0000-7000-8000-000000000011',
      'Idempotent Event A'
    )
  ) AS r;

  IF v_status <> 201 OR v_replayed IS DISTINCT FROM false
     OR v_body->>'eventId' <> '019a0000-0000-7000-8000-000000000405' THEN
    RAISE EXCEPTION 'A different idempotency key must create a new Event';
  END IF;

  SELECT count(*) INTO v_count
  FROM public.calendar_event
  WHERE id IN (
    '019a0000-0000-7000-8000-000000000401',
    '019a0000-0000-7000-8000-000000000402',
    '019a0000-0000-7000-8000-000000000403',
    '019a0000-0000-7000-8000-000000000404',
    '019a0000-0000-7000-8000-000000000405'
  );
  IF v_count <> 3 THEN
    RAISE EXCEPTION 'Expected three committed Events after replay/conflict/owner/new-key cases; got %', v_count;
  END IF;
END;
$test$;

RESET ROLE;

DO $test$
DECLARE
  v_count bigint;
BEGIN
  SELECT count(*) INTO v_count
  FROM public.event_create_request
  WHERE (owner_user_id, idempotency_key) IN (
    ('019a0000-0000-7000-8000-000000000011', '019a0000-0000-7000-8000-000000000301'),
    ('019a0000-0000-7000-8000-000000000012', '019a0000-0000-7000-8000-000000000301'),
    ('019a0000-0000-7000-8000-000000000011', '019a0000-0000-7000-8000-000000000302')
  );
  IF v_count <> 3 THEN
    RAISE EXCEPTION 'Expected exactly three owner-scoped idempotency receipts; got %', v_count;
  END IF;

  SELECT count(*) INTO v_count
  FROM public.audit_event
  WHERE entity_type = 'calendar_event'
    AND entity_id IN (
      '019a0000-0000-7000-8000-000000000401',
      '019a0000-0000-7000-8000-000000000402',
      '019a0000-0000-7000-8000-000000000403',
      '019a0000-0000-7000-8000-000000000404',
      '019a0000-0000-7000-8000-000000000405'
    );
  IF v_count <> 3 THEN
    RAISE EXCEPTION 'Each successful Event must append exactly one audit row; got %', v_count;
  END IF;
END;
$test$;

-- Direct authenticated/anon writes and reads are denied by explicit privileges.
DO $test$
DECLARE
  v_failed boolean := false;
BEGIN
  BEGIN
    INSERT INTO public.event_create_request (
      owner_user_id, idempotency_key, payload_version, payload_hash
    ) VALUES (
      '019a0000-0000-7000-8000-000000000011',
      '019a0000-0000-7000-8000-000000000303',
      'event-create-v1',
      decode(repeat('c', 64), 'hex')
    );
  EXCEPTION WHEN insufficient_privilege THEN
    v_failed := true;
  END;
  IF NOT v_failed THEN
    RAISE EXCEPTION 'postgres test identity direct write check was not meaningful';
  END IF;
END;
$test$;

-- Force the audit append to fail for one Event. The function call is isolated
-- in a PL/pgSQL exception subtransaction, so the key claim and Event must roll back.
CREATE FUNCTION pg_temp.agenda_idempotency_force_audit_failure()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.entity_id = '019a0000-0000-7000-8000-000000000406'::uuid THEN
    RAISE EXCEPTION 'forced idempotency audit append failure' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER agenda_idempotency_test_force_audit_failure
BEFORE INSERT ON public.audit_event
FOR EACH ROW EXECUTE FUNCTION pg_temp.agenda_idempotency_force_audit_failure();

SET ROLE service_role;
DO $test$
DECLARE
  v_failed boolean := false;
  v_record jsonb;
BEGIN
  v_record := pg_temp.agenda_idempotency_event_record(
    '019a0000-0000-7000-8000-000000000406',
    '019a0000-0000-7000-8000-000000000013',
    'Retry after forced audit failure'
  );
  BEGIN
    PERFORM *
    FROM public.create_calendar_event_once(
      '019a0000-0000-7000-8000-000000000013',
      '019a0000-0000-7000-8000-000000000306',
      'event-create-v1',
      repeat('d', 64),
      v_record
    );
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    v_failed := true;
  END;
  IF NOT v_failed THEN
    RAISE EXCEPTION 'Expected forced audit failure was not raised';
  END IF;
END;
$test$;
RESET ROLE;

DROP TRIGGER agenda_idempotency_test_force_audit_failure ON public.audit_event;

DO $test$
DECLARE
  v_count bigint;
BEGIN
  SELECT count(*) INTO v_count
  FROM public.event_create_request
  WHERE owner_user_id = '019a0000-0000-7000-8000-000000000013'
    AND idempotency_key = '019a0000-0000-7000-8000-000000000306';
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'Failed audit append must roll back the idempotency claim';
  END IF;

  SELECT count(*) INTO v_count
  FROM public.calendar_event
  WHERE id = '019a0000-0000-7000-8000-000000000406';
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'Failed audit append must roll back the Event row';
  END IF;

  SELECT count(*) INTO v_count
  FROM public.audit_event
  WHERE entity_id = '019a0000-0000-7000-8000-000000000406';
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'Failed audit append must not leave a success audit row';
  END IF;
END;
$test$;

-- The same key must be claimable after the failed transaction.
SET ROLE service_role;
DO $test$
DECLARE
  v_status integer;
  v_body jsonb;
  v_replayed boolean;
BEGIN
  SELECT r.http_status, r.response_body, r.replayed
    INTO v_status, v_body, v_replayed
  FROM public.create_calendar_event_once(
    '019a0000-0000-7000-8000-000000000013',
    '019a0000-0000-7000-8000-000000000306',
    'event-create-v1',
    repeat('d', 64),
    pg_temp.agenda_idempotency_event_record(
      '019a0000-0000-7000-8000-000000000406',
      '019a0000-0000-7000-8000-000000000013',
      'Retry after forced audit failure'
    )
  ) AS r;

  IF v_status <> 201 OR v_replayed IS DISTINCT FROM false
     OR v_body->>'eventId' <> '019a0000-0000-7000-8000-000000000406' THEN
    RAISE EXCEPTION 'Retry after audit failure should create one Event';
  END IF;
END;
$test$;
RESET ROLE;

SELECT 'AGENDA_EVENT_IDEMPOTENCY_SQL_PASS' AS result;
