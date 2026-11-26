-- Durable Inbox voice queue: claims, lease recovery, ambiguous outcomes,
-- idempotent completion, atomic processing_run creation and retention expiry.
BEGIN;

INSERT INTO auth.users(
  id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data
) VALUES (
  'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  '00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','voice-queue-test@example.invalid','',now(),
  '{"provider":"email","providers":["email"]}'::jsonb,'{}'::jsonb
) ON CONFLICT(id) DO NOTHING;

INSERT INTO public.user_profile(id,auth_user_id,display_name)
VALUES (
  '019b7300-0000-7000-8000-000000000001',
  'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  'Voice queue test owner'
) ON CONFLICT(id) DO NOTHING;

DO $test$
BEGIN
  IF has_table_privilege('anon','private.inbox_voice_transcription_job','SELECT')
     OR has_table_privilege('authenticated','private.inbox_voice_transcription_job','SELECT')
     OR has_table_privilege('service_role','private.inbox_voice_transcription_job','SELECT')
     OR has_table_privilege('anon','private.inbox_voice_transcription_attempt','SELECT')
     OR has_table_privilege('authenticated','private.inbox_voice_transcription_attempt','SELECT')
     OR has_table_privilege('service_role','private.inbox_voice_transcription_attempt','SELECT') THEN
    RAISE EXCEPTION 'Voice queue internals must not be directly readable by API roles';
  END IF;
  IF has_function_privilege('anon',
       'public.claim_inbox_voice_transcription_job(uuid,uuid,integer)','EXECUTE')
     OR has_function_privilege('authenticated',
       'public.claim_inbox_voice_transcription_job(uuid,uuid,integer)','EXECUTE')
     OR NOT has_function_privilege('service_role',
       'public.claim_inbox_voice_transcription_job(uuid,uuid,integer)','EXECUTE')
     OR has_function_privilege('authenticated',
       'public.mark_inbox_voice_transcription_request_started(uuid,uuid,text,text,text,text,text,jsonb)','EXECUTE')
     OR has_function_privilege('anon',
       'public.complete_inbox_voice_transcription_job(uuid,uuid,uuid,uuid,uuid,text,text,text,text)','EXECUTE')
     OR NOT has_function_privilege('service_role',
       'public.complete_inbox_voice_transcription_job(uuid,uuid,uuid,uuid,uuid,text,text,text,text)','EXECUTE')
     OR has_function_privilege('service_role',
       'public.record_inbox_voice_transcription(uuid,uuid,uuid,uuid,text,text,text,text)','EXECUTE') THEN
    RAISE EXCEPTION 'Voice queue RPC grants are not least-privilege';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='private' AND c.relname='inbox_voice_transcription_job'
      AND c.relrowsecurity=true
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='private' AND c.relname='inbox_voice_transcription_attempt'
      AND c.relrowsecurity=true
  ) THEN
    RAISE EXCEPTION 'RLS must be enabled on private voice queue tables';
  END IF;
END;
$test$;

