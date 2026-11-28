-- Server-verified SHA-256 finalization for private Inbox voice objects.
-- The old authenticated RPC trusted a client-supplied digest and is retired.
BEGIN;

REVOKE ALL PRIVILEGES
ON FUNCTION public.finalize_inbox_audio_upload(uuid,integer,text)
FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.finalize_inbox_audio_upload_verified(
  p_owner_profile_id uuid,
  p_asset_id uuid,
  p_file_size_bytes integer,
  p_sha256_hex text
)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_rows integer;
  v_storage_size bigint;
BEGIN
  IF p_owner_profile_id IS NULL OR p_asset_id IS NULL
     OR (get_byte(uuid_send(p_asset_id),6) >> 4) <> 7
     OR (get_byte(uuid_send(p_asset_id),8) & 192) <> 128
     OR p_file_size_bytes IS NULL
     OR p_file_size_bytes NOT BETWEEN 1 AND 26214400
     OR p_sha256_hex IS NULL
     OR p_sha256_hex !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Verified audio upload metadata is invalid' USING ERRCODE='22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.user_profile up
    WHERE up.id=p_owner_profile_id AND up.account_status='active'
  ) THEN
    RAISE EXCEPTION 'An active owner profile is required' USING ERRCODE='42501';
  END IF;

  SELECT (o.metadata->>'size')::bigint
  INTO v_storage_size
  FROM public.capture_audio_asset aa
  JOIN storage.objects o
    ON o.bucket_id='inbox-voice-private' AND o.name=aa.object_path
  WHERE aa.id=p_asset_id
    AND aa.owner_user_id=p_owner_profile_id
    AND aa.bucket_id='inbox-voice-private'
    AND aa.capture_id IS NULL
    AND aa.status IN ('uploading','uploaded')
    AND aa.retention_until > statement_timestamp()
  FOR UPDATE OF aa;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Private audio asset is unavailable or expired'
      USING ERRCODE='42501';
  END IF;
  IF v_storage_size IS DISTINCT FROM p_file_size_bytes THEN
    RAISE EXCEPTION 'Verified private audio size does not match Storage'
      USING ERRCODE='22023';
  END IF;

  UPDATE public.capture_audio_asset aa
  SET status='uploaded',
      file_size_bytes=p_file_size_bytes,
      sha256_hex=p_sha256_hex,
      uploaded_at=COALESCE(aa.uploaded_at,clock_timestamp()),
      updated_at=clock_timestamp()
  WHERE aa.id=p_asset_id
    AND aa.owner_user_id=p_owner_profile_id
    AND aa.capture_id IS NULL
    AND aa.status IN ('uploading','uploaded')
    AND aa.retention_until > statement_timestamp();
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'Private audio asset is not available to finalize'
      USING ERRCODE='42501';
  END IF;
  RETURN true;
END;
$function$;

ALTER FUNCTION public.finalize_inbox_audio_upload_verified(uuid,uuid,integer,text)
  OWNER TO postgres;
REVOKE ALL PRIVILEGES
ON FUNCTION public.finalize_inbox_audio_upload_verified(uuid,uuid,integer,text)
FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE
ON FUNCTION public.finalize_inbox_audio_upload_verified(uuid,uuid,integer,text)
TO service_role;

COMMIT;
