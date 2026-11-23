-- Inbox capture RLS integration test. Run only against ephemeral CI Postgres.
-- Verifies that both capture rows and child parts remain isolated by the parent owner.
BEGIN;

INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data
) VALUES
  (
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'inbox-owner-a-20261123@example.invalid',
    '', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb
  ),
  (
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'inbox-owner-b-20261123@example.invalid',
    '', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb
  )
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.user_profile (id, auth_user_id, display_name)
VALUES
  ('019b0000-0000-7000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Inbox CI owner A'),
  ('019b0000-0000-7000-8000-000000000002', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Inbox CI owner B')
ON CONFLICT (id) DO NOTHING;

-- Owner A creates a source capture and its initial part through the same
-- authenticated role used by the browser client.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

INSERT INTO public.capture (
  id, owner_user_id, created_by_user_id, input_type, content_original
) VALUES (
  '019b0000-0000-7000-8000-000000000101',
  '019b0000-0000-7000-8000-000000000001',
  '019b0000-0000-7000-8000-000000000001',
  'text',
  '  Original A with surrounding whitespace  '
);

INSERT INTO public.capture_part (
  id, capture_id, part_index, original_fragment
) VALUES (
  '019b0000-0000-7000-8000-000000000201',
  '019b0000-0000-7000-8000-000000000101',
  0,
  '  Original A with surrounding whitespace  '
);

RESET ROLE;

-- Owner B cannot discover A's capture/part or attach a part to A's capture.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

DO $test$
DECLARE
  v_count bigint;
  v_capture_insert_denied boolean := false;
  v_part_insert_denied boolean := false;
BEGIN
  IF auth.uid() <> 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::uuid THEN
    RAISE EXCEPTION 'Inbox owner B JWT claim was not applied';
  END IF;

  SELECT count(*) INTO v_count
  FROM public.capture
  WHERE id = '019b0000-0000-7000-8000-000000000101';
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'Owner B can read owner A capture';
  END IF;

  SELECT count(*) INTO v_count
  FROM public.capture_part
  WHERE id = '019b0000-0000-7000-8000-000000000201';
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'Owner B can read owner A capture part';
  END IF;

  BEGIN
    INSERT INTO public.capture (
      id, owner_user_id, created_by_user_id, input_type, content_original
    ) VALUES (
      '019b0000-0000-7000-8000-000000000102',
      '019b0000-0000-7000-8000-000000000001',
      '019b0000-0000-7000-8000-000000000001',
      'text',
      'Forged owner A capture'
    );
  EXCEPTION WHEN insufficient_privilege THEN
    v_capture_insert_denied := true;
  END;

  IF NOT v_capture_insert_denied THEN
    RAISE EXCEPTION 'Owner B inserted a capture for owner A';
  END IF;

  BEGIN
    INSERT INTO public.capture_part (
      id, capture_id, part_index, original_fragment
    ) VALUES (
      '019b0000-0000-7000-8000-000000000202',
      '019b0000-0000-7000-8000-000000000101',
      1,
      'Forged child part'
    );
  EXCEPTION WHEN insufficient_privilege THEN
    v_part_insert_denied := true;
  END;

  IF NOT v_part_insert_denied THEN
    RAISE EXCEPTION 'Owner B attached a part to owner A capture';
  END IF;

  -- The policy must still permit an owner to insert their own source and part.
  INSERT INTO public.capture (
    id, owner_user_id, created_by_user_id, input_type, content_original
  ) VALUES (
    '019b0000-0000-7000-8000-000000000103',
    '019b0000-0000-7000-8000-000000000002',
    '019b0000-0000-7000-8000-000000000002',
    'text',
    'Owner B own capture'
  );

  INSERT INTO public.capture_part (
    id, capture_id, part_index, original_fragment
  ) VALUES (
    '019b0000-0000-7000-8000-000000000203',
    '019b0000-0000-7000-8000-000000000103',
    0,
    'Owner B own capture'
  );
END;
$test$;

RESET ROLE;

DO $test$
DECLARE
  v_count bigint;
BEGIN
  SELECT count(*) INTO v_count
  FROM public.capture
  WHERE id IN (
    '019b0000-0000-7000-8000-000000000101',
    '019b0000-0000-7000-8000-000000000103'
  );
  IF v_count <> 2 THEN
    RAISE EXCEPTION 'Expected exactly two owner-scoped source captures; got %', v_count;
  END IF;

  SELECT count(*) INTO v_count
  FROM public.capture_part
  WHERE capture_id IN (
    '019b0000-0000-7000-8000-000000000101',
    '019b0000-0000-7000-8000-000000000103'
  );
  IF v_count <> 2 THEN
    RAISE EXCEPTION 'Expected one part per owner capture; got %', v_count;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.capture
    WHERE id = '019b0000-0000-7000-8000-000000000101'
      AND content_original <> '  Original A with surrounding whitespace  '
  ) THEN
    RAISE EXCEPTION 'Capture original content was modified';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.capture_part
    WHERE id = '019b0000-0000-7000-8000-000000000201'
      AND original_fragment <> '  Original A with surrounding whitespace  '
  ) THEN
    RAISE EXCEPTION 'Initial capture part differs from original source';
  END IF;
END;
$test$;

ROLLBACK;