-- Only asset 1 is initially uploadable. Assets 2 and 4 remain staging.
INSERT INTO public.capture_audio_asset(
  id,owner_user_id,created_by_user_id,bucket_id,object_path,mime_type,
  file_size_bytes,sha256_hex,status
) VALUES
 ('019b7300-0000-7000-8000-000000000101',
  '019b7300-0000-7000-8000-000000000001','019b7300-0000-7000-8000-000000000001',
  'inbox-voice-private',
  '019b7300-0000-7000-8000-000000000001/019b7300-0000-7000-8000-000000000101/source.webm',
  'audio/webm',4096,repeat('a',64),'uploading'),
 ('019b7300-0000-7000-8000-000000000102',
  '019b7300-0000-7000-8000-000000000001','019b7300-0000-7000-8000-000000000001',
  'inbox-voice-private',
  '019b7300-0000-7000-8000-000000000001/019b7300-0000-7000-8000-000000000102/source.webm',
  'audio/webm',4096,repeat('b',64),'uploading'),
 ('019b7300-0000-7000-8000-000000000103',
  '019b7300-0000-7000-8000-000000000001','019b7300-0000-7000-8000-000000000001',
  'inbox-voice-private',
  '019b7300-0000-7000-8000-000000000001/019b7300-0000-7000-8000-000000000103/source.webm',
  'audio/webm',4096,repeat('c',64),'uploading'),
 ('019b7300-0000-7000-8000-000000000104',
  '019b7300-0000-7000-8000-000000000001','019b7300-0000-7000-8000-000000000001',
  'inbox-voice-private',
  '019b7300-0000-7000-8000-000000000001/019b7300-0000-7000-8000-000000000104/source.webm',
  'audio/webm',4096,repeat('d',64),'uploading'),
 ('019b7300-0000-7000-8000-000000000105',
  '019b7300-0000-7000-8000-000000000001','019b7300-0000-7000-8000-000000000001',
  'inbox-voice-private',
  '019b7300-0000-7000-8000-000000000001/019b7300-0000-7000-8000-000000000105/source.webm',
  'audio/webm',4096,repeat('e',64),'uploading');

UPDATE public.capture_audio_asset
SET status='uploaded',uploaded_at=clock_timestamp()
WHERE id='019b7300-0000-7000-8000-000000000101';

UPDATE public.capture_audio_asset
SET retention_until=clock_timestamp()-interval '1 second',
    status='uploaded',uploaded_at=clock_timestamp()
WHERE id='019b7300-0000-7000-8000-000000000103';

DO $test$
BEGIN
  IF (SELECT count(*) FROM private.inbox_voice_transcription_job
      WHERE asset_id='019b7300-0000-7000-8000-000000000101' AND status='queued')<>1 THEN
    RAISE EXCEPTION 'Verified upload did not create exactly one durable queue row';
  END IF;
  IF (SELECT status FROM private.inbox_voice_transcription_job
      WHERE asset_id='019b7300-0000-7000-8000-000000000103')<>'expired' THEN
    RAISE EXCEPTION 'Already-expired upload was incorrectly queued';
  END IF;
END;
$test$;

SET LOCAL ROLE service_role;
DO $test$
DECLARE
  v_claim record;
  v_again record;
BEGIN
  SELECT * INTO v_claim
  FROM public.claim_inbox_voice_transcription_job(
    '019b7300-0000-7000-8000-000000000201',
    '00000000-0000-4000-8000-000000000201',60
  );
  IF NOT FOUND OR v_claim.asset_id<>'019b7300-0000-7000-8000-000000000101'
     OR v_claim.attempt_number<>1 THEN
    RAISE EXCEPTION 'Queue did not claim the uploaded asset exactly once';
  END IF;
  SELECT * INTO v_again
  FROM public.claim_inbox_voice_transcription_job(
    '019b7300-0000-7000-8000-000000000202',
    '00000000-0000-4000-8000-000000000202',60
  );
  IF FOUND THEN RAISE EXCEPTION 'A live voice lease was claimed twice'; END IF;
END;
$test$;
RESET ROLE;

-- Lease expiry before request_started is safe to reclaim.
UPDATE private.inbox_voice_transcription_job
SET lease_expires_at=clock_timestamp()-interval '1 second'
WHERE asset_id='019b7300-0000-7000-8000-000000000101';

SET LOCAL ROLE service_role;
DO $test$
DECLARE
  v_claim record;
  v_started boolean;
  v_state text;
