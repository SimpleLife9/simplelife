-- Inbox trash, restore and review audit integration test. Ephemeral CI Postgres only.
BEGIN;
INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data
) VALUES (
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  '00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','inbox-trash-owner-20261123@example.invalid','',now(),
  '{"provider":"email","providers":["email"]}'::jsonb,'{}'::jsonb
), (
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  '00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','inbox-trash-other-20261123@example.invalid','',now(),
  '{"provider":"email","providers":["email"]}'::jsonb,'{}'::jsonb
) ON CONFLICT(id) DO NOTHING;
INSERT INTO public.user_profile(id,auth_user_id,display_name)
VALUES
 ('019b2000-0000-7000-8000-000000000001','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Inbox trash owner'),
 ('019b2000-0000-7000-8000-000000000002','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','Inbox other owner')
ON CONFLICT(id) DO NOTHING;

DO $test$
BEGIN
  IF has_column_privilege('authenticated','public.capture','attention_status','UPDATE') THEN
    RAISE EXCEPTION 'Authenticated users must not bypass the audited attention-status RPC';
  END IF;
  IF has_column_privilege('authenticated','public.capture_part','category','UPDATE')
     OR has_column_privilege('authenticated','public.capture_part','interpretation','UPDATE')
     OR has_column_privilege('authenticated','public.capture_part','review_status','UPDATE') THEN
    RAISE EXCEPTION 'Authenticated users must not bypass the audited part-review RPC';
  END IF;
  IF NOT has_function_privilege('authenticated',
      'public.set_inbox_capture_attention_status(uuid,text,uuid)','EXECUTE')
     OR NOT has_function_privilege('authenticated',
      'public.review_inbox_capture_part(uuid,text,text,text,uuid)','EXECUTE') THEN
    RAISE EXCEPTION 'Authenticated users are missing owner-checked review RPCs';
  END IF;
END;
$test$;

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
INSERT INTO public.capture(id,owner_user_id,created_by_user_id,content_original)
VALUES('019b2000-0000-7000-8000-000000000101',
       '019b2000-0000-7000-8000-000000000001',
       '019b2000-0000-7000-8000-000000000001','Inbox review audit capture');
INSERT INTO public.capture_part(id,capture_id,part_index,original_fragment,category,interpretation)
VALUES('019b2000-0000-7000-8000-000000000201',
       '019b2000-0000-7000-8000-000000000101',0,'Inbox review audit capture','note_idea','Original interpretation');

RESET ROLE;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
DO $test$
BEGIN
  IF public.trash_inbox_capture(
    '019b2000-0000-7000-8000-000000000101',
    '019b2000-0000-7000-8000-000000000304'
  ) THEN RAISE EXCEPTION 'A second owner trashed a foreign capture'; END IF;
  IF public.review_inbox_capture_part(
    '019b2000-0000-7000-8000-000000000201',
    'task','Unauthorized correction','edited',
    '019b2000-0000-7000-8000-000000000305'
  ) THEN RAISE EXCEPTION 'A second owner reviewed a foreign capture part'; END IF;
  IF public.set_inbox_capture_attention_status(
    '019b2000-0000-7000-8000-000000000101','archived',
    '019b2000-0000-7000-8000-000000000308'
  ) THEN RAISE EXCEPTION 'A second owner changed a foreign capture review state'; END IF;
END;
$test$;
RESET ROLE;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
DO $test$
BEGIN
  IF NOT public.trash_inbox_capture(
    '019b2000-0000-7000-8000-000000000101',
    '019b2000-0000-7000-8000-000000000301'
  ) THEN RAISE EXCEPTION 'Owner could not trash own capture'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.capture
    WHERE id='019b2000-0000-7000-8000-000000000101'
      AND (deleted_at IS NULL OR purge_after <> deleted_at + interval '30 days')
  ) THEN RAISE EXCEPTION 'Trash retention window is invalid'; END IF;
  IF NOT public.trash_inbox_capture(
    '019b2000-0000-7000-8000-000000000101',
    '019b2000-0000-7000-8000-000000000306'
  ) THEN RAISE EXCEPTION 'Repeated trash request should be idempotent'; END IF;
  IF NOT public.restore_inbox_capture(
    '019b2000-0000-7000-8000-000000000101',
    '019b2000-0000-7000-8000-000000000302'
  ) THEN RAISE EXCEPTION 'Owner could not restore a capture within retention'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.capture
    WHERE id='019b2000-0000-7000-8000-000000000101'
      AND (deleted_at IS NOT NULL OR purge_after IS NOT NULL)
  ) THEN RAISE EXCEPTION 'Restore did not clear both soft-delete fields'; END IF;
  IF NOT public.restore_inbox_capture(
    '019b2000-0000-7000-8000-000000000101',
    '019b2000-0000-7000-8000-000000000307'
  ) THEN RAISE EXCEPTION 'Repeated restore request should be idempotent'; END IF;
  IF NOT public.set_inbox_capture_attention_status(
    '019b2000-0000-7000-8000-000000000101','reviewed',
    '019b2000-0000-7000-8000-000000000308'
  ) THEN RAISE EXCEPTION 'Owner could not change own capture attention status'; END IF;
  IF NOT public.set_inbox_capture_attention_status(
    '019b2000-0000-7000-8000-000000000101','reviewed',
    '019b2000-0000-7000-8000-000000000309'
  ) THEN RAISE EXCEPTION 'Repeated same-state attention update should be idempotent'; END IF;
  IF NOT public.review_inbox_capture_part(
    '019b2000-0000-7000-8000-000000000201',
    'task','Manual correction','edited',
    '019b2000-0000-7000-8000-000000000303'
  ) THEN RAISE EXCEPTION 'Owner could not review own capture part'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.capture_part
    WHERE id='019b2000-0000-7000-8000-000000000201'
      AND category='task' AND review_status='edited'
  ) THEN RAISE EXCEPTION 'Part correction was not persisted'; END IF;
  IF (SELECT count(*) FROM public.audit_event
      WHERE entity_id IN (
        '019b2000-0000-7000-8000-000000000101',
        '019b2000-0000-7000-8000-000000000201'
      )) <> 4 THEN
    RAISE EXCEPTION 'Trash, restore, attention status and part-review decisions must all be audited';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.audit_event
    WHERE id='019b2000-0000-7000-8000-000000000308'
      AND entity_id='019b2000-0000-7000-8000-000000000101'
      AND action='capture.attention_status_changed'
      AND details->>'attention_status_before'='needs_review'
      AND details->>'attention_status_after'='reviewed'
  ) THEN
    RAISE EXCEPTION 'Capture attention status transition must be audited';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.audit_event
    WHERE id='019b2000-0000-7000-8000-000000000303'
      AND details->>'category_before'='note_idea'
      AND details->>'category_after'='task'
      AND details->>'interpretation_before'='Original interpretation'
      AND details->>'interpretation_after'='Manual correction'
      AND details->>'review_status_before'='unreviewed'
      AND details->>'review_status_after'='edited'
  ) THEN
    RAISE EXCEPTION 'Review audit must preserve old/new category, interpretation and status';
  END IF;
END;
$test$;
RESET ROLE;
ROLLBACK;
