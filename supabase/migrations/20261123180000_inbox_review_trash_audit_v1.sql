-- Owner-scoped Inbox trash and review audit RPCs.
-- Private capture content stays in place; soft-deleted captures are retained for 30 days.

-- Review-state and classifier corrections must go through the audited RPCs below.
REVOKE UPDATE (attention_status) ON public.capture FROM authenticated;
REVOKE UPDATE (interpretation, category, review_status) ON public.capture_part FROM authenticated;

CREATE OR REPLACE FUNCTION public.trash_inbox_capture(
  p_capture_id uuid,
  p_audit_id uuid
)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_profile_id uuid;
  v_deleted_at timestamptz;
  v_now timestamptz := clock_timestamp();
BEGIN
  SELECT up.id INTO v_profile_id
  FROM public.user_profile up
  WHERE up.auth_user_id = auth.uid() AND up.account_status = 'active';
  IF v_profile_id IS NULL THEN
    RAISE EXCEPTION 'Active owner profile required' USING ERRCODE = '42501';
  END IF;
  IF p_audit_id IS NULL
     OR (get_byte(uuid_send(p_audit_id), 6) >> 4) <> 7
     OR (get_byte(uuid_send(p_audit_id), 8) & 192) <> 128 THEN
    RAISE EXCEPTION 'Audit identifier must be a valid UUIDv7' USING ERRCODE = '22023';
  END IF;
  SELECT c.deleted_at INTO v_deleted_at
  FROM public.capture c
  WHERE c.id = p_capture_id AND c.owner_user_id = v_profile_id
  FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  IF v_deleted_at IS NOT NULL THEN RETURN true; END IF;
  UPDATE public.capture c
  SET deleted_at = v_now, purge_after = v_now + interval '30 days', updated_at = v_now
  WHERE c.id = p_capture_id AND c.owner_user_id = v_profile_id AND c.deleted_at IS NULL;
  IF NOT FOUND THEN RETURN false; END IF;

  INSERT INTO public.audit_event (
    id, account_user_id, actor_user_id, action, entity_type, entity_id,
    result, source, details, occurred_at, recorded_at
  ) VALUES (
    p_audit_id, v_profile_id, v_profile_id, 'capture.trashed', 'capture', p_capture_id,
    'success', 'user', jsonb_build_object('retention_days',30), v_now, v_now
  );
  RETURN true;
