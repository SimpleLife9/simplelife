-- Owner-private Protected Time blocks and atomic authenticated mutations.
-- Source migration only. Apply in the ephemeral CI database; hosted DDL remains behind
-- a separate Human Gate. No exclusion constraint: overlaps are explained to the user
-- and only an explicit user decision can preserve an overlap.

CREATE OR REPLACE FUNCTION public.is_valid_protected_weekday_set(p_weekdays smallint[])
RETURNS boolean
LANGUAGE sql
IMMUTABLE
STRICT
PARALLEL SAFE
SET search_path = pg_catalog
AS $function$
  SELECT cardinality(p_weekdays) BETWEEN 1 AND 7
    AND p_weekdays <@ ARRAY[1, 2, 3, 4, 5, 6, 7]::smallint[]
    AND (
      SELECT count(*) = count(DISTINCT weekday)
      FROM unnest(p_weekdays) AS values(weekday)
    );
$function$;

ALTER FUNCTION public.is_valid_protected_weekday_set(smallint[]) OWNER TO postgres;
REVOKE ALL PRIVILEGES ON FUNCTION public.is_valid_protected_weekday_set(smallint[])
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_valid_protected_weekday_set(smallint[]) TO service_role;

CREATE TABLE public.protected_time_block (
  id uuid PRIMARY KEY,
  owner_user_id uuid NOT NULL REFERENCES public.user_profile(id) ON DELETE RESTRICT,
  created_by_user_id uuid NOT NULL REFERENCES public.user_profile(id) ON DELETE RESTRICT,
  updated_by_user_id uuid NOT NULL REFERENCES public.user_profile(id) ON DELETE RESTRICT,

  label text NOT NULL CHECK (length(btrim(label)) BETWEEN 1 AND 120),
  category text CHECK (category IS NULL OR length(btrim(category)) BETWEEN 1 AND 50),
  protection_mode text NOT NULL CHECK (protection_mode IN ('hard', 'flexible')),
  pattern_kind text NOT NULL CHECK (pattern_kind IN ('one_off', 'weekly')),
  time_zone text NOT NULL CHECK (length(btrim(time_zone)) BETWEEN 1 AND 100),

  -- One-off civil-time range. The local wall time and authoritative instant
  -- are both retained; resolver metadata pins the IANA TZDB decision.
  start_local timestamp without time zone,
  end_local timestamp without time zone,
  starts_at timestamptz,
  ends_at timestamptz,
  start_disambiguation text CHECK (start_disambiguation IS NULL OR start_disambiguation IN ('earlier', 'later', 'reject')),
  end_disambiguation text CHECK (end_disambiguation IS NULL OR end_disambiguation IN ('earlier', 'later', 'reject')),
  start_gap_strategy text CHECK (start_gap_strategy IS NULL OR start_gap_strategy = 'next-valid'),
  end_gap_strategy text CHECK (end_gap_strategy IS NULL OR end_gap_strategy = 'next-valid'),

  -- Weekly civil-time rule. Occurrences are expanded only for a bounded
  -- requested calendar window; a rule is not a pre-materialized Event series.
  start_date date,
  end_date_exclusive date,
  weekdays smallint[],
  start_time_local time without time zone,
  end_time_local time without time zone,
  ends_next_day boolean,

  resolver_metadata jsonb NOT NULL CHECK (jsonb_typeof(resolver_metadata) = 'object'),
  archived_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT protected_time_block_id_uuidv7_check
    CHECK ((get_byte(uuid_send(id), 6) >> 4) = 7 AND (get_byte(uuid_send(id), 8) & 192) = 128),
  CONSTRAINT protected_time_block_actor_check
    CHECK (owner_user_id = created_by_user_id AND owner_user_id = updated_by_user_id),
  CONSTRAINT protected_time_block_owner_identity_uq UNIQUE (id, owner_user_id),
  CONSTRAINT protected_time_block_lifecycle_check
    CHECK (archived_at IS NULL OR deleted_at IS NULL),
  CONSTRAINT protected_time_block_resolver_check
    CHECK (
      resolver_metadata->>'rulesSource' = 'iana-tzdb'
      AND resolver_metadata->>'authoritative' = 'true'
      AND length(coalesce(resolver_metadata->>'rulesVersion', '')) > 0
      AND length(coalesce(resolver_metadata->>'resolverVersion', '')) > 0
    ),
  CONSTRAINT protected_time_block_temporal_shape_check CHECK (
    (
      pattern_kind = 'one_off'
      AND start_local IS NOT NULL
      AND end_local IS NOT NULL
      AND end_local > start_local
      AND starts_at IS NOT NULL
      AND ends_at IS NOT NULL
      AND isfinite(starts_at)
      AND isfinite(ends_at)
      AND ends_at > starts_at
      AND start_disambiguation IS NOT NULL
      AND end_disambiguation IS NOT NULL
      AND start_gap_strategy = 'next-valid'
      AND end_gap_strategy = 'next-valid'
      AND start_date IS NULL
      AND end_date_exclusive IS NULL
      AND weekdays IS NULL
      AND start_time_local IS NULL
      AND end_time_local IS NULL
      AND ends_next_day IS NULL
    )
    OR
    (
      pattern_kind = 'weekly'
      AND start_local IS NULL
      AND end_local IS NULL
      AND starts_at IS NULL
      AND ends_at IS NULL
      AND start_disambiguation IS NULL
      AND end_disambiguation IS NULL
      AND start_gap_strategy IS NULL
      AND end_gap_strategy IS NULL
      AND start_date IS NOT NULL
      AND isfinite(start_date)
      AND (end_date_exclusive IS NULL OR (
        isfinite(end_date_exclusive) AND end_date_exclusive > start_date
      ))
      AND public.is_valid_protected_weekday_set(weekdays)
      AND start_time_local IS NOT NULL
      AND end_time_local IS NOT NULL
      AND ends_next_day IS NOT NULL
      AND (
        (ends_next_day AND end_time_local <= start_time_local)
        OR (NOT ends_next_day AND end_time_local > start_time_local)
      )
    )
  )
);

