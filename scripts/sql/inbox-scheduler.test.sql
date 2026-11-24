-- Verify Vault-backed scheduler credentials and least-privilege token validation.
BEGIN;

DO $test$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name='inbox_scheduler_token')
     OR NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name='inbox_project_url') THEN
    RAISE EXCEPTION 'Inbox scheduler secrets are missing from Vault';
  END IF;

  IF NOT has_function_privilege('service_role',
       'public.validate_inbox_scheduler_token(text)','EXECUTE')
     OR has_function_privilege('authenticated',
       'public.validate_inbox_scheduler_token(text)','EXECUTE')
     OR has_function_privilege('anon',
       'public.validate_inbox_scheduler_token(text)','EXECUTE') THEN
    RAISE EXCEPTION 'Scheduler validation RPC is not service_role-only';
  END IF;

  IF public.validate_inbox_scheduler_token(NULL) IS DISTINCT FROM false
     OR public.validate_inbox_scheduler_token('short') IS DISTINCT FROM false
     OR public.validate_inbox_scheduler_token(repeat('x',64)) IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'Invalid scheduler tokens were accepted';
  END IF;
END;
$test$;

ROLLBACK;
