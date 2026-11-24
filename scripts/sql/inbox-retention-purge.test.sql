-- Physical Inbox purge runs only after the 30-day restore window and never deletes active jobs.
BEGIN;
INSERT INTO auth.users (
 id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
 raw_app_meta_data, raw_user_meta_data
) VALUES
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','inbox-purge-owner-a@example.invalid','',now(),
  '{"provider":"email","providers":["email"]}'::jsonb,'{}'::jsonb)
ON CONFLICT(id) DO NOTHING;
INSERT INTO public.user_profile(id,auth_user_id,display_name)
VALUES('019b6200-0000-7000-8000-000000000001',
       'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Inbox purge owner')
ON CONFLICT(id) DO NOTHING;

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
INSERT INTO public.note_idea(id,owner_user_id,created_by_user_id,kind,content)
VALUES('019b6200-0000-7000-8000-000000000101',
       '019b6200-0000-7000-8000-000000000001',
       '019b6200-0000-7000-8000-000000000001','note','Target remains after Inbox purge');
INSERT INTO public.capture(id,owner_user_id,created_by_user_id,content_original)
VALUES
 ('019b6200-0000-7000-8000-000000000201','019b6200-0000-7000-8000-000000000001','019b6200-0000-7000-8000-000000000001','Expired Inbox capture with links'),
 ('019b6200-0000-7000-8000-000000000202','019b6200-0000-7000-8000-000000000001','019b6200-0000-7000-8000-000000000001','Still recoverable Inbox capture'),
 ('019b6200-0000-7000-8000-000000000203','019b6200-0000-7000-8000-000000000001','019b6200-0000-7000-8000-000000000001','Expired but active lease');
INSERT INTO public.capture_part(id,capture_id,part_index,original_fragment,category)
VALUES
 ('019b6200-0000-7000-8000-000000000301','019b6200-0000-7000-8000-000000000201',0,'Expired Inbox capture with links','note_idea'),
 ('019b6200-0000-7000-8000-000000000302','019b6200-0000-7000-8000-000000000202',0,'Still recoverable Inbox capture','note_idea'),
 ('019b6200-0000-7000-8000-000000000303','019b6200-0000-7000-8000-000000000203',0,'Expired but active lease','task');
INSERT INTO public.capture_link(id,capture_part_id,note_idea_id,link_status)
VALUES('019b6200-0000-7000-8000-000000000401',
       '019b6200-0000-7000-8000-000000000301',
       '019b6200-0000-7000-8000-000000000101','confirmed');
RESET ROLE;

RESET ROLE;
UPDATE public.capture SET deleted_at=now()-interval '31 days', purge_after=now()-interval '1 day'
WHERE id IN ('019b6200-0000-7000-8000-000000000201','019b6200-0000-7000-8000-000000000203');
UPDATE public.capture SET deleted_at=now()-interval '2 days', purge_after=now()+interval '28 days'
WHERE id='019b6200-0000-7000-8000-000000000202';

SET LOCAL ROLE service_role;
INSERT INTO public.processing_run(
 id,capture_id,processor_version,status,attempt_number,idempotency_key,started_at,finished_at
) VALUES
 ('019b6200-0000-7000-8000-000000000501','019b6200-0000-7000-8000-000000000201','inbox-proposal-v1','failed',1,'019b6200-0000-7000-8000-000000000601',now(),now()),
 ('019b6200-0000-7000-8000-000000000502','019b6200-0000-7000-8000-000000000203','inbox-proposal-v1','running',1,'019b6200-0000-7000-8000-000000000602',now(),NULL);
UPDATE public.processing_run
SET lease_token='019b6200-0000-4000-8000-000000000701',
    lease_expires_at=now()+interval '90 seconds'
WHERE id='019b6200-0000-7000-8000-000000000502';
RESET ROLE;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
DO $test$
DECLARE v_denied boolean := false;
BEGIN
 BEGIN
  INSERT INTO public.capture_part(id,capture_id,part_index,original_fragment,category)
  VALUES('019b6200-0000-7000-8000-000000000304',
         '019b6200-0000-7000-8000-000000000201',1,'Late new part','task');
 EXCEPTION WHEN insufficient_privilege THEN v_denied := true;
 END;
 IF NOT v_denied THEN RAISE EXCEPTION 'A part was attached to a trashed capture'; END IF;
 IF public.restore_inbox_capture(
   '019b6200-0000-7000-8000-000000000201',
   '019b6200-0000-7000-8000-000000000812'
 ) THEN RAISE EXCEPTION 'An expired capture was restored after its retention deadline'; END IF;
END;
$test$;
RESET ROLE;