COMMENT ON TABLE public.protected_time_block IS
  'Private owner-scoped personal time protection. Hard/flexible overlaps are explained, not forbidden by a database exclusion constraint.';
COMMENT ON COLUMN public.protected_time_block.resolver_metadata IS
  'Authoritative IANA TZDB and resolver evidence. Weekly rules retain the version/policy used to validate their first occurrence.';

CREATE INDEX protected_time_block_owner_lifecycle_idx
  ON public.protected_time_block (owner_user_id, archived_at, deleted_at);
CREATE INDEX protected_time_block_owner_one_off_range_idx
  ON public.protected_time_block (owner_user_id, starts_at, ends_at)
  WHERE pattern_kind = 'one_off' AND deleted_at IS NULL;
CREATE INDEX protected_time_block_owner_weekly_start_idx
  ON public.protected_time_block (owner_user_id, start_date)
  WHERE pattern_kind = 'weekly' AND deleted_at IS NULL;

ALTER TABLE public.protected_time_block ENABLE ROW LEVEL SECURITY;

CREATE POLICY protected_time_block_read_self
  ON public.protected_time_block
  FOR SELECT
  TO authenticated
  USING (
    owner_user_id IN (
      SELECT id
      FROM public.user_profile
      WHERE auth_user_id = (SELECT auth.uid())
    )
  );

REVOKE ALL PRIVILEGES ON TABLE public.protected_time_block
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.protected_time_block TO authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.protected_time_block TO service_role;

CREATE OR REPLACE FUNCTION private.touch_protected_time_block_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $function$
BEGIN
  NEW.updated_at := GREATEST(clock_timestamp(), OLD.updated_at + interval '1 microsecond');
  RETURN NEW;
END;
$function$;

ALTER FUNCTION private.touch_protected_time_block_updated_at() OWNER TO postgres;
REVOKE ALL PRIVILEGES ON FUNCTION private.touch_protected_time_block_updated_at()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER protected_time_block_touch_updated_at
  BEFORE UPDATE ON public.protected_time_block
  FOR EACH ROW EXECUTE FUNCTION private.touch_protected_time_block_updated_at();

CREATE OR REPLACE FUNCTION private.append_protected_time_block_audit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_changed_fields text[] := ARRAY[]::text[];
  v_details jsonb;
  v_lifecycle_before text;
  v_lifecycle_after text;
