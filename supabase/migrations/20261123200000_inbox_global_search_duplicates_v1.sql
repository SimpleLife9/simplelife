-- Global, indexed Inbox search and owner-scoped duplicate discovery.
-- No capture is merged or deleted by this migration.

ALTER TABLE public.capture
  ADD COLUMN search_document tsvector
    GENERATED ALWAYS AS (to_tsvector('simple'::regconfig, content_original)) STORED,
  ADD COLUMN normalized_content text
    GENERATED ALWAYS AS (
      btrim(regexp_replace(lower(content_original), '[^[:alnum:]]+', ' ', 'g'))
    ) STORED;

CREATE INDEX capture_search_document_gin_idx
  ON public.capture USING gin(search_document);
CREATE INDEX capture_owner_captured_at_idx
  ON public.capture(owner_user_id, captured_at DESC, id DESC);
CREATE INDEX capture_owner_normalized_content_idx
  ON public.capture(owner_user_id, normalized_content)
  WHERE deleted_at IS NULL;

CREATE OR REPLACE FUNCTION public.find_inbox_duplicate_captures(
  p_capture_ids uuid[]
)
RETURNS TABLE (
  capture_id uuid,
  duplicate_count bigint,
  matching_capture_ids uuid[]
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_profile_id uuid;
BEGIN
  SELECT up.id INTO v_profile_id
  FROM public.user_profile up
  WHERE up.auth_user_id = auth.uid() AND up.account_status = 'active';
  IF v_profile_id IS NULL THEN
    RAISE EXCEPTION 'Active owner profile required' USING ERRCODE = '42501';
  END IF;
  IF p_capture_ids IS NULL OR cardinality(p_capture_ids) = 0
     OR cardinality(p_capture_ids) > 200 THEN
    RAISE EXCEPTION 'Between one and 200 capture IDs are required' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  SELECT source.id,
         count(other.id)::bigint,
         array_agg(other.id ORDER BY other.captured_at DESC, other.id DESC)
  FROM public.capture source
  JOIN public.capture other
    ON other.owner_user_id = v_profile_id
   AND other.deleted_at IS NULL
   AND other.normalized_content = source.normalized_content
  WHERE source.owner_user_id = v_profile_id
    AND source.deleted_at IS NULL
    AND length(source.normalized_content) > 3
    AND source.id = ANY(p_capture_ids)
  GROUP BY source.id
  HAVING count(other.id) > 1;
END;
$function$;

ALTER FUNCTION public.find_inbox_duplicate_captures(uuid[]) OWNER TO postgres;
REVOKE ALL PRIVILEGES ON FUNCTION public.find_inbox_duplicate_captures(uuid[])
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.find_inbox_duplicate_captures(uuid[])
  TO authenticated;
