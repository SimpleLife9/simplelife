-- Permit only the trusted backend role to read staged voice asset metadata.
-- Mutations remain behind SECURITY DEFINER RPCs; client-role grants and RLS are unchanged.
BEGIN;

GRANT SELECT ON TABLE public.capture_audio_asset TO service_role;

COMMIT;