SET LOCAL ROLE service_role;
DO $test$
DECLARE v_count integer; v_ids uuid[];
BEGIN
 SELECT purged_count,purged_capture_ids INTO v_count,v_ids
 FROM public.purge_expired_inbox_captures(10,ARRAY[
  '019b6200-0000-7000-8000-000000000801'::uuid,
  '019b6200-0000-7000-8000-000000000802'::uuid,
  '019b6200-0000-7000-8000-000000000803'::uuid,
  '019b6200-0000-7000-8000-000000000804'::uuid,
  '019b6200-0000-7000-8000-000000000805'::uuid,
  '019b6200-0000-7000-8000-000000000806'::uuid,
  '019b6200-0000-7000-8000-000000000807'::uuid,
  '019b6200-0000-7000-8000-000000000808'::uuid,
  '019b6200-0000-7000-8000-000000000809'::uuid,
  '019b6200-0000-7000-8000-000000000810'::uuid
 ]);
 IF v_count <> 1 OR NOT ('019b6200-0000-7000-8000-000000000201'::uuid = ANY(v_ids)) THEN
   RAISE EXCEPTION 'Purger must remove only the eligible expired capture';
 END IF;
 IF EXISTS (SELECT 1 FROM public.capture WHERE id='019b6200-0000-7000-8000-000000000201') THEN
   RAISE EXCEPTION 'Expired capture record was not physically removed';
 END IF;
 IF EXISTS (SELECT 1 FROM public.capture_part WHERE capture_id='019b6200-0000-7000-8000-000000000201')
    OR EXISTS (SELECT 1 FROM public.capture_link WHERE id='019b6200-0000-7000-8000-000000000401')
    OR EXISTS (SELECT 1 FROM public.processing_run WHERE capture_id='019b6200-0000-7000-8000-000000000201') THEN
   RAISE EXCEPTION 'Purger left dependent Inbox data behind';
 END IF;
 IF NOT EXISTS (SELECT 1 FROM public.capture WHERE id='019b6200-0000-7000-8000-000000000202') THEN
   RAISE EXCEPTION 'Purger removed a capture still inside the recovery window';
 END IF;
 IF NOT EXISTS (SELECT 1 FROM public.capture WHERE id='019b6200-0000-7000-8000-000000000203') THEN
   RAISE EXCEPTION 'Purger removed a capture with a live worker lease';
 END IF;
END;
$test$;
RESET ROLE;

-- Inspect the append-only audit receipt as the local database owner.
-- The purge function is SECURITY DEFINER; service_role receives EXECUTE only,
-- never direct privileges on the immutable audit table.
DO $test$
BEGIN
 IF has_table_privilege('service_role','public.audit_event','SELECT')
    OR has_table_privilege('service_role','public.audit_event','INSERT')
    OR has_table_privilege('service_role','public.audit_event','UPDATE')
    OR has_table_privilege('service_role','public.audit_event','DELETE')
    OR has_table_privilege('service_role','public.audit_event','TRUNCATE')
    OR has_table_privilege('service_role','public.audit_event','REFERENCES')
    OR has_table_privilege('service_role','public.audit_event','TRIGGER')
    OR has_table_privilege('service_role','public.audit_event','MAINTAIN') THEN
   RAISE EXCEPTION 'Purge service must not receive direct audit_event privileges';
 END IF;
 IF NOT EXISTS (
   SELECT 1 FROM public.audit_event
   WHERE id='019b6200-0000-7000-8000-000000000801'
     AND action='capture.purged' AND entity_type='capture'
     AND entity_id='019b6200-0000-7000-8000-000000000201'
     AND source='system' AND actor_user_id IS NULL
     AND details->>'content_removed'='true'
 ) THEN
   RAISE EXCEPTION 'Physical purge did not append its privacy-safe audit record';
 END IF;
END;
$test$;

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
DO $test$
DECLARE v_denied boolean := false;
BEGIN
 BEGIN
  PERFORM * FROM public.purge_expired_inbox_captures(1,ARRAY['019b6200-0000-7000-8000-000000000811'::uuid]);
 EXCEPTION WHEN insufficient_privilege THEN v_denied := true;
 END;
 IF NOT v_denied THEN RAISE EXCEPTION 'Authenticated user can execute the physical purge'; END IF;
 IF public.restore_inbox_capture('019b6200-0000-7000-8000-000000000202',
    '019b6200-0000-7000-8000-000000000812') IS NOT TRUE THEN
   RAISE EXCEPTION 'Owner should restore a capture still inside retention';
 END IF;
END;
$test$;
RESET ROLE;
ROLLBACK;
