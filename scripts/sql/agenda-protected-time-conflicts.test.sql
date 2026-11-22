-- Disposable PostgreSQL integration tests for Protected Time conflict consent.
-- The wrapper functions and owner lock are tested only against local CI Postgres.
BEGIN;

INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data
) VALUES (
  'cccccccc-1111-4111-8111-111111111111',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'protected-time-consent-owner@example.invalid',
  '', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.user_profile (id, auth_user_id, display_name)
VALUES (
  '019a0000-0000-7000-8000-000000000061',
  'cccccccc-1111-4111-8111-111111111111',
  'Protected Time Consent Owner'
)
ON CONFLICT (id) DO NOTHING;

CREATE FUNCTION public.agenda_protected_time_consent_event_record(
  p_id uuid,
  p_owner uuid,
  p_title text
)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
AS $function$
  SELECT jsonb_build_object(
    'id', p_id,
    'owner_user_id', p_owner,
    'created_by_user_id', p_owner,
    'updated_by_user_id', p_owner,
    'title', p_title,
    'description', NULL,
    'location_label', NULL,
    'location_kind', NULL,
    'event_status', 'confirmed',
    'temporal_kind', 'all_day',
    'start_date', DATE '2026-11-23',
    'end_date_exclusive', DATE '2026-11-24',
    'start_local', NULL,
    'end_local', NULL,
    'time_zone', NULL,
    'starts_at', NULL,
    'ends_at', NULL,
    'start_disambiguation', NULL,
    'end_disambiguation', NULL,
    'start_gap_strategy', NULL,
    'end_gap_strategy', NULL,
    'archived_at', NULL,
    'deleted_at', NULL,
    'purge_after', NULL,
    'created_at', TIMESTAMPTZ '2026-11-22 18:00:00+00',
    'updated_at', TIMESTAMPTZ '2026-11-22 18:00:00+00'
  );
$function$;

ALTER FUNCTION public.agenda_protected_time_consent_event_record(uuid, uuid, text)
  OWNER TO postgres;
REVOKE ALL PRIVILEGES ON FUNCTION public.agenda_protected_time_consent_event_record(uuid, uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.agenda_protected_time_consent_event_record(uuid, uuid, text)
  TO service_role;

DO $privileges$
BEGIN
  IF NOT has_function_privilege(
       'service_role',
       'public.create_calendar_event_with_protected_time_once(uuid,uuid,text,text,jsonb,jsonb,jsonb)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'anon',
       'public.create_calendar_event_with_protected_time_once(uuid,uuid,text,text,jsonb,jsonb,jsonb)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'authenticated',
       'public.create_calendar_event_with_protected_time_once(uuid,uuid,text,text,jsonb,jsonb,jsonb)',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'Protected Time guarded Event RPC grants are incorrect';
  END IF;

  IF NOT has_function_privilege(
       'service_role',
       'private.protected_time_snapshot_matches(uuid,jsonb)',
       'EXECUTE'
     )
     OR NOT has_function_privilege(
       'service_role',
       'private.protected_time_decisions_are_current(uuid,jsonb)',
       'EXECUTE'
     )
     OR NOT has_function_privilege(
       'service_role',
       'private.append_calendar_event_protected_time_decisions(uuid,uuid,uuid,text,jsonb)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'authenticated',
       'private.append_calendar_event_protected_time_decisions(uuid,uuid,uuid,text,jsonb)',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'Private conflict helper execute grants are incorrect';
  END IF;

  IF has_table_privilege('service_role', 'public.audit_event', 'SELECT')
     OR has_table_privilege('service_role', 'public.audit_event', 'INSERT')
     OR has_table_privilege('service_role', 'public.audit_event', 'UPDATE') THEN
    RAISE EXCEPTION 'service_role must not gain direct audit_event privileges';
  END IF;
END;
$privileges$;

SET LOCAL ROLE service_role;

DO $test$
DECLARE
  v_owner uuid := '019a0000-0000-7000-8000-000000000061';
  v_block uuid := '019a0000-0000-7000-8000-0000000000611';
  v_event uuid := '019a0000-0000-7000-8000-0000000000612';
  v_key uuid := '019a0000-0000-7000-8000-0000000000613';
  v_hash text := repeat('a', 64);
  v_snapshot jsonb;
  v_decisions jsonb;
  v_event_record jsonb;
  v_block_version timestamptz;
  v_status integer;
  v_response jsonb;
  v_replayed boolean;
  v_audit_count bigint;
  v_event_count bigint;
BEGIN
  IF current_user <> 'service_role' THEN
    RAISE EXCEPTION 'SQL test must call guarded Event RPC as service_role';
  END IF;

  INSERT INTO public.protected_time_block (
    id, owner_user_id, created_by_user_id, updated_by_user_id,
    label, category, protection_mode, pattern_kind, time_zone,
    start_local, end_local, starts_at, ends_at,
    start_disambiguation, end_disambiguation,
    start_gap_strategy, end_gap_strategy,
    start_date, end_date_exclusive, weekdays,
    start_time_local, end_time_local, ends_next_day,
    resolver_metadata, archived_at, deleted_at, created_at, updated_at
  ) VALUES (
    v_block, v_owner, v_owner, v_owner,
    'Bloque protegido para consentimiento', 'personal', 'hard', 'one_off', 'America/Havana',
    TIMESTAMP '2026-11-23 10:00:00', TIMESTAMP '2026-11-23 11:00:00',
    TIMESTAMPTZ '2026-11-23 15:00:00+00', TIMESTAMPTZ '2026-11-23 16:00:00+00',
    'earlier', 'earlier', 'next-valid', 'next-valid',
    NULL, NULL, NULL, NULL, NULL, NULL,
    '{"rulesSource":"iana-tzdb","rulesVersion":"2026f","resolverVersion":"agenda-iana-resolver-v1","authoritative":true}'::jsonb,
    NULL, NULL, now(), now()
  );

  SELECT updated_at INTO v_block_version
  FROM public.protected_time_block
  WHERE id = v_block AND owner_user_id = v_owner;

  SELECT coalesce(jsonb_agg(jsonb_build_object('id', id, 'updatedAt', updated_at) ORDER BY id), '[]'::jsonb)
    INTO v_snapshot
  FROM public.protected_time_block
  WHERE owner_user_id = v_owner AND archived_at IS NULL AND deleted_at IS NULL;

  v_decisions := jsonb_build_array(jsonb_build_object(
    'blockId', v_block,
    'blockUpdatedAt', v_block_version,
    'protectionMode', 'hard',
    'decision', 'override'
  ));
  v_event_record := public.agenda_protected_time_consent_event_record(
    v_event, v_owner, 'Event con override explícito'
  );

  SELECT result.http_status, result.response_body, result.replayed
    INTO v_status, v_response, v_replayed
  FROM public.create_calendar_event_with_protected_time_once(
    v_owner, v_key, 'event-create-v1', v_hash,
    v_event_record, v_snapshot, v_decisions
  ) AS result;

  IF v_status <> 201 OR v_replayed IS NOT FALSE
     OR v_response ->> 'eventId' IS DISTINCT FROM v_event::text THEN
    RAISE EXCEPTION 'Guarded Event create failed: status %, replay %, body %',
      v_status, v_replayed, v_response;
  END IF;

  -- A changed Protected Time row must not invalidate an exact Event retry:
  -- receipt replay is resolved before snapshot comparison and never duplicates audit.
  UPDATE public.protected_time_block
  SET label = 'Bloque actualizado después del Event'
  WHERE id = v_block AND owner_user_id = v_owner;

  SELECT result.http_status, result.response_body, result.replayed
    INTO v_status, v_response, v_replayed
  FROM public.create_calendar_event_with_protected_time_once(
    v_owner, v_key, 'event-create-v1', v_hash,
    v_event_record, v_snapshot, v_decisions
  ) AS result;

  IF v_status <> 201 OR v_replayed IS NOT TRUE THEN
    RAISE EXCEPTION 'Exact guarded Event retry did not replay: status %, replay %',
      v_status, v_replayed;
  END IF;

  SELECT count(*) INTO v_audit_count
  FROM public.audit_event
  WHERE account_user_id = v_owner
    AND entity_type = 'calendar_event'
    AND entity_id = v_event
    AND action = 'calendar_event.protected_time_hard_override';
  IF v_audit_count <> 1 THEN
    RAISE EXCEPTION 'Protected Time consent audit must be written exactly once, got %', v_audit_count;
  END IF;

  -- A new operation using the stale snapshot is rejected without creating an Event.
  SELECT result.http_status, result.response_body, result.replayed
    INTO v_status, v_response, v_replayed
  FROM public.create_calendar_event_with_protected_time_once(
    v_owner,
    '019a0000-0000-7000-8000-0000000000614',
    'event-create-v1',
    repeat('b', 64),
    public.agenda_protected_time_consent_event_record(
      '019a0000-0000-7000-8000-0000000000615', v_owner, 'Debe rechazarse por snapshot obsoleto'
    ),
    v_snapshot,
    '[]'::jsonb
  ) AS result;

  IF v_status <> 409 OR v_response ->> 'error' <> 'PROTECTED_TIME_STATE_CHANGED' THEN
    RAISE EXCEPTION 'Stale Protected Time snapshot was not rejected: % %', v_status, v_response;
  END IF;

  SELECT count(*) INTO v_event_count
  FROM public.calendar_event
  WHERE owner_user_id = v_owner;
  IF v_event_count <> 1 THEN
    RAISE EXCEPTION 'Stale snapshot must not create an Event, found %', v_event_count;
  END IF;
END;
$test$;

RESET ROLE;
ROLLBACK;
