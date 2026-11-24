-- Idempotent owner-authenticated synchronization for encrypted offline text captures.
-- The client decrypts only in memory and sends a stable UUIDv7 pair through this RPC.
-- RLS remains active: the caller cannot choose or spoof the owner profile.

CREATE OR REPLACE FUNCTION public.sync_inbox_offline_text_capture(
  p_capture_id uuid,
  p_part_id uuid,
  p_content_original text,
  p_captured_at timestamptz DEFAULT NULL
)
RETURNS TABLE(capture_id uuid, part_id uuid, replayed boolean)
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_owner_profile_id uuid;
  v_capture public.capture%ROWTYPE;
  v_part public.capture_part%ROWTYPE;
  v_capture_inserted integer;
  v_part_inserted integer;
  v_replayed boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'A signed-in user is required to sync an offline capture'
      USING ERRCODE = '42501';
  END IF;

  SELECT up.id
  INTO v_owner_profile_id
  FROM public.user_profile up
  WHERE up.auth_user_id = auth.uid()
    AND up.account_status = 'active';

  IF v_owner_profile_id IS NULL THEN
    RAISE EXCEPTION 'An active SimpleLife profile is required'
      USING ERRCODE = '42501';
  END IF;

  IF p_capture_id IS NULL
     OR (get_byte(uuid_send(p_capture_id), 6) >> 4) <> 7
     OR (get_byte(uuid_send(p_capture_id), 8) & 192) <> 128
     OR p_part_id IS NULL
     OR (get_byte(uuid_send(p_part_id), 6) >> 4) <> 7
     OR (get_byte(uuid_send(p_part_id), 8) & 192) <> 128 THEN
    RAISE EXCEPTION 'Offline capture and part IDs must be valid UUIDv7 values'
      USING ERRCODE = '22023';
  END IF;

  IF p_content_original IS NULL
     OR length(btrim(p_content_original)) = 0
     OR length(p_content_original) > 20000 THEN
    RAISE EXCEPTION 'Offline text capture must contain between 1 and 20000 characters'
      USING ERRCODE = '22023';
  END IF;

  -- Stable capture ID makes retries safe after a lost network response.
  INSERT INTO public.capture (
    id, owner_user_id, created_by_user_id, input_type, content_original,
    captured_at, sync_status
  ) VALUES (
    p_capture_id, v_owner_profile_id, v_owner_profile_id, 'text',
    p_content_original, COALESCE(p_captured_at, clock_timestamp()), 'synced'
  )
  ON CONFLICT (id) DO NOTHING;
  GET DIAGNOSTICS v_capture_inserted = ROW_COUNT;
  v_replayed := v_capture_inserted = 0;

  SELECT c.*
  INTO v_capture
  FROM public.capture c
  WHERE c.id = p_capture_id
    AND c.owner_user_id = v_owner_profile_id
    AND c.deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Offline capture ID is unavailable to this owner'
      USING ERRCODE = '42501';
  END IF;

  IF v_capture.input_type <> 'text'
     OR v_capture.content_original <> p_content_original THEN
    RAISE EXCEPTION 'Offline capture ID was already used with different source content'
      USING ERRCODE = '23505';
  END IF;

  -- A capture may have exactly one initial whole-source part. A retry or a
  -- concurrent device reuses the existing part only if the exact source matches.
  INSERT INTO public.capture_part (
    id, capture_id, part_index, original_fragment
  ) VALUES (
    p_part_id, p_capture_id, 0, p_content_original
  )
  ON CONFLICT (capture_id, part_index) DO NOTHING;
  GET DIAGNOSTICS v_part_inserted = ROW_COUNT;

  SELECT cp.*
  INTO v_part
  FROM public.capture_part cp
  WHERE cp.capture_id = p_capture_id
    AND cp.part_index = 0;

  IF NOT FOUND OR v_part.original_fragment <> p_content_original THEN
    RAISE EXCEPTION 'Offline capture source does not match its stored initial part'
      USING ERRCODE = '23505';
  END IF;

  RETURN QUERY SELECT p_capture_id, v_part.id, v_replayed;
END;
$function$;

ALTER FUNCTION public.sync_inbox_offline_text_capture(uuid, uuid, text, timestamptz)
  OWNER TO postgres;
REVOKE ALL PRIVILEGES ON FUNCTION public.sync_inbox_offline_text_capture(uuid, uuid, text, timestamptz)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sync_inbox_offline_text_capture(uuid, uuid, text, timestamptz)
  TO authenticated;