BEGIN
  IF NEW.owner_user_id IS NULL
     OR NEW.created_by_user_id IS NULL
     OR NEW.updated_by_user_id IS NULL
     OR NEW.owner_user_id <> NEW.created_by_user_id
     OR NEW.owner_user_id <> NEW.updated_by_user_id THEN
    RAISE EXCEPTION 'Protected Time owner and actor fields must match the verified owner';
  END IF;

  IF TG_OP = 'INSERT' THEN
    v_details := jsonb_build_object(
      'changed_fields', to_jsonb(ARRAY['created']::text[]),
      'protection_mode', NEW.protection_mode,
      'pattern_kind', NEW.pattern_kind,
      'lifecycle_after', 'active'
    );

    INSERT INTO public.audit_event (
      id, account_user_id, actor_user_id, action, entity_type, entity_id,
      result, source, details, occurred_at, recorded_at
    ) VALUES (
      private.uuidv7(), NEW.owner_user_id, NEW.updated_by_user_id,
      'protected_time_block.created', 'protected_time_block', NEW.id,
      'success', 'user', v_details, clock_timestamp(), clock_timestamp()
    );
    RETURN NEW;
  END IF;

  IF TG_OP <> 'UPDATE' THEN
    RAISE EXCEPTION 'Unsupported Protected Time audit operation: %', TG_OP;
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.owner_user_id IS DISTINCT FROM OLD.owner_user_id
     OR NEW.created_by_user_id IS DISTINCT FROM OLD.created_by_user_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Protected Time identity, owner, creator and creation time are immutable';
  END IF;

  SELECT coalesce(array_agg(k ORDER BY k), ARRAY[]::text[])
    INTO v_changed_fields
  FROM jsonb_object_keys(to_jsonb(NEW)) AS keys(k)
  WHERE k <> 'updated_at'
    AND (to_jsonb(NEW)->k) IS DISTINCT FROM (to_jsonb(OLD)->k);

  IF cardinality(v_changed_fields) = 0 THEN
    RETURN NEW;
  END IF;

  v_lifecycle_before := CASE
    WHEN OLD.deleted_at IS NOT NULL THEN 'trash'
    WHEN OLD.archived_at IS NOT NULL THEN 'archived'
    ELSE 'active'
  END;
  v_lifecycle_after := CASE
    WHEN NEW.deleted_at IS NOT NULL THEN 'trash'
    WHEN NEW.archived_at IS NOT NULL THEN 'archived'
    ELSE 'active'
  END;

  v_details := jsonb_build_object(
    'changed_fields', to_jsonb(v_changed_fields),
    'protection_mode_before', OLD.protection_mode,
    'protection_mode_after', NEW.protection_mode,
    'pattern_kind_before', OLD.pattern_kind,
    'pattern_kind_after', NEW.pattern_kind,
    'lifecycle_before', v_lifecycle_before,
    'lifecycle_after', v_lifecycle_after
  );

  INSERT INTO public.audit_event (
    id, account_user_id, actor_user_id, action, entity_type, entity_id,
    result, source, details, occurred_at, recorded_at
  ) VALUES (
    private.uuidv7(), NEW.owner_user_id, NEW.updated_by_user_id,
    'protected_time_block.updated', 'protected_time_block', NEW.id,
    'success', 'user', v_details, clock_timestamp(), clock_timestamp()
  );
  RETURN NEW;
END;
$function$;

ALTER FUNCTION private.append_protected_time_block_audit() OWNER TO postgres;
REVOKE ALL PRIVILEGES ON FUNCTION private.append_protected_time_block_audit()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER protected_time_block_append_audit
  AFTER INSERT OR UPDATE ON public.protected_time_block
  FOR EACH ROW EXECUTE FUNCTION private.append_protected_time_block_audit();

CREATE TABLE public.protected_time_block_mutation_request (
  owner_user_id uuid NOT NULL REFERENCES public.user_profile(id) ON DELETE RESTRICT,
  idempotency_key uuid NOT NULL,
  block_id uuid NOT NULL,
  payload_version text NOT NULL CHECK (payload_version = 'protected-time-mutation-v1'),
  payload_hash bytea NOT NULL CHECK (octet_length(payload_hash) = 32),
  response_http_status integer,
  response_body jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,

  PRIMARY KEY (owner_user_id, idempotency_key),
  CONSTRAINT protected_time_mutation_key_uuidv7_check
    CHECK ((get_byte(uuid_send(idempotency_key), 6) >> 4) = 7
      AND (get_byte(uuid_send(idempotency_key), 8) & 192) = 128),
  CONSTRAINT protected_time_mutation_block_uuidv7_check
    CHECK ((get_byte(uuid_send(block_id), 6) >> 4) = 7
      AND (get_byte(uuid_send(block_id), 8) & 192) = 128),
  CONSTRAINT protected_time_mutation_response_complete_check
    CHECK (
      (response_http_status IS NULL AND response_body IS NULL AND completed_at IS NULL)
      OR (response_http_status IN (200, 201, 404, 409)
        AND response_body IS NOT NULL AND completed_at IS NOT NULL)
    )
);

