-- Inbox provenance links to existing Goal, Subgoal and Project rows are owner-scoped.
BEGIN;
INSERT INTO auth.users (
 id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
 raw_app_meta_data, raw_user_meta_data
) VALUES
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','inbox-existing-target-a@example.invalid','',now(),
  '{"provider":"email","providers":["email"]}'::jsonb,'{}'::jsonb),
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','inbox-existing-target-b@example.invalid','',now(),
  '{"provider":"email","providers":["email"]}'::jsonb,'{}'::jsonb)
ON CONFLICT(id) DO NOTHING;
INSERT INTO public.user_profile(id,auth_user_id,display_name)
VALUES
 ('019b6100-0000-7000-8000-000000000001','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Inbox existing target A'),
 ('019b6100-0000-7000-8000-000000000002','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','Inbox existing target B')
ON CONFLICT(id) DO NOTHING;

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
INSERT INTO public.life_area(id,owner_user_id,created_by_user_id,title,position)
VALUES('019b6100-0000-7000-8000-000000000101',
       '019b6100-0000-7000-8000-000000000001',
       '019b6100-0000-7000-8000-000000000001','Finanzas',1);
INSERT INTO public.goal(id,owner_user_id,created_by_user_id,life_area_id,title,status)
VALUES('019b6100-0000-7000-8000-000000000102',
       '019b6100-0000-7000-8000-000000000001',
       '019b6100-0000-7000-8000-000000000001',
       '019b6100-0000-7000-8000-000000000101','Libertad financiera','active');
INSERT INTO public.subgoal(id,goal_id,created_by_user_id,title,status)
VALUES('019b6100-0000-7000-8000-000000000103',
       '019b6100-0000-7000-8000-000000000102',
       '019b6100-0000-7000-8000-000000000001','Incrementar ingresos','active');
INSERT INTO public.project(id,owner_user_id,created_by_user_id,name,status)
VALUES('019b6100-0000-7000-8000-000000000104',
       '019b6100-0000-7000-8000-000000000001',
       '019b6100-0000-7000-8000-000000000001','Automatizar negocio','active');
INSERT INTO public.capture(id,owner_user_id,created_by_user_id,content_original)
VALUES('019b6100-0000-7000-8000-000000000201',
       '019b6100-0000-7000-8000-000000000001',
       '019b6100-0000-7000-8000-000000000001','Link existing objectives');
INSERT INTO public.capture_part(id,capture_id,part_index,original_fragment,category)
VALUES
 ('019b6100-0000-7000-8000-000000000301','019b6100-0000-7000-8000-000000000201',0,'Meta','goal_subgoal'),
 ('019b6100-0000-7000-8000-000000000302','019b6100-0000-7000-8000-000000000201',1,'Submeta','goal_subgoal'),
 ('019b6100-0000-7000-8000-000000000303','019b6100-0000-7000-8000-000000000201',2,'Proyecto','project');
INSERT INTO public.capture_link(id,capture_part_id,goal_id,link_status)
VALUES('019b6100-0000-7000-8000-000000000401','019b6100-0000-7000-8000-000000000301',
       '019b6100-0000-7000-8000-000000000102','confirmed');
INSERT INTO public.capture_link(id,capture_part_id,subgoal_id,link_status)
VALUES('019b6100-0000-7000-8000-000000000402','019b6100-0000-7000-8000-000000000302',
       '019b6100-0000-7000-8000-000000000103','confirmed');
INSERT INTO public.capture_link(id,capture_part_id,project_id,link_status)
VALUES('019b6100-0000-7000-8000-000000000403','019b6100-0000-7000-8000-000000000303',
       '019b6100-0000-7000-8000-000000000104','confirmed');

DO $test$
DECLARE v_count integer;
BEGIN
 SELECT count(*) INTO v_count FROM public.capture_link
 WHERE id IN ('019b6100-0000-7000-8000-000000000401',
              '019b6100-0000-7000-8000-000000000402',
              '019b6100-0000-7000-8000-000000000403');
 IF v_count <> 3 THEN RAISE EXCEPTION 'Owner A could not read all three provenance links'; END IF;
END;
$test$;
RESET ROLE;

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
INSERT INTO public.capture(id,owner_user_id,created_by_user_id,content_original)
VALUES('019b6100-0000-7000-8000-000000000202',
       '019b6100-0000-7000-8000-000000000002',
       '019b6100-0000-7000-8000-000000000002','Foreign target test');
INSERT INTO public.capture_part(id,capture_id,part_index,original_fragment,category)
VALUES('019b6100-0000-7000-8000-000000000304',
       '019b6100-0000-7000-8000-000000000202',0,'Foreign target test','project');
DO $test$
DECLARE v_count integer; v_denied boolean := false;
BEGIN
 SELECT count(*) INTO v_count FROM public.capture_link
 WHERE id IN ('019b6100-0000-7000-8000-000000000401',
              '019b6100-0000-7000-8000-000000000402',
              '019b6100-0000-7000-8000-000000000403');
 IF v_count <> 0 THEN RAISE EXCEPTION 'Owner B can read Owner A destination provenance'; END IF;
 BEGIN
   INSERT INTO public.capture_link(id,capture_part_id,project_id,link_status)
   VALUES('019b6100-0000-7000-8000-000000000404',
          '019b6100-0000-7000-8000-000000000304',
          '019b6100-0000-7000-8000-000000000104','confirmed');
 EXCEPTION WHEN insufficient_privilege THEN
   v_denied := true;
 END;
 IF NOT v_denied THEN RAISE EXCEPTION 'Owner B linked a capture to Owner A project'; END IF;
END;
$test$;
RESET ROLE;
ROLLBACK;
