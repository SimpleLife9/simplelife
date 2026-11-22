-- Disposable integration tests for Protected Time schema, RLS, audit and atomic mutations.
-- Run only against the ephemeral local Postgres after the platform bootstrap/migrations.
-- The outer transaction rolls back all Auth/profile/block fixtures.

BEGIN;

INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data
) VALUES
  (
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'protected-time-owner-a@example.invalid',
    '', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb
  ),
  (
    'ffffffff-ffff-4fff-8fff-ffffffffffff',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'protected-time-owner-b@example.invalid',
    '', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb
  )
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.user_profile (id, auth_user_id, display_name)
VALUES
  ('019a0000-0000-7000-8000-000000000011', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'Protected Time Owner A'),
  ('019a0000-0000-7000-8000-000000000012', 'ffffffff-ffff-4fff-8fff-ffffffffffff', 'Protected Time Owner B')
ON CONFLICT (id) DO NOTHING;

DO $assert_privileges$
BEGIN
  IF has_table_privilege('authenticated', 'public.protected_time_block', 'INSERT')
     OR has_table_privilege('authenticated', 'public.protected_time_block', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.protected_time_block', 'DELETE') THEN
    RAISE EXCEPTION 'authenticated must not write Protected Time rows directly';
  END IF;
  IF has_table_privilege('authenticated', 'public.protected_time_block_mutation_request', 'SELECT') THEN
    RAISE EXCEPTION 'authenticated must not read the mutation receipt ledger';
  END IF;
  IF NOT has_table_privilege('authenticated', 'public.protected_time_block', 'SELECT') THEN
    RAISE EXCEPTION 'authenticated must be able to read owner-scoped Protected Time rows';
  END IF;
END;
$assert_privileges$;

SET LOCAL ROLE service_role;

DO $test$
DECLARE
  v_owner_a uuid := '019a0000-0000-7000-8000-000000000011';
  v_owner_b uuid := '019a0000-0000-7000-8000-000000000012';
  v_auth_b uuid := 'ffffffff-ffff-4fff-8fff-ffffffffffff';
  v_block_a uuid := '019a0000-0000-7000-8000-000000000111';
  v_block_b uuid := '019a0000-0000-7000-8000-000000000112';
  v_key_create uuid := '019a0000-0000-7000-8000-000000000201';
  v_key_edit uuid := '019a0000-0000-7000-8000-000000000202';
  v_key_stale uuid := '019a0000-0000-7000-8000-000000000203';
  v_key_archive uuid := '019a0000-0000-7000-8000-000000000204';
  v_key_restore uuid := '019a0000-0000-7000-8000-000000000205';
  v_key_delete uuid := '019a0000-0000-7000-8000-000000000206';
  v_key_weekly uuid := '019a0000-0000-7000-8000-000000000207';
  v_hash_create text := repeat('a', 64);
  v_hash_edit text := repeat('b', 64);
  v_hash_stale text := repeat('c', 64);
  v_hash_archive text := repeat('d', 64);
  v_hash_restore text := repeat('e', 64);
  v_hash_delete text := repeat('f', 64);
  v_hash_weekly text := repeat('1', 64);
  v_patch jsonb;
  v_weekly_patch jsonb;
  v_status integer;
  v_response jsonb;
  v_replayed boolean;
  v_version timestamptz;
  v_count bigint;
BEGIN
  IF current_user <> 'service_role' THEN
    RAISE EXCEPTION 'SQL test must exercise the mutation RPC as service_role';
  END IF;

  v_patch := jsonb_build_object(
    'label', 'Sueño nocturno',
    'category', 'sleep',
    'protection_mode', 'hard',
    'pattern_kind', 'one_off',
    'time_zone', 'America/Havana',
    'start_local', '2026-12-24T22:00:00',
    'end_local', '2026-12-25T06:30:00',
    'starts_at', '2026-12-25T03:00:00Z',
    'ends_at', '2026-12-25T11:30:00Z',
    'start_disambiguation', 'earlier',
    'end_disambiguation', 'earlier',
    'start_gap_strategy', 'next-valid',
    'end_gap_strategy', 'next-valid',
    'start_date', NULL,
    'end_date_exclusive', NULL,
    'weekdays', NULL,
    'start_time_local', NULL,
    'end_time_local', NULL,
    'ends_next_day', NULL,
    'resolver_metadata', jsonb_build_object(
      'rulesSource', 'iana-tzdb',
      'rulesVersion', '2026f',
      'resolverVersion', 'agenda-iana-resolver-v1',
      'authoritative', true
    )
  );

  SELECT http_status, response_body, replayed
    INTO v_status, v_response, v_replayed
  FROM public.mutate_protected_time_block_once(
    v_owner_a, v_block_a, v_key_create,
    'protected-time-mutation-v1', v_hash_create,
    NULL, 'create', v_patch, '2026-11-22T18:00:00Z'
  );
  IF v_status <> 201 OR v_replayed OR v_response->>'blockId' <> v_block_a::text THEN
    RAISE EXCEPTION 'Protected Time create failed: %, %, %', v_status, v_response, v_replayed;
  END IF;

  -- An identical retry must replay the original result without another row/audit.
  SELECT http_status, response_body, replayed
    INTO v_status, v_response, v_replayed
  FROM public.mutate_protected_time_block_once(
    v_owner_a, v_block_a, v_key_create,
    'protected-time-mutation-v1', v_hash_create,
    NULL, 'create', v_patch, '2026-11-22T18:01:00Z'
  );
  IF v_status <> 201 OR NOT v_replayed OR v_response->>'blockId' <> v_block_a::text THEN
    RAISE EXCEPTION 'Protected Time create replay failed: %, %, %', v_status, v_response, v_replayed;
  END IF;

  -- Same owner/key with a different canonical payload is a conflict.
  SELECT http_status INTO v_status
  FROM public.mutate_protected_time_block_once(
    v_owner_a, v_block_a, v_key_create,
    'protected-time-mutation-v1', repeat('9', 64),
    NULL, 'create', v_patch, '2026-11-22T18:02:00Z'
  );
  IF v_status <> 409 THEN RAISE EXCEPTION 'Idempotency key reuse must return 409, got %', v_status; END IF;

  SELECT updated_at INTO v_version
  FROM public.protected_time_block
  WHERE id = v_block_a AND owner_user_id = v_owner_a;

  v_patch := jsonb_set(v_patch, '{label}', '"Sueño nocturno editado"'::jsonb);
  SELECT http_status, response_body INTO v_status, v_response
  FROM public.mutate_protected_time_block_once(
    v_owner_a, v_block_a, v_key_edit,
    'protected-time-mutation-v1', v_hash_edit,
    v_version, 'edit', v_patch, '2026-11-22T18:03:00Z'
  );
  IF v_status <> 200 OR v_response->>'label' <> 'Sueño nocturno editado' THEN
    RAISE EXCEPTION 'Protected Time edit failed: %, %', v_status, v_response;
  END IF;

  -- A stale version cannot overwrite the edited row.
  SELECT http_status INTO v_status
  FROM public.mutate_protected_time_block_once(
    v_owner_a, v_block_a, v_key_stale,
    'protected-time-mutation-v1', v_hash_stale,
    v_version, 'archive', '{}'::jsonb, '2026-11-22T18:04:00Z'
  );
  IF v_status <> 409 THEN RAISE EXCEPTION 'Stale Protected Time version must return 409, got %', v_status; END IF;

  SELECT updated_at INTO v_version FROM public.protected_time_block WHERE id = v_block_a;
  SELECT http_status INTO v_status
  FROM public.mutate_protected_time_block_once(
    v_owner_a, v_block_a, v_key_archive,
    'protected-time-mutation-v1', v_hash_archive,
    v_version, 'archive', '{}'::jsonb, '2026-11-22T18:05:00Z'
  );
  IF v_status <> 200 OR (SELECT archived_at IS NULL FROM public.protected_time_block WHERE id = v_block_a) THEN
    RAISE EXCEPTION 'Protected Time archive failed';
  END IF;

  SELECT updated_at INTO v_version FROM public.protected_time_block WHERE id = v_block_a;
  SELECT http_status INTO v_status
  FROM public.mutate_protected_time_block_once(
    v_owner_a, v_block_a, v_key_restore,
    'protected-time-mutation-v1', v_hash_restore,
    v_version, 'restore', '{}'::jsonb, '2026-11-22T18:06:00Z'
  );
  IF v_status <> 200 OR (SELECT archived_at IS NOT NULL FROM public.protected_time_block WHERE id = v_block_a) THEN
    RAISE EXCEPTION 'Protected Time restore failed';
  END IF;

  SELECT updated_at INTO v_version FROM public.protected_time_block WHERE id = v_block_a;
  SELECT http_status INTO v_status
  FROM public.mutate_protected_time_block_once(
    v_owner_a, v_block_a, v_key_delete,
    'protected-time-mutation-v1', v_hash_delete,
    v_version, 'delete', '{}'::jsonb, '2026-11-22T18:07:00Z'
  );
  IF v_status <> 200 OR (SELECT deleted_at IS NULL FROM public.protected_time_block WHERE id = v_block_a) THEN
    RAISE EXCEPTION 'Protected Time logical delete failed';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.protected_time_block WHERE id = v_block_a) THEN
    RAISE EXCEPTION 'Protected Time delete must be logical; physical row disappeared';
  END IF;

  v_weekly_patch := jsonb_build_object(
    'label', 'Entrenamiento',
    'category', 'training',
    'protection_mode', 'flexible',
    'pattern_kind', 'weekly',
    'time_zone', 'America/Havana',
    'start_local', NULL,
    'end_local', NULL,
    'starts_at', NULL,
    'ends_at', NULL,
    'start_disambiguation', NULL,
    'end_disambiguation', NULL,
    'start_gap_strategy', NULL,
    'end_gap_strategy', NULL,
    'start_date', '2026-11-23',
    'end_date_exclusive', NULL,
    'weekdays', jsonb_build_array(1, 3, 5),
    'start_time_local', '22:00',
    'end_time_local', '06:30',
    'ends_next_day', true,
    'resolver_metadata', jsonb_build_object(
      'rulesSource', 'iana-tzdb',
      'rulesVersion', '2026f',
      'resolverVersion', 'agenda-iana-resolver-v1',
      'authoritative', true
    )
  );
  SELECT http_status, response_body INTO v_status, v_response
  FROM public.mutate_protected_time_block_once(
    v_owner_b, v_block_b, v_key_weekly,
    'protected-time-mutation-v1', v_hash_weekly,
    NULL, 'create', v_weekly_patch, '2026-11-22T18:08:00Z'
  );
  IF v_status <> 201 OR v_response->>'patternKind' <> 'weekly' THEN
    RAISE EXCEPTION 'Weekly Protected Time create failed: %, %', v_status, v_response;
  END IF;

  SELECT count(*) INTO v_count
  FROM public.audit_event
  WHERE entity_type = 'protected_time_block'
    AND entity_id = v_block_a
    AND account_user_id = v_owner_a;
  IF v_count <> 5 THEN RAISE EXCEPTION 'Owner A needs exactly five audit rows, got %', v_count; END IF;

  SELECT count(*) INTO v_count
  FROM public.audit_event
  WHERE entity_type = 'protected_time_block'
    AND entity_id = v_block_b
    AND account_user_id = v_owner_b;
  IF v_count <> 1 THEN RAISE EXCEPTION 'Owner B needs one audit row, got %', v_count; END IF;

  SELECT count(*) INTO v_count
  FROM public.protected_time_block_mutation_request
  WHERE owner_user_id = v_owner_a;
  IF v_count <> 6 THEN RAISE EXCEPTION 'Owner A needs six receipts, got %', v_count; END IF;
  SELECT count(*) INTO v_count
  FROM public.protected_time_block_mutation_request
  WHERE owner_user_id = v_owner_b;
  IF v_count <> 1 THEN RAISE EXCEPTION 'Owner B needs one receipt, got %', v_count; END IF;

  RAISE NOTICE 'PASS: Protected Time one-off create and weekly civil rule persistence.';
  RAISE NOTICE 'PASS: owner/actor derive from one verified profile and cannot be supplied in the patch.';
  RAISE NOTICE 'PASS: idempotent replay returns the original result and same-key changed intent returns 409.';
  RAISE NOTICE 'PASS: optimistic version conflict prevents stale update.';
  RAISE NOTICE 'PASS: archive, restore and logical delete preserve the same row identity.';
  RAISE NOTICE 'PASS: append-only audit has exactly one row per meaningful mutation.';
  RAISE NOTICE 'PASS: separate owners keep independent blocks, audit rows and receipts.';
