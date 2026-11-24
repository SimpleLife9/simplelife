-- Private voice source assets. The raw audio remains in a private Storage bucket;
-- transcript text is derived data and is stored separately from the audio object.
BEGIN;

INSERT INTO storage.buckets (
  id, name, public, file_size_limit, allowed_mime_types
) VALUES (
  'inbox-voice-private',
  'inbox-voice-private',
  false,
  26214400,
  ARRAY['audio/webm','audio/ogg','audio/mp4','audio/wav','audio/mpeg']
)
ON CONFLICT (id) DO NOTHING;

DO $check_bucket$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM storage.buckets
    WHERE id='inbox-voice-private' AND public=false
      AND file_size_limit <= 26214400
  ) THEN
    RAISE EXCEPTION 'Inbox voice bucket must remain private and capped at 25 MiB';
  END IF;
END;
$check_bucket$;

CREATE TABLE public.capture_audio_asset (
  id uuid PRIMARY KEY,
  owner_user_id uuid NOT NULL REFERENCES public.user_profile(id) ON DELETE RESTRICT,
  created_by_user_id uuid NOT NULL REFERENCES public.user_profile(id) ON DELETE RESTRICT,
  capture_id uuid REFERENCES public.capture(id) ON DELETE RESTRICT,
  bucket_id text NOT NULL DEFAULT 'inbox-voice-private'
    CHECK (bucket_id='inbox-voice-private'),
  object_path text NOT NULL UNIQUE,
  mime_type text NOT NULL
    CHECK (mime_type IN ('audio/webm','audio/ogg','audio/mp4','audio/wav','audio/mpeg')),
  file_size_bytes integer NOT NULL
    CHECK (file_size_bytes BETWEEN 1 AND 26214400),
  sha256_hex text NOT NULL CHECK (sha256_hex ~ '^[0-9a-f]{64}$'),
  status text NOT NULL DEFAULT 'uploading'
    CHECK (status IN ('uploading','uploaded','transcribed','failed','deletion_pending')),
  transcript_text text,
  transcription_provider text,
  transcription_model text,
  transcription_region text,
  uploaded_at timestamptz,
  transcribed_at timestamptz,
  retention_until timestamptz DEFAULT (clock_timestamp() + interval '7 days'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((get_byte(uuid_send(id),6) >> 4)=7 AND (get_byte(uuid_send(id),8) & 192)=128),
  CHECK (
    object_path = owner_user_id::text || '/' || id::text || '/source.' ||
    CASE mime_type
      WHEN 'audio/webm' THEN 'webm'
      WHEN 'audio/ogg' THEN 'ogg'
      WHEN 'audio/mp4' THEN 'm4a'
      WHEN 'audio/wav' THEN 'wav'
      WHEN 'audio/mpeg' THEN 'mp3'
    END
  ),
  CHECK (
    (status <> 'transcribed')
    OR (
      capture_id IS NOT NULL AND transcript_text IS NOT NULL
      AND length(btrim(transcript_text)) > 0 AND transcribed_at IS NOT NULL
    )
  ),
  CHECK (
    (status <> 'uploaded') OR uploaded_at IS NOT NULL
  )
);

ALTER TABLE public.capture_audio_asset ENABLE ROW LEVEL SECURITY;

CREATE POLICY capture_audio_asset_owner_select
ON public.capture_audio_asset FOR SELECT TO authenticated
USING (
  owner_user_id IN (
    SELECT up.id FROM public.user_profile up
    WHERE up.auth_user_id=(SELECT auth.uid()) AND up.account_status='active'
  )
);

CREATE POLICY capture_audio_asset_owner_insert
ON public.capture_audio_asset FOR INSERT TO authenticated
WITH CHECK (
  owner_user_id IN (
    SELECT up.id FROM public.user_profile up
    WHERE up.auth_user_id=(SELECT auth.uid()) AND up.account_status='active'
  )
  AND created_by_user_id IN (
    SELECT up.id FROM public.user_profile up
    WHERE up.auth_user_id=(SELECT auth.uid()) AND up.account_status='active'
  )
  AND object_path LIKE owner_user_id::text || '/%'
  AND status='uploading'
  AND capture_id IS NULL
  AND transcript_text IS NULL
);

GRANT SELECT, INSERT ON TABLE public.capture_audio_asset TO authenticated;
REVOKE UPDATE, DELETE ON TABLE public.capture_audio_asset FROM PUBLIC, anon, authenticated;

CREATE POLICY inbox_voice_private_owner_insert
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id='inbox-voice-private'
  AND (storage.foldername(name))[1] = (
    SELECT up.id::text FROM public.user_profile up
    WHERE up.auth_user_id=(SELECT auth.uid()) AND up.account_status='active'
  )
  AND EXISTS (
    SELECT 1 FROM public.capture_audio_asset aa
    WHERE aa.object_path=name AND aa.bucket_id='inbox-voice-private'
      AND aa.status='uploading'
      AND aa.owner_user_id IN (
        SELECT up.id FROM public.user_profile up
        WHERE up.auth_user_id=(SELECT auth.uid()) AND up.account_status='active'
      )
  )
);

