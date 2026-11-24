BEGIN;

DO $test$
BEGIN
  IF has_function_privilege(
    'authenticated',
    'public.finalize_inbox_audio_upload(uuid,integer,text)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'Retired client-trusted audio finalizer is still executable by authenticated';
  END IF;

  IF has_function_privilege(
    'service_role',
    'public.finalize_inbox_audio_upload_verified(uuid,uuid,integer,text)',
    'EXECUTE'
  ) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Server-verified audio finalizer is not executable by service_role';
  END IF;

  IF has_function_privilege(
    'authenticated',
    'public.finalize_inbox_audio_upload_verified(uuid,uuid,integer,text)',
    'EXECUTE'
  ) OR has_function_privilege(
    'anon',
    'public.finalize_inbox_audio_upload_verified(uuid,uuid,integer,text)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'Server-verified audio finalizer is exposed to client roles';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public'
      AND p.proname='finalize_inbox_audio_upload_verified'
      AND p.prosecdef=true
  ) THEN
    RAISE EXCEPTION 'Server-verified audio finalizer must be SECURITY DEFINER';
  END IF;
END;
$test$;

ROLLBACK;