ALTER TABLE public.protected_time_block_mutation_request ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.protected_time_block_mutation_request
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.protected_time_block_mutation_request TO service_role;

CREATE OR REPLACE FUNCTION public.mutate_protected_time_block_once(
  p_owner_user_id uuid,
  p_block_id uuid,
  p_idempotency_key uuid,
  p_payload_version text,
  p_payload_hash_hex text,
  p_expected_updated_at timestamptz,
  p_mutation text,
  p_block_patch jsonb,
  p_now timestamptz
)
RETURNS TABLE (
  http_status integer,
  response_body jsonb,
  replayed boolean
)
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_block public.protected_time_block%ROWTYPE;
  v_next public.protected_time_block%ROWTYPE;
  v_existing public.protected_time_block_mutation_request%ROWTYPE;
  v_claimed_rows integer;
  v_payload_hash bytea;
  v_status integer;
  v_response jsonb;
  v_lifecycle text;
BEGIN
  IF current_user <> 'service_role' THEN
    RAISE EXCEPTION 'mutate_protected_time_block_once requires service_role'
      USING ERRCODE = '42501';
  END IF;

  IF p_owner_user_id IS NULL OR p_block_id IS NULL OR p_idempotency_key IS NULL OR p_now IS NULL THEN
    RAISE EXCEPTION 'Verified owner, block, idempotency key and server timestamp are required'
      USING ERRCODE = '22023';
  END IF;

  IF (get_byte(uuid_send(p_block_id), 6) >> 4) <> 7
     OR (get_byte(uuid_send(p_block_id), 8) & 192) <> 128
     OR (get_byte(uuid_send(p_idempotency_key), 6) >> 4) <> 7
     OR (get_byte(uuid_send(p_idempotency_key), 8) & 192) <> 128 THEN
    RAISE EXCEPTION 'Block id and Idempotency-Key must be UUIDv7 values'
      USING ERRCODE = '22023';
  END IF;

  IF p_payload_version IS DISTINCT FROM 'protected-time-mutation-v1'
     OR p_payload_hash_hex IS NULL
     OR p_payload_hash_hex !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Protected Time mutation payload version/hash is invalid'
      USING ERRCODE = '22023';
  END IF;
  v_payload_hash := decode(p_payload_hash_hex, 'hex');

  IF p_mutation IS NULL OR p_mutation NOT IN ('create', 'edit', 'archive', 'restore', 'delete') THEN
    RAISE EXCEPTION 'Unsupported Protected Time mutation'
      USING ERRCODE = '22023';
  END IF;

  IF p_mutation IN ('create', 'edit') THEN
    IF p_block_patch IS NULL OR jsonb_typeof(p_block_patch) <> 'object'
       OR (SELECT count(*) FROM jsonb_object_keys(p_block_patch)) <> 20
       OR EXISTS (
         SELECT 1 FROM jsonb_object_keys(p_block_patch) AS supplied(key)
         WHERE supplied.key <> ALL (ARRAY[
           'label', 'category', 'protection_mode', 'pattern_kind', 'time_zone',
           'start_local', 'end_local', 'starts_at', 'ends_at',
           'start_disambiguation', 'end_disambiguation',
           'start_gap_strategy', 'end_gap_strategy',
           'start_date', 'end_date_exclusive', 'weekdays',
           'start_time_local', 'end_time_local', 'ends_next_day',
           'resolver_metadata'
         ]::text[])
       ) THEN
      RAISE EXCEPTION 'Protected Time patch must contain exactly the 20 editable fields'
        USING ERRCODE = '22023';
    END IF;
  ELSIF p_block_patch IS DISTINCT FROM '{}'::jsonb THEN
    RAISE EXCEPTION 'Only Protected Time create/edit may contain a block patch'
      USING ERRCODE = '22023';
  END IF;

  IF (p_mutation = 'create' AND p_expected_updated_at IS NOT NULL)
     OR (p_mutation <> 'create' AND p_expected_updated_at IS NULL) THEN
    RAISE EXCEPTION 'Only create omits expected_updated_at'
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.protected_time_block_mutation_request (
    owner_user_id, idempotency_key, block_id, payload_version, payload_hash
  ) VALUES (
    p_owner_user_id, p_idempotency_key, p_block_id, p_payload_version, v_payload_hash
  )
  ON CONFLICT (owner_user_id, idempotency_key) DO NOTHING;

  GET DIAGNOSTICS v_claimed_rows = ROW_COUNT;
  IF v_claimed_rows = 0 THEN
    SELECT * INTO v_existing
    FROM public.protected_time_block_mutation_request
    WHERE owner_user_id = p_owner_user_id
      AND idempotency_key = p_idempotency_key
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Concurrent Protected Time mutation claim was not visible; retry the same key'
        USING ERRCODE = '40001';
    END IF;

    IF v_existing.block_id IS DISTINCT FROM p_block_id
       OR v_existing.payload_version IS DISTINCT FROM p_payload_version
       OR v_existing.payload_hash IS DISTINCT FROM v_payload_hash THEN
      RETURN QUERY SELECT 409, jsonb_build_object('error', 'IDEMPOTENCY_KEY_REUSED'), false;
      RETURN;
    END IF;

    IF v_existing.response_http_status IS NULL OR v_existing.response_body IS NULL THEN
      RAISE EXCEPTION 'A committed Protected Time mutation receipt is incomplete'
        USING ERRCODE = '55000';
    END IF;

    RETURN QUERY SELECT v_existing.response_http_status, v_existing.response_body, true;
    RETURN;
  END IF;

  IF p_mutation = 'create' THEN
    v_next := jsonb_populate_record(NULL::public.protected_time_block, p_block_patch);
    INSERT INTO public.protected_time_block (
      id, owner_user_id, created_by_user_id, updated_by_user_id,
      label, category, protection_mode, pattern_kind, time_zone,
      start_local, end_local, starts_at, ends_at,
      start_disambiguation, end_disambiguation, start_gap_strategy, end_gap_strategy,
      start_date, end_date_exclusive, weekdays, start_time_local, end_time_local, ends_next_day,
      resolver_metadata, created_at, updated_at
    ) VALUES (
      p_block_id, p_owner_user_id, p_owner_user_id, p_owner_user_id,
      v_next.label, v_next.category, v_next.protection_mode, v_next.pattern_kind, v_next.time_zone,
      v_next.start_local, v_next.end_local, v_next.starts_at, v_next.ends_at,
      v_next.start_disambiguation, v_next.end_disambiguation, v_next.start_gap_strategy, v_next.end_gap_strategy,
      v_next.start_date, v_next.end_date_exclusive, v_next.weekdays,
      v_next.start_time_local, v_next.end_time_local, v_next.ends_next_day,
      v_next.resolver_metadata, p_now, p_now
    )
    RETURNING * INTO v_block;
    v_status := 201;

  ELSE
    SELECT * INTO v_block
    FROM public.protected_time_block
    WHERE id = p_block_id AND owner_user_id = p_owner_user_id
    FOR UPDATE;

    IF NOT FOUND THEN
      v_status := 404;
      v_response := jsonb_build_object('error', 'PROTECTED_TIME_BLOCK_NOT_FOUND');

    ELSIF v_block.updated_at IS DISTINCT FROM p_expected_updated_at THEN
      v_status := 409;
      v_response := jsonb_build_object(
        'error', 'PROTECTED_TIME_BLOCK_VERSION_CONFLICT',
        'currentUpdatedAt', to_char(v_block.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
      );

    ELSE
      v_lifecycle := CASE
        WHEN v_block.deleted_at IS NOT NULL THEN 'trash'
        WHEN v_block.archived_at IS NOT NULL THEN 'archived'
        ELSE 'active'
      END;

      CASE p_mutation
        WHEN 'edit' THEN
          IF v_lifecycle <> 'active' THEN
            v_status := 409;
            v_response := jsonb_build_object('error', 'PROTECTED_TIME_BLOCK_NOT_EDITABLE');
          ELSE
            v_next := jsonb_populate_record(v_block, p_block_patch);
            UPDATE public.protected_time_block
            SET label = v_next.label,
                category = v_next.category,
                protection_mode = v_next.protection_mode,
                pattern_kind = v_next.pattern_kind,
                time_zone = v_next.time_zone,
                start_local = v_next.start_local,
                end_local = v_next.end_local,
                starts_at = v_next.starts_at,
                ends_at = v_next.ends_at,
                start_disambiguation = v_next.start_disambiguation,
                end_disambiguation = v_next.end_disambiguation,
                start_gap_strategy = v_next.start_gap_strategy,
                end_gap_strategy = v_next.end_gap_strategy,
                start_date = v_next.start_date,
                end_date_exclusive = v_next.end_date_exclusive,
                weekdays = v_next.weekdays,
                start_time_local = v_next.start_time_local,
                end_time_local = v_next.end_time_local,
                ends_next_day = v_next.ends_next_day,
                resolver_metadata = v_next.resolver_metadata,
                updated_by_user_id = p_owner_user_id
            WHERE id = p_block_id AND owner_user_id = p_owner_user_id
            RETURNING * INTO v_block;
            v_status := 200;
          END IF;

        WHEN 'archive' THEN
          IF v_lifecycle <> 'active' THEN
            v_status := 409;
            v_response := jsonb_build_object('error', 'PROTECTED_TIME_BLOCK_NOT_ARCHIVABLE');
          ELSE
            UPDATE public.protected_time_block
            SET archived_at = p_now, updated_by_user_id = p_owner_user_id
            WHERE id = p_block_id AND owner_user_id = p_owner_user_id
            RETURNING * INTO v_block;
            v_status := 200;
          END IF;

        WHEN 'restore' THEN
          IF v_lifecycle IN ('archived', 'trash') THEN
            UPDATE public.protected_time_block
            SET archived_at = NULL, deleted_at = NULL, updated_by_user_id = p_owner_user_id
            WHERE id = p_block_id AND owner_user_id = p_owner_user_id
            RETURNING * INTO v_block;
            v_status := 200;
          ELSE
            v_status := 409;
            v_response := jsonb_build_object('error', 'PROTECTED_TIME_BLOCK_NOT_RESTORABLE');
          END IF;

        WHEN 'delete' THEN
          IF v_lifecycle = 'trash' THEN
            v_status := 409;
            v_response := jsonb_build_object('error', 'PROTECTED_TIME_BLOCK_ALREADY_DELETED');
          ELSE
            UPDATE public.protected_time_block
            SET archived_at = NULL, deleted_at = p_now, updated_by_user_id = p_owner_user_id
            WHERE id = p_block_id AND owner_user_id = p_owner_user_id
            RETURNING * INTO v_block;
            v_status := 200;
          END IF;
      END CASE;
    END IF;
  END IF;

  IF v_status IN (200, 201) THEN
    v_lifecycle := CASE
      WHEN v_block.deleted_at IS NOT NULL THEN 'trash'
      WHEN v_block.archived_at IS NOT NULL THEN 'archived'
      ELSE 'active'
    END;
    v_response := jsonb_build_object(
      'blockId', v_block.id::text,
      'updatedAt', to_char(v_block.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'label', v_block.label,
      'category', v_block.category,
      'protectionMode', v_block.protection_mode,
      'patternKind', v_block.pattern_kind,
      'timeZone', v_block.time_zone,
      'lifecycle', v_lifecycle,
      'resolverMetadata', v_block.resolver_metadata,
      'oneOff', CASE WHEN v_block.pattern_kind = 'one_off' THEN jsonb_build_object(
        'startLocalDateTime', v_block.start_local,
        'endLocalDateTime', v_block.end_local,
        'startsAt', v_block.starts_at,
        'endsAt', v_block.ends_at,
        'startDisambiguation', v_block.start_disambiguation,
        'endDisambiguation', v_block.end_disambiguation
      ) ELSE NULL END,
      'weekly', CASE WHEN v_block.pattern_kind = 'weekly' THEN jsonb_build_object(
        'startDate', v_block.start_date,
        'endDateExclusive', v_block.end_date_exclusive,
        'weekdays', to_jsonb(v_block.weekdays),
        'startLocalTime', v_block.start_time_local,
        'endLocalTime', v_block.end_time_local,
        'endsNextDay', v_block.ends_next_day
      ) ELSE NULL END
    );
  END IF;

  UPDATE public.protected_time_block_mutation_request
  SET response_http_status = v_status,
      response_body = v_response,
      completed_at = p_now
  WHERE owner_user_id = p_owner_user_id
    AND idempotency_key = p_idempotency_key;

  RETURN QUERY SELECT v_status, v_response, false;
END;
$function$;

ALTER FUNCTION public.mutate_protected_time_block_once(uuid, uuid, uuid, text, text, timestamptz, text, jsonb, timestamptz)
  OWNER TO postgres;

REVOKE ALL PRIVILEGES ON FUNCTION public.mutate_protected_time_block_once(uuid, uuid, uuid, text, text, timestamptz, text, jsonb, timestamptz)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mutate_protected_time_block_once(uuid, uuid, uuid, text, text, timestamptz, text, jsonb, timestamptz)
  TO service_role;