BEGIN
  SELECT * INTO v_claim
  FROM public.claim_inbox_voice_transcription_job(
    '019b7300-0000-7000-8000-000000000203',
    '00000000-0000-4000-8000-000000000203',60
  );
  IF NOT FOUND OR v_claim.asset_id<>'019b7300-0000-7000-8000-000000000101'
     OR v_claim.attempt_number<>2 THEN
    RAISE EXCEPTION 'Pre-request expired lease was not safely reclaimed once';
  END IF;

  v_started := public.mark_inbox_voice_transcription_request_started(
    v_claim.asset_id,v_claim.lease_token,'test-provider','fixture-model','test-adapter',
    'us-west-2','inbox-speech-route-policy-v1',
    jsonb_build_object(
      'capability','evidence:capability','provider','evidence:provider',
      'model','evidence:model','adapter','evidence:adapter','account','evidence:account',
      'legalEligibility','evidence:legal','region','evidence:region',
      'privacy','evidence:privacy','quota','evidence:quota'
    )
  );
  IF NOT v_started THEN RAISE EXCEPTION 'Verified test route could not mark request_started'; END IF;
END;
$test$;
RESET ROLE;

-- A worker crash after request_started is ambiguous and must not auto-retry.
UPDATE private.inbox_voice_transcription_job
SET lease_expires_at=clock_timestamp()-interval '1 second'
WHERE asset_id='019b7300-0000-7000-8000-000000000101';

SET LOCAL ROLE service_role;
DO $test$
DECLARE
  v_claim record;
BEGIN
  SELECT * INTO v_claim
  FROM public.claim_inbox_voice_transcription_job(
    '019b7300-0000-7000-8000-000000000204',
    '00000000-0000-4000-8000-000000000204',60
  );
  IF FOUND THEN
    RAISE EXCEPTION 'Ambiguous provider outcome was automatically retried';
  END IF;
END;
$test$;
RESET ROLE;

-- Inspect private queue state as the database test owner, not service_role.
DO $test$
DECLARE
  v_state text;
BEGIN
  SELECT j.status INTO v_state
  FROM private.inbox_voice_transcription_job AS j
  WHERE j.asset_id='019b7300-0000-7000-8000-000000000101';
  IF v_state<>'manual_review' THEN
    RAISE EXCEPTION 'Expired post-request lease did not enter manual_review';
  END IF;
END;
$test$;

-- Release asset 2 first so its expected claim order is deterministic.
UPDATE public.capture_audio_asset
SET status='uploaded',uploaded_at=clock_timestamp()
WHERE id='019b7300-0000-7000-8000-000000000102';

SET LOCAL ROLE service_role;
DO $test$
DECLARE
  v_claim record;
  v_capture uuid := '019b7300-0000-7000-8000-000000000301';
  v_part uuid := '019b7300-0000-7000-8000-000000000302';
  v_run uuid := '019b7300-0000-7000-8000-000000000303';
  v_capture_out uuid;
  v_part_out uuid;
  v_run_out uuid;
  v_replayed boolean;
  v_count integer;
  v_conflict_rejected boolean := false;
