-- Indexed Inbox search and global duplicate detection remain owner-scoped.
BEGIN;
INSERT INTO auth.users (
 id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
 raw_app_meta_data, raw_user_meta_data
) VALUES
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','inbox-search-owner-a@example.invalid','',now(),
  '{"provider":"email","providers":["email"]}'::jsonb,'{}'::jsonb),
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','inbox-search-owner-b@example.invalid','',now(),
  '{"provider":"email","providers":["email"]}'::jsonb,'{}'::jsonb)
ON CONFLICT(id) DO NOTHING;
INSERT INTO public.user_profile(id,auth_user_id,display_name)
VALUES
 ('019b4000-0000-7000-8000-000000000001','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Inbox Search A'),
 ('019b4000-0000-7000-8000-000000000002','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','Inbox Search B')
ON CONFLICT(id) DO NOTHING;

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
INSERT INTO public.capture(id,owner_user_id,created_by_user_id,content_original,captured_at)
VALUES
 ('019b4000-0000-7000-8000-000000000101','019b4000-0000-7000-8000-000000000001','019b4000-0000-7000-8000-000000000001','Comprar cafe premium para la oficina','2026-11-20T10:00:00Z'),
 ('019b4000-0000-7000-8000-000000000102','019b4000-0000-7000-8000-000000000001','019b4000-0000-7000-8000-000000000001','COMPRAR CAFE PREMIUM PARA LA OFICINA!!!','2026-11-21T10:00:00Z'),
 ('019b4000-0000-7000-8000-000000000103','019b4000-0000-7000-8000-000000000001','019b4000-0000-7000-8000-000000000001','Buscar un hotel en Madrid','2026-11-22T10:00:00Z');
RESET ROLE;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
INSERT INTO public.capture(id,owner_user_id,created_by_user_id,content_original)
VALUES
 ('019b4000-0000-7000-8000-000000000201','019b4000-0000-7000-8000-000000000002','019b4000-0000-7000-8000-000000000002','Comprar cafe premium para la oficina');
RESET ROLE;

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
DO $test$
DECLARE v_count bigint; v_related uuid[]; v_hits bigint;
BEGIN
 SELECT duplicate_count, matching_capture_ids INTO v_count, v_related
 FROM public.find_inbox_duplicate_captures(ARRAY['019b4000-0000-7000-8000-000000000101']::uuid[]);
 IF v_count <> 2 OR NOT ('019b4000-0000-7000-8000-000000000102'::uuid = ANY(v_related)) THEN
   RAISE EXCEPTION 'Owner A global duplicate detection did not return its two matching captures';
 END IF;
 IF '019b4000-0000-7000-8000-000000000201'::uuid = ANY(v_related) THEN
   RAISE EXCEPTION 'Duplicate lookup leaked Owner B capture IDs';
 END IF;
 SELECT count(*) INTO v_hits FROM public.capture
 WHERE search_document @@ websearch_to_tsquery('simple', 'premium oficina');
 IF v_hits <> 2 THEN
   RAISE EXCEPTION 'Owner A full-text search should find exactly two matching captures, found %', v_hits;
 END IF;
 IF NOT EXISTS (
   SELECT 1 FROM public.capture
   WHERE id='019b4000-0000-7000-8000-000000000101'
     AND normalized_content='comprar cafe premium para la oficina'
 ) THEN
   RAISE EXCEPTION 'Generated normalized content is inconsistent';
 END IF;
END;
$test$;
RESET ROLE;

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
DO $test$
DECLARE v_count bigint;
BEGIN
 SELECT count(*) INTO v_count FROM public.find_inbox_duplicate_captures(
   ARRAY['019b4000-0000-7000-8000-000000000101']::uuid[]
 );
 IF v_count <> 0 THEN RAISE EXCEPTION 'Owner B queried Owner A duplicate metadata'; END IF;
 SELECT count(*) INTO v_count FROM public.capture
 WHERE search_document @@ websearch_to_tsquery('simple', 'premium oficina');
 IF v_count <> 1 THEN
   RAISE EXCEPTION 'Owner B should see exactly its own matching capture, found %', v_count;
 END IF;
 IF EXISTS (
   SELECT 1 FROM public.capture
   WHERE id IN (
     '019b4000-0000-7000-8000-000000000101',
     '019b4000-0000-7000-8000-000000000102',
     '019b4000-0000-7000-8000-000000000103'
   )
     AND search_document @@ websearch_to_tsquery('simple', 'premium oficina')
 ) THEN
   RAISE EXCEPTION 'Owner B full-text search can read Owner A captures';
 END IF;
END;
$test$;
RESET ROLE;
ROLLBACK;
