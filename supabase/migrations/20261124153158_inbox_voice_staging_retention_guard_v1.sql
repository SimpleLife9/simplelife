-- Bound client-created voice staging assets to the intended seven-day retention.
-- Linked voice assets continue to inherit the capture's normal trash window.
BEGIN;

ALTER TABLE public.capture_audio_asset
  ALTER COLUMN retention_until
  SET DEFAULT (statement_timestamp() + interval '7 days');

-- Repair any legacy unlinked staging row whose client-provided retention value
-- was NULL or later than the seven-day maximum.
WITH cutoff AS (
  SELECT clock_timestamp() + interval '7 days' AS max_retention
)
UPDATE public.capture_audio_asset AS aa
SET retention_until = LEAST(COALESCE(aa.retention_until, cutoff.max_retention), cutoff.max_retention),
    updated_at = clock_timestamp()
FROM cutoff
WHERE aa.capture_id IS NULL
  AND aa.status IN ('uploading','uploaded','failed','deletion_pending')
  AND (
    aa.retention_until IS NULL
    OR aa.retention_until > cutoff.max_retention
  );

ALTER POLICY capture_audio_asset_owner_insert
ON public.capture_audio_asset
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
  AND retention_until IS NOT NULL
  AND retention_until <= statement_timestamp() + interval '7 days'
);

COMMIT;
