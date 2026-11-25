-- The trusted finalizer reads staged metadata; all mutations stay inside SECURITY DEFINER RPCs.
-- Revoke broad baseline grants first so hosted DEV and local Supabase have the same contract.
BEGIN;

REVOKE ALL PRIVILEGES ON TABLE public.capture_audio_asset FROM service_role;
GRANT SELECT ON TABLE public.capture_audio_asset TO service_role;

COMMIT;
