-- Private voice source storage: owner isolation, immutable source metadata,
-- transcript provenance, and bounded retention for unlinked/trashed audio.
BEGIN;

INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data
) VALUES
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','voice-owner-a-20261123@example.invalid','',now(),
   '{"provider":"email","providers":["email"]}'::jsonb,'{}'::jsonb),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','voice-owner-b-20261123@example.invalid','',now(),
   '{"provider":"email","providers":["email"]}'::jsonb,'{}'::jsonb)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.user_profile (id, auth_user_id, display_name)
VALUES
  ('019b7200-0000-7000-8000-000000000001','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Voice owner A'),
  ('019b7200-0000-7000-8000-000000000002','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','Voice owner B')
ON CONFLICT (id) DO NOTHING;

DO $test$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM storage.buckets
    WHERE id='inbox-voice-private' AND public=false AND file_size_limit=26214400
  ) THEN RAISE EXCEPTION 'Voice bucket must be private and limited to 25 MiB'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='storage' AND tablename='objects'
      AND policyname='inbox_voice_private_owner_insert'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='storage' AND tablename='objects'
      AND policyname='inbox_voice_private_owner_select'
  ) THEN
    RAISE EXCEPTION 'Private voice Storage policies are missing';
  END IF;
  IF has_table_privilege('authenticated','public.capture_audio_asset','DELETE') THEN
    RAISE EXCEPTION 'Authenticated users must not physically delete voice asset metadata';
  END IF;
  IF NOT has_function_privilege('authenticated',
       'public.finalize_inbox_audio_upload(uuid,integer,text)','EXECUTE')
     OR has_function_privilege('authenticated',
       'public.record_inbox_voice_transcription(uuid,uuid,uuid,uuid,text,text,text,text)','EXECUTE')
     OR has_function_privilege('anon',
       'public.record_inbox_voice_transcription(uuid,uuid,uuid,uuid,text,text,text,text)','EXECUTE')
     OR NOT has_function_privilege('service_role',
       'public.record_inbox_voice_transcription(uuid,uuid,uuid,uuid,text,text,text,text)','EXECUTE') THEN
    RAISE EXCEPTION 'Voice transcription must be callable by trusted service_role only';
  END IF;
  IF has_table_privilege('service_role','public.audit_event','INSERT') THEN
    RAISE EXCEPTION 'Audio retention must not grant direct audit_event INSERT';
  END IF;
END;
$test$;

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
INSERT INTO public.capture_audio_asset (
  id, owner_user_id, created_by_user_id, bucket_id, object_path,
  mime_type, file_size_bytes, sha256_hex
) VALUES (
  '019b7200-0000-7000-8000-000000000101',
  '019b7200-0000-7000-8000-000000000001',
  '019b7200-0000-7000-8000-000000000001',
  'inbox-voice-private',
  '019b7200-0000-7000-8000-000000000001/019b7200-0000-7000-8000-000000000101/source.webm',
  'audio/webm', 4096, repeat('a',64)
);

INSERT INTO storage.objects (bucket_id, name, owner_id, metadata)
VALUES (
  'inbox-voice-private',
  '019b7200-0000-7000-8000-000000000001/019b7200-0000-7000-8000-000000000101/source.webm',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  jsonb_build_object('size','4096','mimetype','audio/webm')
);

DO $test$
DECLARE
  v_capture uuid;
  v_part uuid;
  v_retention timestamptz;
  v_expired_asset uuid := '019b7200-0000-7000-8000-000000000102';
  v_count integer;
BEGIN
  IF NOT public.finalize_inbox_audio_upload(
    '019b7200-0000-7000-8000-000000000101',4096,repeat('a',64)
  ) THEN RAISE EXCEPTION 'Owner A could not finalize private audio upload'; END IF;

  IF NOT public.finalize_inbox_audio_upload(
    '019b7200-0000-7000-8000-000000000101',4096,repeat('a',64)
  ) THEN RAISE EXCEPTION 'Owner A could not finalize private audio upload'; END IF;

  -- An unattached upload expires after its seven-day staging window.
  INSERT INTO public.capture_audio_asset (
    id,owner_user_id,created_by_user_id,bucket_id,object_path,mime_type,
    file_size_bytes,sha256_hex,retention_until,status
  ) VALUES (
    v_expired_asset,'019b7200-0000-7000-8000-000000000001',
    '019b7200-0000-7000-8000-000000000001','inbox-voice-private',
    '019b7200-0000-7000-8000-000000000001/019b7200-0000-7000-8000-000000000102/source.webm',
    'audio/webm',1024,repeat('b',64),now()-interval '1 second','uploaded'
  );
END;
$test$;
RESET ROLE;

-- Only the trusted backend may attach a provider-attributed transcript.
SET LOCAL ROLE service_role;
DO $test$
DECLARE
  v_capture uuid;
  v_part uuid;
