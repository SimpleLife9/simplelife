BEGIN;

DO $test$
BEGIN
  IF has_table_privilege(
    'service_role',
    'public.capture_audio_asset',
    'SELECT'
  ) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Trusted voice finalizer requires service_role SELECT on capture_audio_asset';
  END IF;

  IF has_table_privilege('service_role','public.capture_audio_asset','INSERT')
     OR has_table_privilege('service_role','public.capture_audio_asset','UPDATE')
     OR has_table_privilege('service_role','public.capture_audio_asset','DELETE')
     OR has_table_privilege('service_role','public.capture_audio_asset','TRUNCATE') THEN
    RAISE EXCEPTION 'service_role must remain read-only on capture_audio_asset';
  END IF;

  IF has_table_privilege('anon','public.capture_audio_asset','SELECT')
     OR has_table_privilege('anon','public.capture_audio_asset','INSERT')
     OR has_table_privilege('anon','public.capture_audio_asset','UPDATE')
     OR has_table_privilege('anon','public.capture_audio_asset','DELETE')
     OR has_table_privilege('anon','public.capture_audio_asset','TRUNCATE') THEN
    RAISE EXCEPTION 'Voice asset metadata must remain unavailable to anon';
  END IF;

  IF has_table_privilege('authenticated','public.capture_audio_asset','UPDATE')
     OR has_table_privilege('authenticated','public.capture_audio_asset','DELETE')
     OR has_table_privilege('authenticated','public.capture_audio_asset','TRUNCATE') THEN
    RAISE EXCEPTION 'Authenticated users must not update or delete voice asset metadata directly';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname='capture_audio_asset'
      AND c.relrowsecurity=true
  ) THEN
    RAISE EXCEPTION 'RLS must remain enabled on capture_audio_asset';
  END IF;
END;
$test$;

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
