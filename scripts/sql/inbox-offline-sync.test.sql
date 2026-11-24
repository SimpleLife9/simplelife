-- Offline capture sync is owner-scoped, lossless, and idempotent.
-- Run only against ephemeral CI Postgres.
BEGIN;

INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data
) VALUES
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','offline-owner-a-20261123@example.invalid','',now(),
   '{"provider":"email","providers":["email"]}'::jsonb,'{}'::jsonb),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','offline-owner-b-20261123@example.invalid','',now(),
   '{"provider":"email","providers":["email"]}'::jsonb,'{}'::jsonb)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.user_profile (id, auth_user_id, display_name)
VALUES
  ('019b7100-0000-7000-8000-000000000001','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Offline owner A'),
  ('019b7100-0000-7000-8000-000000000002','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','Offline owner B')
ON CONFLICT (id) DO NOTHING;

DO $test$
BEGIN
  IF NOT has_function_privilege('authenticated',
      'public.sync_inbox_offline_text_capture(uuid,uuid,text,timestamptz)','EXECUTE')
     OR has_function_privilege('anon',
      'public.sync_inbox_offline_text_capture(uuid,uuid,text,timestamptz)','EXECUTE')
     OR has_function_privilege('PUBLIC',
      'public.sync_inbox_offline_text_capture(uuid,uuid,text,timestamptz)','EXECUTE') THEN
    RAISE EXCEPTION 'Offline sync RPC grants must be authenticated-only';
  END IF;
END;
$test$;

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
DO $test$
DECLARE
  v_capture uuid := '019b7100-0000-7000-8000-000000000101';
  v_part uuid := '019b7100-0000-7000-8000-000000000102';
  v_capture_id uuid;
  v_part_id uuid;
  v_replayed boolean;
  v_count integer;
  v_conflict boolean := false;
  v_invalid boolean := false;
  v_source text := '  Comprar café ☕.\nLlamar a Ana.  ';
BEGIN
  SELECT capture_id, part_id, replayed
  INTO v_capture_id, v_part_id, v_replayed
  FROM public.sync_inbox_offline_text_capture(
    v_capture, v_part, v_source, '2026-11-23T18:30:00Z'
  );
  IF v_capture_id <> v_capture OR v_part_id <> v_part OR v_replayed THEN
    RAISE EXCEPTION 'Initial offline sync receipt was invalid';
  END IF;

  SELECT capture_id, part_id, replayed
  INTO v_capture_id, v_part_id, v_replayed
  FROM public.sync_inbox_offline_text_capture(
    v_capture, v_part, v_source, '2026-11-23T18:30:00Z'
  );
  IF v_capture_id <> v_capture OR v_part_id <> v_part OR NOT v_replayed THEN
    RAISE EXCEPTION 'Retry did not replay the existing capture and part';
  END IF;

  SELECT count(*) INTO v_count FROM public.capture WHERE id = v_capture;
  IF v_count <> 1 THEN RAISE EXCEPTION 'Offline retry created duplicate capture rows'; END IF;
  SELECT count(*) INTO v_count FROM public.capture_part WHERE capture_id = v_capture;
  IF v_count <> 1 THEN RAISE EXCEPTION 'Offline retry created duplicate part rows'; END IF;

  BEGIN
    PERFORM * FROM public.sync_inbox_offline_text_capture(
      v_capture, v_part, 'different source must not overwrite original', now()
    );
  EXCEPTION WHEN unique_violation THEN
    v_conflict := true;
  END;
  IF NOT v_conflict THEN RAISE EXCEPTION 'Reused capture ID with changed source was not rejected'; END IF;

  BEGIN
    PERFORM * FROM public.sync_inbox_offline_text_capture(
      '019b7100-0000-4000-8000-000000000111'::uuid, v_part, v_source, now()
    );
  EXCEPTION WHEN invalid_parameter_value THEN
    v_invalid := true;
  END;
  IF NOT v_invalid THEN RAISE EXCEPTION 'Non-UUIDv7 capture identifier was not rejected'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.capture
    WHERE id = v_capture AND owner_user_id='019b7100-0000-7000-8000-000000000001'
      AND input_type='text' AND content_original=v_source
  ) THEN RAISE EXCEPTION 'Offline sync changed or lost the exact source text'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.capture_part
    WHERE capture_id=v_capture AND part_index=0 AND original_fragment=v_source
  ) THEN RAISE EXCEPTION 'Offline sync did not persist the exact initial part'; END IF;
END;
$test$;
RESET ROLE;

-- A different authenticated owner cannot read or replay another owner's id.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
DO $test$
DECLARE
  v_count bigint;
  v_denied boolean := false;
BEGIN
  SELECT count(*) INTO v_count
  FROM public.capture
  WHERE id='019b7100-0000-7000-8000-000000000101';
  IF v_count <> 0 THEN RAISE EXCEPTION 'Owner B can read Owner A offline capture'; END IF;

  BEGIN
    PERFORM * FROM public.sync_inbox_offline_text_capture(
      '019b7100-0000-7000-8000-000000000101',
      '019b7100-0000-7000-8000-000000000102',
      'Owner A source',
      now()
    );
  EXCEPTION WHEN insufficient_privilege THEN
    v_denied := true;
  END;
  IF NOT v_denied THEN RAISE EXCEPTION 'Owner B could replay Owner A capture ID'; END IF;
END;
$test$;
RESET ROLE;

ROLLBACK;