BEGIN
  SELECT capture_id, part_id INTO v_capture, v_part
  FROM public.record_inbox_voice_transcription(
    '019b7200-0000-7000-8000-000000000001',
    '019b7200-0000-7000-8000-000000000101',
    '019b7200-0000-7000-8000-000000000103',
    '019b7200-0000-7000-8000-000000000104',
    'Texto transcrito de prueba.',
    'test-provider','fixture-model','us-west-2'
  );
  IF v_capture <> '019b7200-0000-7000-8000-000000000103'
     OR v_part <> '019b7200-0000-7000-8000-000000000104' THEN
    RAISE EXCEPTION 'Trusted voice transcription did not produce its capture/part';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.capture
    WHERE id=v_capture AND input_type='voice'
      AND content_original='Texto transcrito de prueba.'
  ) OR NOT EXISTS (
    SELECT 1 FROM public.capture_part
    WHERE capture_id=v_capture AND part_index=0
      AND original_fragment='Texto transcrito de prueba.'
  ) THEN
    RAISE EXCEPTION 'Voice transcript was not persisted as derived searchable text';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.capture_audio_asset
    WHERE id='019b7200-0000-7000-8000-000000000101'
      AND capture_id=v_capture AND status='transcribed'
      AND transcription_provider='test-provider'
      AND transcription_model='fixture-model'
      AND transcription_region='us-west-2'
      AND retention_until IS NULL
  ) THEN
    RAISE EXCEPTION 'Original audio was not linked to its server-attributed transcript';
  END IF;
END;
$test$;
RESET ROLE;

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
DO $test$
BEGIN
  IF NOT public.trash_inbox_capture(
    '019b7200-0000-7000-8000-000000000103',
    '019b7200-0000-7000-8000-000000000105'
  ) THEN RAISE EXCEPTION 'Voice capture could not enter the normal 30-day trash lifecycle'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.capture_audio_asset aa
    JOIN public.capture c ON c.id=aa.capture_id
    WHERE aa.id='019b7200-0000-7000-8000-000000000101'
      AND aa.retention_until=c.purge_after
  ) THEN
    RAISE EXCEPTION 'Audio retention is not synchronized with the capture recovery window';
  END IF;
END;
$test$;
RESET ROLE;

-- Owner B cannot inspect Owner A's private voice metadata or finalize its upload.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
DO $test$
DECLARE v_count bigint; v_denied boolean := false;
BEGIN
  SELECT count(*) INTO v_count FROM public.capture_audio_asset;
  IF v_count <> 0 THEN RAISE EXCEPTION 'Owner B can read Owner A private voice assets'; END IF;
  BEGIN
    PERFORM public.finalize_inbox_audio_upload(
      '019b7200-0000-7000-8000-000000000101',4096,repeat('a',64)
    );
  EXCEPTION WHEN insufficient_privilege THEN v_denied := true;
  END;
  IF NOT v_denied THEN RAISE EXCEPTION 'Owner B could finalize Owner A audio upload'; END IF;
END;
$test$;
RESET ROLE;

-- The service role only uses narrow definer RPCs; it receives no direct audit grant.
SET LOCAL ROLE service_role;
DO $test$
DECLARE
  v_assets uuid[];
  v_paths text[];
  v_deleted integer;
BEGIN
  SELECT array_agg(asset_id ORDER BY asset_id), array_agg(object_path ORDER BY asset_id)
    INTO v_assets, v_paths
  FROM public.list_expired_inbox_audio_assets(10);
  IF v_assets IS NULL OR NOT ('019b7200-0000-7000-8000-000000000102' = ANY(v_assets)) THEN
    RAISE EXCEPTION 'Unattached expired voice asset was not selected for object deletion';
  END IF;
  IF NOT has_function_privilege('service_role',
       'public.complete_inbox_audio_asset_purge(uuid[],uuid[])','EXECUTE') THEN
    RAISE EXCEPTION 'Service role cannot complete audio object deletion';
  END IF;
  IF has_table_privilege('service_role','public.audit_event','SELECT')
     OR has_table_privilege('service_role','public.audit_event','INSERT') THEN
    RAISE EXCEPTION 'Audio purge must not grant direct audit_event privileges';
  END IF;
  IF cardinality(v_assets) <> 1 THEN
    RAISE EXCEPTION 'Expected exactly one unattached expired audio fixture, found %', cardinality(v_assets);
  END IF;
  SELECT public.complete_inbox_audio_asset_purge(
    v_assets,
    ARRAY['019b7200-0000-7000-8000-000000000201'::uuid]
  ) INTO v_deleted;
  IF v_deleted <> cardinality(v_assets) THEN
    RAISE EXCEPTION 'Audio metadata purge count did not match the expired assets';
  END IF;
END;
$test$;
RESET ROLE;

DO $test$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.capture_audio_asset
    WHERE id='019b7200-0000-7000-8000-000000000102'
  ) THEN RAISE EXCEPTION 'Expired audio metadata was not removed after object deletion receipt'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.audit_event
    WHERE action='capture.audio_purged'
      AND entity_id='019b7200-0000-7000-8000-000000000102'
      AND source='system'
      AND details->>'object_removed'='true'
  ) THEN RAISE EXCEPTION 'Audio retention audit receipt is missing'; END IF;
END;
$test$;

ROLLBACK;
