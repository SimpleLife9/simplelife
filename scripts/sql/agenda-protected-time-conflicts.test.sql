-- Ephemeral PostgreSQL integration test for Event consent and Protected Time snapshot atomicity.
-- This test runs in a transaction and is always rolled back by CI.
BEGIN;

INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data
) VALUES (
  'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'agenda-conflict-audit@example.invalid',
  '', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.user_profile (id, auth_user_id, display_name)
VALUES (
  '019a0000-0000-7000-8000-000000000041',
  'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  'Conflict audit owner'
)
ON CONFLICT (id) DO NOTHING;

DO $test$
DECLARE
  v_owner uuid := '019a0000-0000-7000-8000-000000000041';
  v_block uuid := private.uuidv7();
  v_event uuid := private.uuidv7();
  v_key uuid := private.uuidv7();
  v_stale_key uuid := private.uuidv7();
  v_block_version timestamptz;
  v_event_version timestamptz;
  v_status integer;
  v_body jsonb;
  v_replayed boolean;
  v_patch jsonb;
  v_audit_count bigint;
  v_receipt_count bigint;
  v_event_title text;
  v_changed_version timestamptz;
BEGIN
  INSERT INTO public.protected_time_block (
    id, owner_user_id, created_by_user_id, updated_by_user_id,
    label, category, protection_mode, pattern_kind, time_zone,
    start_local, end_local, starts_at, ends_at,
    start_disambiguation, end_disambiguation, start_gap_strategy, end_gap_strategy,
    resolver_metadata
  ) VALUES (
    v_block, v_owner, v_owner, v_owner,
    'Sueño protegido', 'salud', 'hard', 'one_off', 'America/Havana',
    timestamp '2026-12-24 01:00:00', timestamp '2026-12-24 02:00:00',
    timestamptz '2026-12-24 06:00:00+00', timestamptz '2026-12-24 07:00:00+00',
    'earlier', 'earlier', 'next-valid', 'next-valid',
    jsonb_build_object(
      'rulesSource', 'iana-tzdb',
      'rulesVersion', '2026f',
      'resolverVersion', 'agenda-iana-resolver-v1',
      'authoritative', true
    )
  );

  SELECT updated_at INTO v_block_version
  FROM public.protected_time_block
  WHERE id = v_block AND owner_user_id = v_owner;

  INSERT INTO public.calendar_event (
    id, owner_user_id, created_by_user_id, updated_by_user_id,
    title, event_status, temporal_kind, start_date, end_date_exclusive,
    protected_time_decisions
  ) VALUES (
    v_event, v_owner, v_owner, v_owner,
    'Conflict audit test Event', 'confirmed', 'all_day',
    DATE '2026-12-24', DATE '2026-12-25', '[]'::jsonb
  );

  SELECT updated_at INTO v_event_version
  FROM public.calendar_event
  WHERE id = v_event AND owner_user_id = v_owner;

  v_patch := jsonb_build_object(
    'title', 'Conflict audit test Event with consent',
    'description', NULL,
    'location_label', NULL,
    'location_kind', NULL,
    'temporal_kind', 'all_day',
    'start_date', '2026-12-24',
    'end_date_exclusive', '2026-12-25',
    'start_local', NULL,
    'end_local', NULL,
    'time_zone', NULL,
    'starts_at', NULL,
    'ends_at', NULL,
    'start_disambiguation', NULL,
    'end_disambiguation', NULL,
    'start_gap_strategy', NULL,
    'end_gap_strategy', NULL,
    'protected_time_decisions', jsonb_build_array(
      jsonb_build_object(
        'policyVersion', 'protected-time-decision-v1',
        'blockId', v_block::text,
        'blockUpdatedAt', to_char(v_block_version AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
        'protectionMode', 'hard',
        'occurrenceDate', NULL,
        'occurrenceStartsAt', '2026-12-24T06:00:00.000Z',
        'occurrenceEndsAt', '2026-12-24T07:00:00.000Z',
        'overlapStartsAt', '2026-12-24T06:00:00.000Z',
        'overlapEndsAt', '2026-12-24T07:00:00.000Z',
        'timeZone', 'America/Havana',
        'decision', 'override_hard',
        'consentedAt', '2026-11-22T19:00:00.000Z'
      )
    ),
    'protected_time_snapshot', jsonb_build_array(
      jsonb_build_object(
        'id', v_block::text,
        'updated_at', to_char(v_block_version AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
      )
    )
  );

  IF jsonb_object_length(v_patch) <> 18 THEN
    RAISE EXCEPTION 'Event edit patch should contain exactly 18 fields, got %', jsonb_object_length(v_patch);
  END IF;

  EXECUTE 'SET LOCAL ROLE service_role';
  SELECT r.http_status, r.response_body, r.replayed
    INTO v_status, v_body, v_replayed
  FROM public.mutate_calendar_event_once(
    v_owner, v_event, v_key, 'event-mutation-v1', repeat('a', 64),
    v_event_version, 'edit', v_patch, clock_timestamp()
  ) AS r;

  IF v_status <> 200 OR v_replayed IS NOT FALSE OR v_body ->> 'eventId' <> v_event::text THEN
    RAISE EXCEPTION 'Event save with explicit Protected Time decision failed: %, %, %',
      v_status, v_body, v_replayed;
  END IF;

  EXECUTE 'RESET ROLE';
  SELECT count(*) INTO v_audit_count
  FROM public.audit_event
  WHERE entity_type = 'calendar_event'
    AND entity_id = v_event
    AND account_user_id = v_owner
    AND action = 'calendar_event.protected_time_decisions_recorded'
    AND details ->> 'decision_version' = 'protected-time-decision-v1'
    AND jsonb_array_length(details -> 'decisions') = 1;
  IF v_audit_count <> 1 THEN
    RAISE EXCEPTION 'Expected one append-only Protected Time consent audit row, got %', v_audit_count;
  END IF;

  SELECT updated_at INTO v_event_version
  FROM public.calendar_event WHERE id = v_event AND owner_user_id = v_owner;

  -- A Protected Time edit changes its version after the Event UI's conflict analysis.
  UPDATE public.protected_time_block
  SET label = 'Sueño protegido actualizado',
      updated_at = clock_timestamp()
  WHERE id = v_block AND owner_user_id = v_owner
  RETURNING updated_at INTO v_changed_version;
  IF v_changed_version IS NOT DISTINCT FROM v_block_version THEN
    RAISE EXCEPTION 'Protected Time version fixture did not advance';
  END IF;

  -- The previous consent snapshot is now stale. The writer must reject before
  -- claiming an idempotency receipt or changing the Event.
  EXECUTE 'SET LOCAL ROLE service_role';
  SELECT r.http_status, r.response_body, r.replayed
    INTO v_status, v_body, v_replayed
  FROM public.mutate_calendar_event_once(
    v_owner, v_event, v_stale_key, 'event-mutation-v1', repeat('b', 64),
    v_event_version, 'edit', v_patch, clock_timestamp()
  ) AS r;

  IF v_status <> 409 OR v_body ->> 'error' <> 'PROTECTED_TIME_CONFLICTS_CHANGED' THEN
    RAISE EXCEPTION 'Stale Protected Time snapshot was not rejected: %, %', v_status, v_body;
  END IF;

  EXECUTE 'RESET ROLE';
  SELECT title INTO v_event_title FROM public.calendar_event WHERE id = v_event;
  IF v_event_title <> 'Conflict audit test Event with consent' THEN
    RAISE EXCEPTION 'Stale Protected Time snapshot changed the Event unexpectedly';
  END IF;

  SELECT count(*) INTO v_receipt_count
  FROM public.event_mutation_request
  WHERE owner_user_id = v_owner
    AND idempotency_key = v_stale_key;
  IF v_receipt_count <> 0 THEN
    RAISE EXCEPTION 'Stale snapshot must be rejected before idempotency receipt claim';
  END IF;

  RAISE NOTICE 'PASS: explicit hard override persisted with Event mutation.';
  RAISE NOTICE 'PASS: decision trigger appended one owner-scoped immutable audit row.';
  RAISE NOTICE 'PASS: stale Protected Time snapshot returns HTTP 409 before receipt claim.';
END;
$test$;

ROLLBACK;
