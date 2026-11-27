-- Owner-scoped persistence for a transcript produced locally from a selected private Inbox recording.
BEGIN;

INSERT INTO auth.users (
  id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data
) VALUES
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa61','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','voice-local-a@example.invalid','',now(),
   '{"provider":"email","providers":["email"]}'::jsonb,'{}'::jsonb),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb62','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','voice-local-b@example.invalid','',now(),
   '{"provider":"email","providers":["email"]}'::jsonb,'{}'::jsonb)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.user_profile(id,auth_user_id,display_name)
VALUES
  ('019b7200-0000-7000-8000-000000000061','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa61','Local voice owner A'),
  ('019b7200-0000-7000-8000-000000000062','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb62','Local voice owner B')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.capture_audio_asset(
  id,owner_user_id,created_by_user_id,bucket_id,object_path,mime_type,
  file_size_bytes,sha256_hex,status,uploaded_at,retention_until
) VALUES (
  '019b7200-0000-7000-8000-000000000063',
  '019b7200-0000-7000-8000-000000000061',
  '019b7200-0000-7000-8000-000000000061',
  'inbox-voice-private',
  '019b7200-0000-7000-8000-000000000061/019b7200-0000-7000-8000-000000000063/source.webm',
  'audio/webm',4096,repeat('a',64),'uploaded',now(),now()+interval '7 days'
);

DO $test$
BEGIN
  IF NOT has_function_privilege('authenticated',
       'public.record_inbox_voice_transcription_local(uuid,uuid,uuid,text)','EXECUTE')
     OR has_function_privilege('anon',
       'public.record_inbox_voice_transcription_local(uuid,uuid,uuid,text)','EXECUTE')
     OR has_function_privilege('service_role',
       'public.record_inbox_voice_transcription_local(uuid,uuid,uuid,text)','EXECUTE')
     OR has_function_privilege('authenticated',
       'private.record_inbox_voice_transcription_local_impl(uuid,uuid,uuid,text)','EXECUTE')
     OR has_function_privilege('anon',
       'private.record_inbox_voice_transcription_local_impl(uuid,uuid,uuid,text)','EXECUTE')
     OR has_function_privilege('service_role',
       'private.record_inbox_voice_transcription_local_impl(uuid,uuid,uuid,text)','EXECUTE')
     OR has_schema_privilege('authenticated','private','USAGE')
     OR has_schema_privilege('anon','private','USAGE')
     OR has_schema_privilege('service_role','private','USAGE') THEN
    RAISE EXCEPTION 'Local transcript RPC privileges do not match the authenticated-only public wrapper contract';
  END IF;

  IF (
    SELECT p.prosecdef
    FROM pg_catalog.pg_proc AS p
    JOIN pg_catalog.pg_namespace AS n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='record_inbox_voice_transcription_local'
  ) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'The public authenticated-only API wrapper must be SECURITY DEFINER';
  END IF;

  IF (
    SELECT p.prosecdef
    FROM pg_catalog.pg_proc AS p
    JOIN pg_catalog.pg_namespace AS n ON n.oid=p.pronamespace
    WHERE n.nspname='private' AND p.proname='record_inbox_voice_transcription_local_impl'
  ) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Only the private implementation may use SECURITY DEFINER';
  END IF;
  IF has_table_privilege('authenticated','public.capture_audio_asset','UPDATE')
     OR has_table_privilege('authenticated','public.capture_audio_asset','DELETE') THEN
    RAISE EXCEPTION 'Authenticated browser must not receive direct audio asset mutation privileges';
  END IF;
END;
$test$;

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa61';

DO $test$
DECLARE
  v_capture uuid;
  v_part uuid;
  v_replayed boolean;
  v_replay_capture uuid;
  v_replay_part uuid;
  v_conflict_denied boolean := false;
BEGIN
  SELECT result.capture_id,result.part_id,result.replayed
  INTO v_capture,v_part,v_replayed
  FROM public.record_inbox_voice_transcription_local(
    '019b7200-0000-7000-8000-000000000063',
    '019b7200-0000-7000-8000-000000000064',
    '019b7200-0000-7000-8000-000000000065',
    'Comprar carne de cerdo y pavo.'
  ) AS result;

  IF v_capture<>'019b7200-0000-7000-8000-000000000064'
     OR v_part<>'019b7200-0000-7000-8000-000000000065'
     OR v_replayed THEN
    RAISE EXCEPTION 'Local voice transcript did not create the expected Inbox capture';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.capture
    WHERE id=v_capture AND owner_user_id='019b7200-0000-7000-8000-000000000061'
      AND input_type='voice' AND content_original='Comprar carne de cerdo y pavo.'
  ) OR NOT EXISTS (
    SELECT 1 FROM public.capture_part
    WHERE id=v_part AND capture_id=v_capture AND part_index=0
      AND original_fragment='Comprar carne de cerdo y pavo.'
  ) THEN
    RAISE EXCEPTION 'Local voice transcript capture/part pair was not persisted';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.capture_audio_asset
    WHERE id='019b7200-0000-7000-8000-000000000063'
      AND capture_id=v_capture AND status='transcribed'
      AND transcript_text='Comprar carne de cerdo y pavo.'
      AND transcription_provider='whisper.cpp-local'
      AND transcription_model='ggml-tiny-q5_1@0b364b566045a405be7225ee1e415a073e04da77'
      AND transcription_region='device-local'
      AND retention_until IS NULL
  ) THEN
    RAISE EXCEPTION 'Local transcript provenance did not retain the source link';
  END IF;

  SELECT result.capture_id,result.part_id,result.replayed
  INTO v_replay_capture,v_replay_part,v_replayed
  FROM public.record_inbox_voice_transcription_local(
    '019b7200-0000-7000-8000-000000000063',
    '019b7200-0000-7000-8000-000000000066',
    '019b7200-0000-7000-8000-000000000067',
    'Comprar carne de cerdo y pavo.'
  ) AS result;
  IF v_replay_capture<>v_capture OR v_replay_part<>v_part OR NOT v_replayed THEN
    RAISE EXCEPTION 'Lost-acknowledgement retry did not replay the same transcript/capture';
  END IF;

  BEGIN
    PERFORM * FROM public.record_inbox_voice_transcription_local(
      '019b7200-0000-7000-8000-000000000063',
      '019b7200-0000-7000-8000-000000000068',
      '019b7200-0000-7000-8000-000000000069',
      'A conflicting replacement transcript.'
    );
  EXCEPTION WHEN SQLSTATE '55000' THEN
    v_conflict_denied := true;
  END;
  IF NOT v_conflict_denied THEN
    RAISE EXCEPTION 'Conflicting transcript replay was not rejected';
  END IF;

  IF (SELECT count(*) FROM public.capture WHERE id IN (v_capture,'019b7200-0000-7000-8000-000000000068'))<>1 THEN
    RAISE EXCEPTION 'A replay created a duplicate voice capture';
  END IF;
END;
$test$;

RESET ROLE;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb62';
DO $test$
DECLARE
  v_denied boolean := false;
BEGIN
  BEGIN
    PERFORM * FROM public.record_inbox_voice_transcription_local(
      '019b7200-0000-7000-8000-000000000063',
      '019b7200-0000-7000-8000-000000000070',
      '019b7200-0000-7000-8000-000000000071',
      'Attempt to transcribe another owner audio.'
    );
  EXCEPTION WHEN insufficient_privilege THEN
    v_denied := true;
  END;
  IF NOT v_denied THEN
    RAISE EXCEPTION 'Another account transcribed an audio asset it does not own';
  END IF;
END;
$test$;
RESET ROLE;

ROLLBACK;