CREATE POLICY inbox_voice_private_owner_select
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id='inbox-voice-private'
  AND EXISTS (
    SELECT 1 FROM public.capture_audio_asset aa
    WHERE aa.object_path=name AND aa.bucket_id='inbox-voice-private'
      AND aa.owner_user_id IN (
        SELECT up.id FROM public.user_profile up
        WHERE up.auth_user_id=(SELECT auth.uid()) AND up.account_status='active'
      )
  )
);

CREATE OR REPLACE FUNCTION public.finalize_inbox_audio_upload(
  p_asset_id uuid,
  p_file_size_bytes integer,
  p_sha256_hex text
)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_owner_profile_id uuid;
  v_rows integer;
  v_storage_size bigint;
  v_object_found boolean := false;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'A signed-in user is required' USING ERRCODE='42501';
  END IF;
  SELECT up.id INTO v_owner_profile_id
  FROM public.user_profile up
  WHERE up.auth_user_id=auth.uid() AND up.account_status='active';
  IF v_owner_profile_id IS NULL THEN
    RAISE EXCEPTION 'An active SimpleLife profile is required' USING ERRCODE='42501';
  END IF;
  IF p_asset_id IS NULL
     OR (get_byte(uuid_send(p_asset_id),6) >> 4) <> 7
     OR (get_byte(uuid_send(p_asset_id),8) & 192) <> 128
     OR p_file_size_bytes IS NULL OR p_file_size_bytes NOT BETWEEN 1 AND 26214400
     OR p_sha256_hex IS NULL OR p_sha256_hex !~ '^[0-9a-fA-F]{64}$' THEN
    RAISE EXCEPTION 'Audio upload metadata is invalid' USING ERRCODE='22023';
  END IF;

  SELECT (o.metadata->>'size')::bigint, true
  INTO v_storage_size, v_object_found
  FROM public.capture_audio_asset aa
  JOIN storage.objects o
    ON o.bucket_id='inbox-voice-private' AND o.name=aa.object_path
  WHERE aa.id=p_asset_id
    AND aa.owner_user_id=v_owner_profile_id
    AND aa.status='uploading';
  IF NOT FOUND OR NOT v_object_found THEN
    RAISE EXCEPTION 'Private audio asset is unavailable to this owner'
      USING ERRCODE='42501';
  END IF;
  IF v_storage_size IS DISTINCT FROM p_file_size_bytes THEN
    RAISE EXCEPTION 'Uploaded private audio size does not match its registered metadata'
      USING ERRCODE='22023';
  END IF;

  UPDATE public.capture_audio_asset aa
  SET status='uploaded', file_size_bytes=p_file_size_bytes,
      sha256_hex=lower(p_sha256_hex), uploaded_at=clock_timestamp(),
      updated_at=clock_timestamp()
  WHERE aa.id=p_asset_id
    AND aa.owner_user_id=v_owner_profile_id
    AND aa.capture_id IS NULL
    AND aa.status='uploading';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'Audio asset is not available to finalize' USING ERRCODE='42501';
  END IF;
  RETURN true;
END;
$function$;
ALTER FUNCTION public.finalize_inbox_audio_upload(uuid,integer,text) OWNER TO postgres;
REVOKE ALL PRIVILEGES ON FUNCTION public.finalize_inbox_audio_upload(uuid,integer,text)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.finalize_inbox_audio_upload(uuid,integer,text)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.record_inbox_voice_transcription(
  p_owner_profile_id uuid,
  p_asset_id uuid,
  p_capture_id uuid,
  p_part_id uuid,
  p_transcript_text text,
  p_provider text,
  p_model text,
  p_region text
)
RETURNS TABLE(capture_id uuid, part_id uuid)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_owner_profile_id uuid;
  v_asset public.capture_audio_asset%ROWTYPE;