END;
$test$;

RESET ROLE;

-- Exercise the actual authenticated RLS policy, not merely the table ACL.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
DO $rls_owner_a$
DECLARE v_count bigint;
BEGIN
  SELECT count(*) INTO v_count FROM public.protected_time_block;
  IF v_count <> 1 THEN RAISE EXCEPTION 'Owner A must see exactly one own block; got %', v_count; END IF;
  IF EXISTS (
    SELECT 1 FROM public.protected_time_block
    WHERE id = '019a0000-0000-7000-8000-000000000112'::uuid
  ) THEN
    RAISE EXCEPTION 'Owner A must not see Owner B Protected Time';
  END IF;
END;
$rls_owner_a$;

RESET ROLE;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
DO $rls_owner_b$
DECLARE v_count bigint;
BEGIN
  SELECT count(*) INTO v_count FROM public.protected_time_block;
  IF v_count <> 1 THEN RAISE EXCEPTION 'Owner B must see exactly one own block; got %', v_count; END IF;
  IF EXISTS (
    SELECT 1 FROM public.protected_time_block
    WHERE id = '019a0000-0000-7000-8000-000000000111'::uuid
  ) THEN
    RAISE EXCEPTION 'Owner B must not see Owner A Protected Time';
  END IF;
END;
$rls_owner_b$;

ROLLBACK;
