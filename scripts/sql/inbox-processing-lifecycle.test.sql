-- Inbox processing lifecycle integration test. Run only on ephemeral CI Postgres.
BEGIN;

INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data
) VALUES
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','processing-owner-a-20261123@example.invalid','',now(),
   '{"provider":"email","providers":["email"]}'::jsonb,'{}'::jsonb),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','processing-owner-b-20261123@example.invalid','',now(),
   '{"provider":"email","providers":["email"]}'::jsonb,'{}'::jsonb)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.user_profile (id, auth_user_id, display_name)
VALUES
  ('019b1000-0000-7000-8000-000000000001','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Processing owner A'),
  ('019b1000-0000-7000-8000-000000000002','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','Processing owner B')
ON CONFLICT (id) DO NOTHING;

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
INSERT INTO public.capture (id, owner_user_id, created_by_user_id, content_original)
VALUES
  ('019b1000-0000-7000-8000-000000000101','019b1000-0000-7000-8000-000000000001','019b1000-0000-7000-8000-000000000001','Owner A pipeline capture'),
  ('019b1000-0000-7000-8000-000000000102','019b1000-0000-7000-8000-000000000001','019b1000-0000-7000-8000-000000000001','Owner A retry capture'),
  ('019b1000-0000-7000-8000-000000000103','019b1000-0000-7000-8000-000000000001','019b1000-0000-7000-8000-000000000001','Owner A max attempts capture');
RESET ROLE;

DO $test$
BEGIN
  IF has_table_privilege('authenticated','public.processing_run','INSERT')
     OR has_table_privilege('authenticated','public.processing_run','UPDATE')
     OR has_table_privilege('authenticated','public.processing_run','DELETE') THEN
    RAISE EXCEPTION 'authenticated must remain SELECT-only on processing_run';
  END IF;
  IF has_function_privilege('authenticated',
      'public.enqueue_inbox_processing_run(uuid,uuid,uuid,text,text)','EXECUTE')
     OR has_function_privilege('anon',
      'public.claim_inbox_processing_run(uuid,integer)','EXECUTE')
     OR has_function_privilege('authenticated',
      'public.complete_inbox_processing_run(uuid,uuid,jsonb)','EXECUTE')
     OR has_function_privilege('authenticated',
      'public.fail_inbox_processing_run(uuid,uuid,text,boolean,integer)','EXECUTE') THEN
    RAISE EXCEPTION 'Browser/API roles must not execute server-only processing functions';
  END IF;
  IF NOT has_function_privilege('service_role',
      'public.enqueue_inbox_processing_run(uuid,uuid,uuid,text,text)','EXECUTE')
     OR NOT has_function_privilege('service_role',
      'public.claim_inbox_processing_run(uuid,integer)','EXECUTE')
     OR NOT has_function_privilege('service_role',
      'public.complete_inbox_processing_run(uuid,uuid,jsonb)','EXECUTE')
     OR NOT has_function_privilege('service_role',
      'public.fail_inbox_processing_run(uuid,uuid,text,boolean,integer)','EXECUTE') THEN
    RAISE EXCEPTION 'service_role is missing a processing lifecycle execute grant';
  END IF;
END;
$test$;

SET LOCAL ROLE service_role;
DO $test$
DECLARE
  v_run uuid;
  v_status text;
  v_attempt integer;
  v_replayed boolean;
  v_active_id uuid;
  v_lease_a uuid := '00000000-0000-4000-8000-000000000001';
  v_lease_b uuid := '00000000-0000-4000-8000-000000000002';
  v_lease_c uuid := '00000000-0000-4000-8000-000000000003';
  v_job record;
  v_claim_count integer;