BEGIN
  -- This SECURITY DEFINER routine is EXECUTE-granted only to service_role.
  -- The backend passes the owner profile resolved from the verified user JWT.
  IF p_owner_profile_id IS NULL THEN
    RAISE EXCEPTION 'A verified owner profile is required' USING ERRCODE='42501';
  END IF;
  SELECT up.id INTO v_owner_profile_id
  FROM public.user_profile up
  WHERE up.id=p_owner_profile_id AND up.account_status='active';
  IF v_owner_profile_id IS NULL THEN
    RAISE EXCEPTION 'An active SimpleLife profile is required' USING ERRCODE='42501';
  END IF;
  IF p_asset_id IS NULL OR p_capture_id IS NULL OR p_part_id IS NULL
     OR (get_byte(uuid_send(p_asset_id),6) >> 4) <> 7
     OR (get_byte(uuid_send(p_asset_id),8) & 192) <> 128
     OR (get_byte(uuid_send(p_capture_id),6) >> 4) <> 7
     OR (get_byte(uuid_send(p_capture_id),8) & 192) <> 128
     OR (get_byte(uuid_send(p_part_id),6) >> 4) <> 7
     OR (get_byte(uuid_send(p_part_id),8) & 192) <> 128
     OR p_transcript_text IS NULL OR length(btrim(p_transcript_text))=0
     OR length(p_transcript_text)>20000
     OR p_provider IS NULL OR p_provider !~ '^[a-z0-9][a-z0-9._-]{0,63}$'
     OR p_model IS NULL OR length(p_model)>128
     OR p_region IS NULL OR length(p_region)>64 THEN
    RAISE EXCEPTION 'Voice transcription result is invalid' USING ERRCODE='22023';
  END IF;

  SELECT aa.* INTO v_asset
  FROM public.capture_audio_asset aa
  WHERE aa.id=p_asset_id
    AND aa.owner_user_id=v_owner_profile_id
    AND aa.capture_id IS NULL
    AND aa.status='uploaded'
    AND aa.retention_until > clock_timestamp()
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Uploaded audio asset is unavailable or expired' USING ERRCODE='42501';
  END IF;

  INSERT INTO public.capture (
    id, owner_user_id, created_by_user_id, input_type, content_original,
    captured_at, sync_status
  ) VALUES (
    p_capture_id, v_owner_profile_id, v_owner_profile_id, 'voice',
    p_transcript_text, v_asset.created_at, 'synced'
  );

  INSERT INTO public.capture_part (
    id, capture_id, part_index, original_fragment
  ) VALUES (
    p_part_id, p_capture_id, 0, p_transcript_text
  );

  UPDATE public.capture_audio_asset aa
  SET capture_id=p_capture_id, transcript_text=p_transcript_text,
      transcription_provider=p_provider, transcription_model=p_model,
      transcription_region=p_region, status='transcribed',
      transcribed_at=clock_timestamp(), retention_until=NULL,
      updated_at=clock_timestamp()
  WHERE aa.id=p_asset_id AND aa.owner_user_id=v_owner_profile_id;

  RETURN QUERY SELECT p_capture_id, p_part_id;
END;
$function$;
ALTER FUNCTION public.record_inbox_voice_transcription(uuid,uuid,uuid,uuid,text,text,text,text)
  OWNER TO postgres;