END;
$function$;
ALTER FUNCTION public.trash_inbox_capture(uuid, uuid) OWNER TO postgres;
REVOKE ALL PRIVILEGES ON FUNCTION public.trash_inbox_capture(uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.trash_inbox_capture(uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.restore_inbox_capture(
  p_capture_id uuid,
  p_audit_id uuid
)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_profile_id uuid;
  v_deleted_at timestamptz;
  v_purge_after timestamptz;
  v_now timestamptz := clock_timestamp();
BEGIN
  SELECT up.id INTO v_profile_id
  FROM public.user_profile up
  WHERE up.auth_user_id = auth.uid() AND up.account_status = 'active';
  IF v_profile_id IS NULL THEN
    RAISE EXCEPTION 'Active owner profile required' USING ERRCODE = '42501';
  END IF;
  IF p_audit_id IS NULL
     OR (get_byte(uuid_send(p_audit_id), 6) >> 4) <> 7
     OR (get_byte(uuid_send(p_audit_id), 8) & 192) <> 128 THEN
    RAISE EXCEPTION 'Audit identifier must be a valid UUIDv7' USING ERRCODE = '22023';
  END IF;
  SELECT c.deleted_at, c.purge_after INTO v_deleted_at, v_purge_after
  FROM public.capture c
  WHERE c.id = p_capture_id AND c.owner_user_id = v_profile_id
  FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  IF v_deleted_at IS NULL THEN RETURN true; END IF;
  IF v_purge_after <= v_now THEN RETURN false; END IF;
  UPDATE public.capture c
  SET deleted_at = NULL, purge_after = NULL, updated_at = v_now
  WHERE c.id = p_capture_id AND c.owner_user_id = v_profile_id
    AND c.deleted_at IS NOT NULL AND c.purge_after > v_now;
  IF NOT FOUND THEN RETURN false; END IF;

  INSERT INTO public.audit_event (
    id, account_user_id, actor_user_id, action, entity_type, entity_id,
    result, source, details, occurred_at, recorded_at
  ) VALUES (
    p_audit_id, v_profile_id, v_profile_id, 'capture.restored', 'capture', p_capture_id,
    'success', 'user', jsonb_build_object('within_retention',true), v_now, v_now
  );
  RETURN true;
END;
$function$;
ALTER FUNCTION public.restore_inbox_capture(uuid, uuid) OWNER TO postgres;
REVOKE ALL PRIVILEGES ON FUNCTION public.restore_inbox_capture(uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.restore_inbox_capture(uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.set_inbox_capture_attention_status(
  p_capture_id uuid, p_attention_status text, p_audit_id uuid
)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_profile_id uuid;
  v_before_status text;
  v_now timestamptz := clock_timestamp();
BEGIN
  SELECT up.id INTO v_profile_id
  FROM public.user_profile up
  WHERE up.auth_user_id = auth.uid() AND up.account_status = 'active';
  IF v_profile_id IS NULL THEN
    RAISE EXCEPTION 'Active owner profile required' USING ERRCODE = '42501';
  END IF;
  IF p_attention_status IS NULL OR p_attention_status NOT IN ('needs_review','reviewed','archived')
     OR p_audit_id IS NULL
     OR (get_byte(uuid_send(p_audit_id), 6) >> 4) <> 7
     OR (get_byte(uuid_send(p_audit_id), 8) & 192) <> 128 THEN
    RAISE EXCEPTION 'Invalid Inbox attention status or audit identifier' USING ERRCODE = '22023';
  END IF;

  SELECT c.attention_status INTO v_before_status
  FROM public.capture c
  WHERE c.id = p_capture_id
    AND c.owner_user_id = v_profile_id
    AND c.deleted_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  IF v_before_status = p_attention_status THEN RETURN true; END IF;

  UPDATE public.capture
  SET attention_status = p_attention_status, updated_at = v_now
  WHERE id = p_capture_id AND owner_user_id = v_profile_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RETURN false; END IF;

  INSERT INTO public.audit_event (
    id, account_user_id, actor_user_id, action, entity_type, entity_id,
    result, source, details, occurred_at, recorded_at
  ) VALUES (
    p_audit_id, v_profile_id, v_profile_id, 'capture.attention_status_changed',
    'capture', p_capture_id, 'success', 'user',
    jsonb_build_object(
      'attention_status_before',v_before_status,
      'attention_status_after',p_attention_status
    ), v_now, v_now
  );
  RETURN true;
END;
$function$;
ALTER FUNCTION public.set_inbox_capture_attention_status(uuid, text, uuid) OWNER TO postgres;
REVOKE ALL PRIVILEGES ON FUNCTION public.set_inbox_capture_attention_status(uuid, text, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_inbox_capture_attention_status(uuid, text, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.review_inbox_capture_part(
  p_capture_part_id uuid,
  p_category text,
  p_interpretation text,
  p_review_status text,
  p_audit_id uuid
)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_profile_id uuid;
  v_capture_id uuid;
  v_before_category text;
  v_before_status text;
  v_before_interpretation text;
  v_now timestamptz := clock_timestamp();
BEGIN
  SELECT up.id INTO v_profile_id
  FROM public.user_profile up
  WHERE up.auth_user_id = auth.uid() AND up.account_status = 'active';
  IF v_profile_id IS NULL THEN
    RAISE EXCEPTION 'Active owner profile required' USING ERRCODE = '42501';
  END IF;
  IF p_audit_id IS NULL
     OR (get_byte(uuid_send(p_audit_id), 6) >> 4) <> 7
     OR (get_byte(uuid_send(p_audit_id), 8) & 192) <> 128
     OR p_review_status IS NULL OR p_review_status NOT IN ('accepted','edited','rejected')
     OR (p_category IS NOT NULL AND p_category NOT IN (
       'task','event','request','habit','goal_subgoal','project','note_idea','list'
     ))
     OR (p_review_status <> 'rejected' AND p_category IS NULL)
     OR length(COALESCE(p_interpretation,'')) > 1000 THEN
    RAISE EXCEPTION 'Invalid Inbox review payload or audit identifier' USING ERRCODE = '22023';
  END IF;

  -- Lock parent capture before the part. This serializes review with trash and
  -- retention purge, which also acquire the capture row before deleting parts.
  SELECT c.id INTO v_capture_id
  FROM public.capture c
  JOIN public.capture_part cp ON cp.capture_id = c.id
  WHERE cp.id = p_capture_part_id
    AND c.owner_user_id = v_profile_id
    AND c.deleted_at IS NULL
  FOR UPDATE OF c;
  IF NOT FOUND THEN RETURN false; END IF;

  SELECT cp.category, cp.review_status, cp.interpretation
  INTO v_before_category, v_before_status, v_before_interpretation
  FROM public.capture_part cp
  WHERE cp.id = p_capture_part_id AND cp.capture_id = v_capture_id
  FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;

  UPDATE public.capture_part cp
  SET category = COALESCE(p_category, cp.category),
      interpretation = COALESCE(p_interpretation, cp.interpretation),
      review_status = p_review_status,
      updated_at = v_now
  WHERE cp.id = p_capture_part_id;

  INSERT INTO public.audit_event (
    id, account_user_id, actor_user_id, action, entity_type, entity_id,
    result, source, details, occurred_at, recorded_at
  ) VALUES (
    p_audit_id, v_profile_id, v_profile_id, 'capture.part_reviewed', 'capture_part', p_capture_part_id,
    'success', 'user',
    jsonb_build_object(
      'capture_id',v_capture_id,'category_before',v_before_category,'category_after',COALESCE(p_category, v_before_category),
      'interpretation_before',v_before_interpretation,
      'interpretation_after',COALESCE(p_interpretation, v_before_interpretation),
      'review_status_before',v_before_status,'review_status_after',p_review_status
    ), v_now, v_now
  );
  RETURN true;
END;
$function$;
ALTER FUNCTION public.review_inbox_capture_part(uuid, text, text, text, uuid) OWNER TO postgres;
REVOKE ALL PRIVILEGES ON FUNCTION public.review_inbox_capture_part(uuid, text, text, text, uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.review_inbox_capture_part(uuid, text, text, text, uuid) TO authenticated;