BEGIN
  SELECT * INTO v_claim
  FROM public.claim_inbox_voice_transcription_job(
    '019b7300-0000-7000-8000-000000000205',
    '00000000-0000-4000-8000-000000000205',90
  );
  IF NOT FOUND OR v_claim.asset_id<>'019b7300-0000-7000-8000-000000000102' THEN
    RAISE EXCEPTION 'Next eligible voice asset was not claimed';
  END IF;

  IF NOT public.mark_inbox_voice_transcription_request_started(
    v_claim.asset_id,v_claim.lease_token,'test-provider','fixture-model','test-adapter',
    'us-west-2','inbox-speech-route-policy-v1',
    jsonb_build_object(
      'capability','evidence:capability','provider','evidence:provider',
      'model','evidence:model','adapter','evidence:adapter','account','evidence:account',
      'legalEligibility','evidence:legal','region','evidence:region',
      'privacy','evidence:privacy','quota','evidence:quota'
    )
  ) THEN RAISE EXCEPTION 'Completion fixture could not mark request_started'; END IF;

  SELECT capture_id,part_id,processing_run_id,replayed
  INTO v_capture_out,v_part_out,v_run_out,v_replayed
  FROM public.complete_inbox_voice_transcription_job(
    v_claim.asset_id,v_claim.lease_token,v_capture,v_part,v_run,
    'Transcripción sintética para probar el flujo.',
    'test-provider','fixture-model','us-west-2'
  );
  IF v_capture_out<>v_capture OR v_part_out<>v_part OR v_run_out<>v_run OR v_replayed THEN
    RAISE EXCEPTION 'Atomic voice completion returned an incorrect receipt';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.capture_audio_asset
    WHERE id=v_claim.asset_id AND status='transcribed'
      AND capture_id=v_capture
      AND transcript_text='Transcripción sintética para probar el flujo.'
      AND transcription_provider='test-provider'
      AND transcription_model='fixture-model'
      AND transcription_region='us-west-2'
      AND retention_until IS NULL
  ) THEN RAISE EXCEPTION 'Voice asset transcript provenance was not committed'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.capture
    WHERE id=v_capture AND input_type='voice'
      AND content_original='Transcripción sintética para probar el flujo.'
      AND processing_status='queued'
  ) OR NOT EXISTS (
    SELECT 1 FROM public.capture_part
    WHERE id=v_part AND capture_id=v_capture AND part_index=0
      AND original_fragment='Transcripción sintética para probar el flujo.'
  ) OR NOT EXISTS (
    SELECT 1 FROM public.processing_run
    WHERE id=v_run AND capture_id=v_capture
      AND processor_version='inbox-proposal-v1'
      AND status='queued' AND idempotency_key=v_claim.asset_id::text
  ) THEN
    RAISE EXCEPTION 'Capture, source part and Inbox processing_run were not committed atomically';
  END IF;

  SELECT capture_id,part_id,processing_run_id,replayed
  INTO v_capture_out,v_part_out,v_run_out,v_replayed
  FROM public.complete_inbox_voice_transcription_job(
    v_claim.asset_id,v_claim.lease_token,v_capture,v_part,v_run,
    'Transcripción sintética para probar el flujo.',
    'test-provider','fixture-model','us-west-2'
  );
  IF NOT v_replayed OR v_capture_out<>v_capture OR v_part_out<>v_part OR v_run_out<>v_run THEN
    RAISE EXCEPTION 'Exact completion replay was not idempotent';
  END IF;

  BEGIN
    PERFORM * FROM public.complete_inbox_voice_transcription_job(
      v_claim.asset_id,v_claim.lease_token,
      '019b7300-0000-7000-8000-000000000304',
      '019b7300-0000-7000-8000-000000000305',
      '019b7300-0000-7000-8000-000000000306',
      'Different transcript must not overwrite success.',
      'test-provider','fixture-model','us-west-2'
    );
  EXCEPTION WHEN SQLSTATE '55000' THEN
    v_conflict_rejected := true;
  END;
  IF NOT v_conflict_rejected THEN
    RAISE EXCEPTION 'Conflicting completion overwrote a committed transcript';
  END IF;

  SELECT count(*) INTO v_count FROM public.processing_run WHERE capture_id=v_capture;
  IF v_count<>1 THEN RAISE EXCEPTION 'Replay created a duplicate Inbox processing run'; END IF;
END;
$test$;
RESET ROLE;

-- Process asset 4 only after asset 2 reached success.
UPDATE public.capture_audio_asset
SET status='uploaded',uploaded_at=clock_timestamp()
WHERE id='019b7300-0000-7000-8000-000000000104';

SET LOCAL ROLE service_role;
DO $test$
DECLARE
  v_claim record;
  v_state text;
