-- Inbox Event provenance links must respect capture owner and calendar event owner.
BEGIN;
INSERT INTO auth.users (
 id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
 raw_app_meta_data, raw_user_meta_data
) VALUES
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','inbox-event-owner-a@example.invalid','',now(),
  '{"provider":"email","providers":["email"]}'::jsonb,'{}'::jsonb),
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','inbox-event-owner-b@example.invalid','',now(),
  '{"provider":"email","providers":["email"]}'::jsonb,'{}'::jsonb)
ON CONFLICT(id) DO NOTHING;

INSERT INTO public.user_profile(id,auth_user_id,display_name)
VALUES
 ('019b3000-0000-7000-8000-000000000001','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Inbox Event A'),
 ('019b3000-0000-7000-8000-000000000002','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','Inbox Event B')
ON CONFLICT(id) DO NOTHING;

SET LOCAL ROLE service_role;
INSERT INTO public.calendar_event(
 id,owner_user_id,created_by_user_id,updated_by_user_id,title,event_status,temporal_kind,
 start_date,end_date_exclusive
) VALUES
 ('019b3000-0000-7000-8000-000000000101','019b3000-0000-7000-8000-000000000001','019b3000-0000-7000-8000-000000000001','019b3000-0000-7000-8000-000000000001','Event A','confirmed','all_day','2026-11-27','2026-11-28'),
 ('019b3000-0000-7000-8000-000000000102','019b3000-0000-7000-8000-000000000002','019b3000-0000-7000-8000-000000000002','019b3000-0000-7000-8000-000000000002','Event B','confirmed','all_day','2026-11-27','2026-11-28'),
 ('019b3000-0000-7000-8000-000000000103','019b3000-0000-7000-8000-000000000001','019b3000-0000-7000-8000-000000000001','019b3000-0000-7000-8000-000000000001','Alternative Event A','confirmed','all_day','2026-11-28','2026-11-29');
RESET ROLE;

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
INSERT INTO public.capture(id,owner_user_id,created_by_user_id,content_original)
VALUES('019b3000-0000-7000-8000-000000000201',
       '019b3000-0000-7000-8000-000000000001',
       '019b3000-0000-7000-8000-000000000001','Create the Agenda Event');
INSERT INTO public.capture_part(id,capture_id,part_index,original_fragment,category)
VALUES('019b3000-0000-7000-8000-000000000301',
       '019b3000-0000-7000-8000-000000000201',0,'Create the Agenda Event','event');
INSERT INTO public.capture_link(id,capture_part_id,calendar_event_id,link_status)
VALUES('019b3000-0000-7000-8000-000000000401',
       '019b3000-0000-7000-8000-000000000301',
       '019b3000-0000-7000-8000-000000000101','confirmed');

DO $test$
BEGIN
 IF NOT EXISTS (
   SELECT 1 FROM public.capture_link
   WHERE id='019b3000-0000-7000-8000-000000000401'
     AND calendar_event_id='019b3000-0000-7000-8000-000000000101'
 ) THEN RAISE EXCEPTION 'Owner could not link own Inbox part to own Event'; END IF;

 -- Non-confirmed alternatives may be retained, but one fragment cannot
 -- acquire a second confirmed destination even under a concurrent client.
 INSERT INTO public.capture_link(id,capture_part_id,calendar_event_id,link_status)
 VALUES('019b3000-0000-7000-8000-000000000402',
        '019b3000-0000-7000-8000-000000000301',
        '019b3000-0000-7000-8000-000000000103','suggested');
 IF NOT EXISTS (
   SELECT 1 FROM public.capture_link
   WHERE id='019b3000-0000-7000-8000-000000000402' AND link_status='suggested'
 ) THEN RAISE EXCEPTION 'Suggested alternate link should remain allowed'; END IF;
 BEGIN
   INSERT INTO public.capture_link(id,capture_part_id,calendar_event_id,link_status)
   VALUES('019b3000-0000-7000-8000-000000000403',
          '019b3000-0000-7000-8000-000000000301',
          '019b3000-0000-7000-8000-000000000103','confirmed');
   RAISE EXCEPTION 'A single Inbox fragment acquired two confirmed destinations';
 EXCEPTION WHEN unique_violation THEN
   NULL;
 END;
END;
$test$;

RESET ROLE;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
INSERT INTO public.capture(id,owner_user_id,created_by_user_id,content_original)
VALUES('019b3000-0000-7000-8000-000000000202',
       '019b3000-0000-7000-8000-000000000002',
       '019b3000-0000-7000-8000-000000000002','Foreign event link attempt');
INSERT INTO public.capture_part(id,capture_id,part_index,original_fragment,category)
VALUES('019b3000-0000-7000-8000-000000000302',
       '019b3000-0000-7000-8000-000000000202',0,'Foreign event link attempt','event');

DO $test$
DECLARE v_count integer;
BEGIN
 SELECT count(*) INTO v_count FROM public.capture_link
 WHERE id='019b3000-0000-7000-8000-000000000401';
 IF v_count <> 0 THEN RAISE EXCEPTION 'Owner B can read owner A Event provenance link'; END IF;
 BEGIN
   INSERT INTO public.capture_link(id,capture_part_id,calendar_event_id,link_status)
   VALUES('019b3000-0000-7000-8000-000000000402',
          '019b3000-0000-7000-8000-000000000302',
          '019b3000-0000-7000-8000-000000000101','confirmed');
   RAISE EXCEPTION 'Owner B unexpectedly linked a capture to owner A Event';
 EXCEPTION WHEN insufficient_privilege THEN
   NULL;
 END;
END;
$test$;
RESET ROLE;
ROLLBACK;
