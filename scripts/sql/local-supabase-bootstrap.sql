-- CI-only reproduction of the platform bootstrap that exists in Simplelife_dev
-- but is intentionally not part of the six recovered application migrations.
-- This must be applied to the ephemeral local Postgres BEFORE migrations run.

CREATE OR REPLACE FUNCTION public.rls_auto_enable()
RETURNS event_trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  cmd record;
  tbl name;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table', 'partitioned table')
  LOOP
    IF cmd.schema_name IS NOT NULL
       AND cmd.schema_name IN ('public')
       AND cmd.schema_name NOT IN ('pg_catalog', 'information_schema')
       AND cmd.schema_name NOT LIKE 'pg_toast%'
       AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        SELECT c.relname INTO tbl
        FROM pg_catalog.pg_class c
        WHERE c.oid = cmd.objid;

        EXECUTE format(
          'ALTER TABLE IF EXISTS %I.%I ENABLE ROW LEVEL SECURITY',
          cmd.schema_name,
          tbl
        );
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
    ELSE
      RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)',
        cmd.object_identity, cmd.schema_name;
    END IF;
  END LOOP;
END;
$function$;

CREATE EVENT TRIGGER ensure_rls
  ON ddl_command_end
  EXECUTE FUNCTION public.rls_auto_enable();

REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM PUBLIC, anon, authenticated;

DO $$
DECLARE
  actual_acl text;
BEGIN
  SELECT p.proacl::text
    INTO actual_acl
  FROM pg_catalog.pg_proc p
  WHERE p.oid = 'public.rls_auto_enable()'::regprocedure;

  IF actual_acl IS NULL OR actual_acl <> '{postgres=X/postgres}' THEN
    RAISE EXCEPTION 'Unexpected local rls_auto_enable ACL: %', actual_acl;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_event_trigger
    WHERE evtname = 'ensure_rls'
      AND evtfoid = 'public.rls_auto_enable()'::regprocedure
      AND evtenabled = 'O'
  ) THEN
    RAISE EXCEPTION 'Expected enabled ensure_rls event trigger was not installed';
  END IF;
END;
$$;