BEGIN
  SELECT * INTO v_claim
  FROM public.claim_inbox_voice_transcription_job(
    '019b7300-0000-7000-8000-000000000207',
    '00000000-0000-4000-8000-000000000207',90
  );
  IF NOT FOUND OR v_claim.asset_id<>'019b7300-0000-7000-8000-000000000104' THEN
    RAISE EXCEPTION 'Fourth voice asset was not claimed';
  END IF;
  IF NOT public.mark_inbox_voice_transcription_request_started(
    v_claim.asset_id,v_claim.lease_token,'test-provider','fixture-model','test-adapter',
    'us-west-2','inbox-speech-route-policy-v1',
    jsonb_build_object(
      'capability','evidence:capability','provider','evidence:provider',
      'model','evidence:model','adapter','evidence:adapter','account','evidence:account',
      'legalEligibility','evidence:legal','region','evidence:region',
      'privacy','evidence:privacy','quota','evidence:quota'
    )
  ) THEN RAISE EXCEPTION 'Failure fixture could not mark request_started'; END IF;
  v_state := public.fail_inbox_voice_transcription_job(
    v_claim.asset_id,v_claim.lease_token,'UPSTREAM_TIMEOUT',0
  );
  IF v_state<>'manual_review' THEN
    RAISE EXCEPTION 'Post-request failure was incorrectly auto-retried';
  END IF;
END;
$test$;
RESET ROLE;

-- A lease does not authorize a provider request after the source TTL expires.
UPDATE public.capture_audio_asset
SET status='uploaded',uploaded_at=clock_timestamp()
WHERE id='019b7300-0000-7000-8000-000000000105';

SET LOCAL ROLE service_role;
DO $test$
DECLARE
  v_claim record;
BEGIN
  SELECT * INTO v_claim
  FROM public.claim_inbox_voice_transcription_job(
    '019b7300-0000-7000-8000-000000000208',
    '00000000-0000-4000-8000-000000000208',90
  );
  IF NOT FOUND OR v_claim.asset_id<>'019b7300-0000-7000-8000-000000000105' THEN
    RAISE EXCEPTION 'Fifth voice asset was not claimed for TTL boundary test';
  END IF;
END;
$test$;
RESET ROLE;

UPDATE public.capture_audio_asset
SET retention_until=clock_timestamp()-interval '1 second'
WHERE id='019b7300-0000-7000-8000-000000000105';

SET LOCAL ROLE service_role;
DO $test$
DECLARE
  v_started boolean;
BEGIN
  v_started := public.mark_inbox_voice_transcription_request_started(
    '019b7300-0000-7000-8000-000000000105',
    '00000000-0000-4000-8000-000000000208',
    'test-provider','fixture-model','test-adapter','us-west-2',
    'inbox-speech-route-policy-v1',
    jsonb_build_object(
      'capability','evidence:capability','provider','evidence:provider',
      'model','evidence:model','adapter','evidence:adapter','account','evidence:account',
      'legalEligibility','evidence:legal','region','evidence:region',
      'privacy','evidence:privacy','quota','evidence:quota'
    )
  );
  IF v_started THEN
    RAISE EXCEPTION 'Expired voice source was allowed to start a provider request';
  END IF;
END;
$test$;
RESET ROLE;

DO $test$
BEGIN
  IF (SELECT status FROM private.inbox_voice_transcription_job
      WHERE asset_id='019b7300-0000-7000-8000-000000000105')<>'expired'
     OR (SELECT status FROM private.inbox_voice_transcription_attempt
      WHERE asset_id='019b7300-0000-7000-8000-000000000105'
        AND attempt_number=1)<>'expired' THEN
    RAISE EXCEPTION 'Expired source TTL did not expire its active lease and attempt';
  END IF;
END;
$test$;

DO $test$
BEGIN
  IF (SELECT status FROM private.inbox_voice_transcription_job
      WHERE asset_id='019b7300-0000-7000-8000-000000000104')<>'manual_review' THEN
    RAISE EXCEPTION 'Ambiguous failure did not persist manual_review';
  END IF;
  IF (SELECT status FROM private.inbox_voice_transcription_job
      WHERE asset_id='019b7300-0000-7000-8000-000000000103')<>'expired' THEN
    RAISE EXCEPTION 'Expired upload became eligible for transcription';
  END IF;
  IF (SELECT retention_until FROM public.capture_audio_asset
      WHERE id='019b7300-0000-7000-8000-000000000101')<=clock_timestamp() THEN
    RAISE EXCEPTION 'Queue retry unexpectedly extended or corrupted source retention';
  END IF;
END;
$test$;

ROLLBACK;