REVOKE ALL PRIVILEGES ON FUNCTION public.record_inbox_voice_transcription(uuid,uuid,uuid,uuid,text,text,text,text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_inbox_voice_transcription(uuid,uuid,uuid,uuid,text,text,text,text)
  TO service_role;

CREATE OR REPLACE FUNCTION private.sync_capture_audio_retention()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF NEW.deleted_at IS NULL THEN
    UPDATE public.capture_audio_asset
    SET retention_until=NULL, updated_at=clock_timestamp()
    WHERE capture_id=NEW.id;
  ELSE
    UPDATE public.capture_audio_asset
    SET retention_until=NEW.purge_after, updated_at=clock_timestamp()
    WHERE capture_id=NEW.id;
  END IF;
  RETURN NEW;
END;
$function$;
ALTER FUNCTION private.sync_capture_audio_retention() OWNER TO postgres;
REVOKE ALL PRIVILEGES ON FUNCTION private.sync_capture_audio_retention()
  FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER capture_audio_retention_sync
AFTER UPDATE OF deleted_at, purge_after ON public.capture
FOR EACH ROW EXECUTE FUNCTION private.sync_capture_audio_retention();

CREATE OR REPLACE FUNCTION public.list_expired_inbox_audio_assets(p_batch_size integer)
RETURNS TABLE(asset_id uuid, owner_user_id uuid, bucket_id text, object_path text)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF p_batch_size IS NULL OR p_batch_size NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'Audio retention batch must be between 1 and 100' USING ERRCODE='22023';
  END IF;
  RETURN QUERY
  WITH due AS (
    SELECT aa.id
    FROM public.capture_audio_asset aa
    WHERE aa.retention_until IS NOT NULL
      AND aa.retention_until <= clock_timestamp()
      AND aa.status IN ('uploading','uploaded','transcribed','failed','deletion_pending')
    ORDER BY aa.retention_until, aa.id
    LIMIT p_batch_size
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.capture_audio_asset aa
  SET status='deletion_pending', updated_at=clock_timestamp()
  FROM due
  WHERE aa.id=due.id
  RETURNING aa.id, aa.owner_user_id, aa.bucket_id, aa.object_path;
END;
$function$;
ALTER FUNCTION public.list_expired_inbox_audio_assets(integer) OWNER TO postgres;
REVOKE ALL PRIVILEGES ON FUNCTION public.list_expired_inbox_audio_assets(integer)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.list_expired_inbox_audio_assets(integer)
  TO service_role;

CREATE OR REPLACE FUNCTION public.complete_inbox_audio_asset_purge(
  p_asset_ids uuid[],
  p_audit_ids uuid[]
)
RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_asset record;
  v_index integer := 0;
  v_deleted integer := 0;
BEGIN
  IF p_asset_ids IS NULL OR cardinality(p_asset_ids) > 100
     OR p_audit_ids IS NULL OR cardinality(p_asset_ids) <> cardinality(p_audit_ids) THEN
    RAISE EXCEPTION 'Audio purge asset and audit ID batches must match and stay within 100'
      USING ERRCODE='22023';
  END IF;
  IF cardinality(p_asset_ids)=0 THEN RETURN 0; END IF;
  IF (SELECT count(DISTINCT value) FROM unnest(p_asset_ids) value) <> cardinality(p_asset_ids)
     OR (SELECT count(DISTINCT value) FROM unnest(p_audit_ids) value) <> cardinality(p_audit_ids) THEN
    RAISE EXCEPTION 'Audio purge batches must contain unique IDs' USING ERRCODE='22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM unnest(p_audit_ids) AS ids(id)
    WHERE id IS NULL OR (get_byte(uuid_send(id),6) >> 4) <> 7
      OR (get_byte(uuid_send(id),8) & 192) <> 128
  ) THEN
    RAISE EXCEPTION 'Audio purge audit IDs must be UUIDv7' USING ERRCODE='22023';
  END IF;

  FOR v_asset IN
    SELECT aa.*
    FROM public.capture_audio_asset aa
    WHERE aa.id=ANY(p_asset_ids)
      AND aa.status='deletion_pending'
      AND aa.retention_until IS NOT NULL
      AND aa.retention_until <= clock_timestamp()
    ORDER BY aa.id
    FOR UPDATE
  LOOP
    v_index := v_index + 1;
    INSERT INTO public.audit_event (
      id, account_user_id, actor_user_id, action, entity_type, entity_id,
      result, source, details, occurred_at, recorded_at
    ) VALUES (
      p_audit_ids[v_index], v_asset.owner_user_id, NULL,
      'capture.audio_purged', 'capture_audio_asset', v_asset.id,
      'success', 'system',
      jsonb_build_object(
        'retention_days', CASE WHEN v_asset.capture_id IS NULL THEN 7 ELSE 30 END,
        'content_removed', true,
        'object_removed', true
      ),
      clock_timestamp(), clock_timestamp()
    );
    DELETE FROM public.capture_audio_asset WHERE id=v_asset.id;
    v_deleted := v_deleted + 1;
  END LOOP;
  RETURN v_deleted;
END;
$function$;
ALTER FUNCTION public.complete_inbox_audio_asset_purge(uuid[],uuid[]) OWNER TO postgres;
REVOKE ALL PRIVILEGES ON FUNCTION public.complete_inbox_audio_asset_purge(uuid[],uuid[])
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.complete_inbox_audio_asset_purge(uuid[],uuid[])
  TO service_role;

COMMIT;