BEGIN
  SELECT run_id, run_status, attempt_number, replayed
    INTO v_run, v_status, v_attempt, v_replayed
  FROM public.enqueue_inbox_processing_run(
    '019b1000-0000-7000-8000-000000000201',
    '019b1000-0000-7000-8000-000000000001',
    '019b1000-0000-7000-8000-000000000101',
    '019b1000-0000-7000-8000-000000000301',
    'inbox-proposal-v1'
  );
  IF v_status <> 'queued' OR v_attempt <> 1 OR v_replayed THEN
    RAISE EXCEPTION 'Initial enqueue receipt was incorrect';
  END IF;

  SELECT run_id, replayed INTO v_active_id, v_replayed
  FROM public.enqueue_inbox_processing_run(
    '019b1000-0000-7000-8000-000000000202',
    '019b1000-0000-7000-8000-000000000001',
    '019b1000-0000-7000-8000-000000000101',
    '019b1000-0000-7000-8000-000000000301',
    'inbox-proposal-v1'
  );
  IF v_active_id <> v_run OR NOT v_replayed THEN
    RAISE EXCEPTION 'Same-key enqueue did not replay the original run';
  END IF;

  SELECT run_id, replayed INTO v_active_id, v_replayed
  FROM public.enqueue_inbox_processing_run(
    '019b1000-0000-7000-8000-000000000203',
    '019b1000-0000-7000-8000-000000000001',
    '019b1000-0000-7000-8000-000000000101',
    '019b1000-0000-7000-8000-000000000302',
    'inbox-proposal-v1'
  );
  IF v_active_id <> v_run OR NOT v_replayed THEN
    RAISE EXCEPTION 'Fresh key created duplicate active work';
  END IF;

  SELECT * INTO v_job FROM public.claim_inbox_processing_run(v_lease_a, 90);
  IF v_job.run_id <> v_run OR v_job.attempt_number <> 1
     OR v_job.content_original <> 'Owner A pipeline capture'
     OR v_job.lease_token <> v_lease_a THEN
    RAISE EXCEPTION 'Worker claim did not atomically lease the queued source';
  END IF;

  IF public.complete_inbox_processing_run(v_run, v_lease_b, '{"outcome":"stale"}'::jsonb) THEN
    RAISE EXCEPTION 'Wrong lease token completed a processing run';
  END IF;

  IF NOT public.fail_inbox_processing_run(v_run, v_lease_a, 'TEMPORARY_TIMEOUT', true, 0) THEN
    RAISE EXCEPTION 'Current lease could not mark a retryable failure';
  END IF;
  SELECT status, attempt_number INTO v_status, v_attempt
  FROM public.processing_run WHERE id = v_run;
  IF v_status <> 'retryable' OR v_attempt <> 1 THEN
    RAISE EXCEPTION 'Retryable state or attempt counter was incorrect';
  END IF;

  UPDATE public.processing_run SET next_attempt_at = now() - interval '1 second' WHERE id = v_run;
  SELECT * INTO v_job FROM public.claim_inbox_processing_run(v_lease_b, 90);
  IF v_job.run_id <> v_run OR v_job.attempt_number <> 2 THEN
    RAISE EXCEPTION 'Retry did not reclaim the job with an incremented attempt number';
  END IF;

  UPDATE public.processing_run
  SET lease_expires_at = now() - interval '1 second'
  WHERE id = v_run;
  SELECT * INTO v_job FROM public.claim_inbox_processing_run(v_lease_c, 90);
  IF v_job.run_id <> v_run OR v_job.attempt_number <> 3 OR v_job.lease_token <> v_lease_c THEN
    RAISE EXCEPTION 'Expired lease was not safely reclaimed';
  END IF;
  IF public.complete_inbox_processing_run(v_run, v_lease_b, '{"outcome":"stale"}'::jsonb) THEN
    RAISE EXCEPTION 'Old lease token remained valid after reclaim';
  END IF;
  IF NOT public.complete_inbox_processing_run(v_run, v_lease_c, '{"outcome":"validated"}'::jsonb) THEN
    RAISE EXCEPTION 'Current lease could not complete the run';
  END IF;

  SELECT status INTO v_status FROM public.processing_run WHERE id = v_run;
  IF v_status <> 'succeeded' THEN RAISE EXCEPTION 'Run did not reach succeeded'; END IF;
  SELECT processing_status INTO v_status FROM public.capture WHERE id = '019b1000-0000-7000-8000-000000000101';
  IF v_status <> 'processed' THEN RAISE EXCEPTION 'Capture status did not become processed'; END IF;

  SELECT run_id INTO v_run
  FROM public.enqueue_inbox_processing_run(
    '019b1000-0000-7000-8000-000000000204',
    '019b1000-0000-7000-8000-000000000001',
    '019b1000-0000-7000-8000-000000000103',
    '019b1000-0000-7000-8000-000000000303',
    'inbox-proposal-v1'
  );
  SELECT * INTO v_job FROM public.claim_inbox_processing_run(v_lease_a, 90);
  IF v_job.run_id <> v_run THEN RAISE EXCEPTION 'Expected max-attempt fixture to be claimed'; END IF;
  UPDATE public.processing_run
  SET attempt_number = 5, lease_expires_at = now() - interval '1 second'
  WHERE id = v_run;
  SELECT count(*) INTO v_claim_count FROM public.claim_inbox_processing_run(v_lease_b, 90);
  IF v_claim_count <> 0 THEN RAISE EXCEPTION 'Exhausted job was claimed again'; END IF;
  SELECT status INTO v_status FROM public.processing_run WHERE id = v_run;
  IF v_status <> 'failed' THEN RAISE EXCEPTION 'Exhausted job was not marked failed'; END IF;
  SELECT processing_status INTO v_status FROM public.capture WHERE id = '019b1000-0000-7000-8000-000000000103';
  IF v_status <> 'failed' THEN RAISE EXCEPTION 'Exhausted capture was not marked failed'; END IF;
END;
$test$;
RESET ROLE;

-- Owner B cannot read A's processing run through the existing owner-scoped RLS join.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
DO $test$
DECLARE v_count bigint;
BEGIN
  SELECT count(*) INTO v_count
  FROM public.processing_run pr
  JOIN public.capture c ON c.id = pr.capture_id
  WHERE c.id = '019b1000-0000-7000-8000-000000000101';
  IF v_count <> 0 THEN RAISE EXCEPTION 'Owner B can read Owner A processing runs'; END IF;
END;
$test$;
RESET ROLE;

ROLLBACK;
