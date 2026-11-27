-- Persist a transcript that was explicitly requested and produced by Whisper in the owner's browser.
-- This RPC never downloads audio, calls a provider, or changes the private Storage object.
BEGIN;

-- The privileged implementation lives outside the exposed Data API schemas.
CREATE OR REPLACE FUNCTION private.record_inbox_voice_transcription_local_impl(
  p_asset_id uuid,
  p_capture_id uuid,
  p_part_id uuid,
  p_transcript_text text
)
RETURNS TABLE(capture_id uuid, part_id uuid, replayed boolean)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_owner_profile_id uuid;
  v_asset public.capture_audio_asset%ROWTYPE;
  v_existing_part_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'A signed-in user is required' USING ERRCODE='42501';
  END IF;

  SELECT up.id INTO v_owner_profile_id
  FROM public.user_profile AS up
  WHERE up.auth_user_id=auth.uid() AND up.account_status='active';
  IF v_owner_profile_id IS NULL THEN
    RAISE EXCEPTION 'An active SimpleLife profile is required' USING ERRCODE='42501';
  END IF;

  IF p_asset_id IS NULL OR p_capture_id IS NULL OR p_part_id IS NULL
     OR (pg_catalog.get_byte(pg_catalog.uuid_send(p_asset_id),6) >> 4)<>7
     OR (pg_catalog.get_byte(pg_catalog.uuid_send(p_asset_id),8) & 192)<>128
     OR (pg_catalog.get_byte(pg_catalog.uuid_send(p_capture_id),6) >> 4)<>7
     OR (pg_catalog.get_byte(pg_catalog.uuid_send(p_capture_id),8) & 192)<>128
     OR (pg_catalog.get_byte(pg_catalog.uuid_send(p_part_id),6) >> 4)<>7
     OR (pg_catalog.get_byte(pg_catalog.uuid_send(p_part_id),8) & 192)<>128
     OR p_transcript_text IS NULL
     OR pg_catalog.length(pg_catalog.btrim(p_transcript_text))=0
     OR pg_catalog.length(p_transcript_text)>20000 THEN
    RAISE EXCEPTION 'Local voice transcription arguments are invalid' USING ERRCODE='22023';
  END IF;

  SELECT aa.* INTO v_asset
  FROM public.capture_audio_asset AS aa
  WHERE aa.id=p_asset_id AND aa.owner_user_id=v_owner_profile_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Private voice asset is unavailable to this owner' USING ERRCODE='42501';
  END IF;

  IF v_asset.status='transcribed'
     AND v_asset.transcription_provider='whisper.cpp-local'
     AND v_asset.transcript_text=p_transcript_text
     AND v_asset.capture_id IS NOT NULL THEN
    SELECT cp.id INTO v_existing_part_id
    FROM public.capture_part AS cp
    WHERE cp.capture_id=v_asset.capture_id
      AND cp.part_index=0
      AND cp.original_fragment=p_transcript_text;
    IF v_existing_part_id IS NULL THEN
      RAISE EXCEPTION 'Local voice transcript exists but its source part is unavailable' USING ERRCODE='55000';
    END IF;
    RETURN QUERY SELECT v_asset.capture_id,v_existing_part_id,true;
    RETURN;
  END IF;

  IF v_asset.status<>'uploaded'
     OR v_asset.capture_id IS NOT NULL
     OR v_asset.retention_until IS NULL
     OR v_asset.retention_until<=pg_catalog.clock_timestamp() THEN
    RAISE EXCEPTION 'Private audio is no longer eligible for local transcription' USING ERRCODE='55000';
  END IF;

  INSERT INTO public.capture(
    id,owner_user_id,created_by_user_id,input_type,content_original,captured_at,sync_status
  ) VALUES (
    p_capture_id,v_owner_profile_id,v_owner_profile_id,'voice',
    p_transcript_text,v_asset.created_at,'synced'
  );

  INSERT INTO public.capture_part(id,capture_id,part_index,original_fragment)
  VALUES(p_part_id,p_capture_id,0,p_transcript_text);

  UPDATE public.capture_audio_asset AS aa
  SET capture_id=p_capture_id,
      transcript_text=p_transcript_text,
      transcription_provider='whisper.cpp-local',
      transcription_model='ggml-tiny-q5_1@0b364b566045a405be7225ee1e415a073e04da77',
      transcription_region='device-local',
      status='transcribed',
      transcribed_at=pg_catalog.clock_timestamp(),
      retention_until=NULL,
      updated_at=pg_catalog.clock_timestamp()
  WHERE aa.id=p_asset_id AND aa.owner_user_id=v_owner_profile_id;

  RETURN QUERY SELECT p_capture_id,p_part_id,false;
END;
$function$;

ALTER FUNCTION private.record_inbox_voice_transcription_local_impl(uuid,uuid,uuid,text)
  OWNER TO postgres;
REVOKE ALL PRIVILEGES
ON FUNCTION private.record_inbox_voice_transcription_local_impl(uuid,uuid,uuid,text)
FROM PUBLIC, anon, authenticated, service_role;

-- The Data API sees only this invoker wrapper in public. The owner-bound
-- SECURITY DEFINER implementation is not in an exposed schema.
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated, service_role;
GRANT USAGE ON SCHEMA private TO authenticated;
GRANT EXECUTE
ON FUNCTION private.record_inbox_voice_transcription_local_impl(uuid,uuid,uuid,text)
TO authenticated;

CREATE OR REPLACE FUNCTION public.record_inbox_voice_transcription_local(
  p_asset_id uuid,
  p_capture_id uuid,
  p_part_id uuid,
  p_transcript_text text
)
RETURNS TABLE(capture_id uuid, part_id uuid, replayed boolean)
LANGUAGE sql
VOLATILE
SECURITY INVOKER
SET search_path = pg_catalog
AS $function$
  SELECT result.capture_id,result.part_id,result.replayed
  FROM private.record_inbox_voice_transcription_local_impl(
    p_asset_id,p_capture_id,p_part_id,p_transcript_text
  ) AS result;
$function$;

ALTER FUNCTION public.record_inbox_voice_transcription_local(uuid,uuid,uuid,text)
  OWNER TO postgres;
REVOKE ALL PRIVILEGES
ON FUNCTION public.record_inbox_voice_transcription_local(uuid,uuid,uuid,text)
FROM PUBLIC, anon, service_role;
GRANT EXECUTE
ON FUNCTION public.record_inbox_voice_transcription_local(uuid,uuid,uuid,text)
TO authenticated;

COMMIT;
