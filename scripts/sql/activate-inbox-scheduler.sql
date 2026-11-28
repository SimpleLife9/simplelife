-- Run only after inbox-processing-scheduled and inbox-processing-dispatcher
-- have been deployed to the intended DEV project.
-- This script is idempotent and never prints the Vault token.

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

DO $cron$
DECLARE
  v_job record;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name='inbox_publishable_key') THEN
    RAISE EXCEPTION 'Store the DEV publishable key in Vault as inbox_publishable_key before scheduler activation';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name='inbox_scheduler_token')
     OR NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name='inbox_project_url') THEN
    RAISE EXCEPTION 'Scheduler Vault credentials are missing';
  END IF;
  FOR v_job IN
    SELECT jobid FROM cron.job WHERE jobname='simplelife-inbox-dispatcher'
  LOOP
    PERFORM cron.unschedule(v_job.jobid);
  END LOOP;

  PERFORM cron.schedule(
    'simplelife-inbox-dispatcher',
    '* * * * *',
    $command$
      SELECT net.http_post(
        url := (
          SELECT decrypted_secret
          FROM vault.decrypted_secrets
          WHERE name='inbox_project_url'
        ) || '/functions/v1/inbox-processing-scheduled',
        headers := jsonb_build_object(
          'Content-Type','application/json',
          'apikey',(
            SELECT decrypted_secret
            FROM vault.decrypted_secrets
            WHERE name='inbox_publishable_key'
          ),
          'x-inbox-scheduler-token',(
            SELECT decrypted_secret
            FROM vault.decrypted_secrets
            WHERE name='inbox_scheduler_token'
          )
        ),
        body := '{}'::jsonb
      ) AS request_id;
    $command$
  );
END;
$cron$;
