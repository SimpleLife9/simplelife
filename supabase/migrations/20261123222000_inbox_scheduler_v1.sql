-- Secure scheduler credential for the hosted SimpleLife DEV dispatcher.
-- The high-entropy token is generated inside Postgres and never returned to clients/logs.

DO $vault$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name='inbox_scheduler_token') THEN
    PERFORM vault.create_secret(
      replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
      'inbox_scheduler_token',
      'Private token used only by the SimpleLife Inbox pg_cron dispatcher'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name='inbox_project_url') THEN
    PERFORM vault.create_secret(
      'https://iybnjrnysiikbtokyshg.supabase.co',
      'inbox_project_url',
      'SimpleLife DEV project URL for the Inbox scheduler'
    );
  END IF;
END;
$vault$;

CREATE OR REPLACE FUNCTION public.validate_inbox_scheduler_token(p_token text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_expected text;
BEGIN
  IF p_token IS NULL OR length(p_token) < 32 OR length(p_token) > 256 THEN
    RETURN false;
  END IF;

  SELECT ds.decrypted_secret
  INTO v_expected
  FROM vault.decrypted_secrets ds
  WHERE ds.name='inbox_scheduler_token'
  LIMIT 1;

  IF v_expected IS NULL OR length(v_expected) <> length(p_token) THEN
    RETURN false;
  END IF;
  RETURN p_token = v_expected;
END;
$function$;

ALTER FUNCTION public.validate_inbox_scheduler_token(text) OWNER TO postgres;
REVOKE ALL PRIVILEGES ON FUNCTION public.validate_inbox_scheduler_token(text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.validate_inbox_scheduler_token(text)
  TO service_role;

DO $check$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name='inbox_scheduler_token')
     OR NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name='inbox_project_url') THEN
    RAISE EXCEPTION 'Inbox scheduler Vault secrets were not created';
  END IF;
  IF has_function_privilege('authenticated','public.validate_inbox_scheduler_token(text)','EXECUTE')
     OR has_function_privilege('anon','public.validate_inbox_scheduler_token(text)','EXECUTE')
     OR NOT has_function_privilege('service_role','public.validate_inbox_scheduler_token(text)','EXECUTE') THEN
    RAISE EXCEPTION 'Inbox scheduler token validation grants are incorrect';
  END IF;
END;
$check$;
