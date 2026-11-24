-- Run once against Simplelife_dev after applying the scheduler migration.
-- The URL and publishable key are public routing data; the random scheduler token
-- is created separately inside the migration and is never printed here.
DO $seed$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name='inbox_project_url') THEN
    PERFORM vault.create_secret(
      'https://iybnjrnysiikbtokyshg.supabase.co',
      'inbox_project_url',
      'SimpleLife DEV API URL for the Inbox scheduler'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name='inbox_publishable_key') THEN
    PERFORM vault.create_secret(
      'sb_publishable_DpOMj8RbSkN6zgZFaxvmdw_orMCAYHu',
      'inbox_publishable_key',
      'SimpleLife DEV public API key for the Inbox scheduled Edge Function'
    );
  END IF;
END;
$seed$;

DO $verify$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name='inbox_project_url')
     OR NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name='inbox_publishable_key')
     OR NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name='inbox_scheduler_token') THEN
    RAISE EXCEPTION 'Inbox scheduler Vault bootstrap is incomplete';
  END IF;
END;
$verify$;
