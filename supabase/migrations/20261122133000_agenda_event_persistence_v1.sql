
-- First persisted Agenda slice: one-off Events and transactional audit append.
-- This migration is source code only until an independent hosted Supabase Human Gate.
-- Apply locally only after the six recovered migrations and the platform RLS bootstrap.

CREATE OR REPLACE FUNCTION private.uuidv7()
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SET search_path = pg_catalog
AS $function$
DECLARE
  v_unix_ms bigint;
  v_bytes bytea;
  v_hex text;
BEGIN
  v_unix_ms := floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint;

  IF v_unix_ms < 0 OR v_unix_ms >= 281474976710656 THEN
    RAISE EXCEPTION 'UUIDv7 timestamp is outside the 48-bit range';
  END IF;

  v_bytes := decode(
    lpad(to_hex(v_unix_ms), 12, '0')
      || encode(extensions.gen_random_bytes(10), 'hex'),
    'hex'
  );

  -- UUIDv7 version nibble and RFC 4122 variant bits.
  v_bytes := set_byte(v_bytes, 6, (get_byte(v_bytes, 6) & 15) | 112);
  v_bytes := set_byte(v_bytes, 8, (get_byte(v_bytes, 8) & 63) | 128);
  v_hex := encode(v_bytes, 'hex');

  RETURN (
    substring(v_hex, 1, 8) || '-' ||
    substring(v_hex, 9, 4) || '-' ||
    substring(v_hex, 13, 4) || '-' ||
    substring(v_hex, 17, 4) || '-' ||
    substring(v_hex, 21, 12)
  )::uuid;
END;
$function$;

ALTER FUNCTION private.uuidv7() OWNER TO postgres;
REVOKE ALL PRIVILEGES ON FUNCTION private.uuidv7()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE public.calendar_event (
  id uuid PRIMARY KEY,
  owner_user_id uuid NOT NULL REFERENCES public.user_profile(id) ON DELETE RESTRICT,
  created_by_user_id uuid NOT NULL REFERENCES public.user_profile(id) ON DELETE RESTRICT,
  updated_by_user_id uuid NOT NULL REFERENCES public.user_profile(id) ON DELETE RESTRICT,

  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 200),
  description text CHECK (description IS NULL OR length(description) <= 5000),
  location_label text CHECK (location_label IS NULL OR length(location_label) <= 500),
  location_kind text CHECK (location_kind IS NULL OR location_kind IN ('physical', 'online', 'other')),

  event_status text NOT NULL DEFAULT 'confirmed'
    CHECK (event_status IN ('preparing', 'proposed', 'confirmed', 'cancelled', 'finished')),
  temporal_kind text NOT NULL
    CHECK (temporal_kind IN ('all_day', 'zoned_civil', 'fixed_instant')),

  start_date date,
  end_date_exclusive date,
  start_local timestamp without time zone,
  end_local timestamp without time zone,
  time_zone text,
  starts_at timestamptz,
  ends_at timestamptz,
  start_disambiguation text CHECK (start_disambiguation IS NULL OR start_disambiguation IN ('earlier', 'later')),
  end_disambiguation text CHECK (end_disambiguation IS NULL OR end_disambiguation IN ('earlier', 'later')),
  start_gap_strategy text CHECK (start_gap_strategy IS NULL OR start_gap_strategy = 'next-valid'),
  end_gap_strategy text CHECK (end_gap_strategy IS NULL OR end_gap_strategy = 'next-valid'),

  archived_at timestamptz,
  deleted_at timestamptz,
  purge_after timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT calendar_event_id_uuidv7_check
    CHECK ((get_byte(uuid_send(id), 6) >> 4) = 7 AND (get_byte(uuid_send(id), 8) & 192) = 128),
  CONSTRAINT calendar_event_phase1_actor_check
    CHECK (owner_user_id = created_by_user_id AND owner_user_id = updated_by_user_id),
  CONSTRAINT calendar_event_owner_identity_uq UNIQUE (id, owner_user_id),
  CONSTRAINT calendar_event_archive_trash_exclusive_check
    CHECK (archived_at IS NULL OR deleted_at IS NULL),
  CONSTRAINT calendar_event_trash_retention_check
    CHECK (
      (deleted_at IS NULL AND purge_after IS NULL)
      OR (deleted_at IS NOT NULL AND purge_after = deleted_at + interval '30 days')
    ),
  CONSTRAINT calendar_event_temporal_shape_check CHECK (
    (
      temporal_kind = 'all_day'
      AND start_date IS NOT NULL
      AND end_date_exclusive IS NOT NULL
      AND isfinite(start_date)
      AND isfinite(end_date_exclusive)
      AND end_date_exclusive > start_date
      AND start_local IS NULL
      AND end_local IS NULL
      AND time_zone IS NULL
      AND starts_at IS NULL
      AND ends_at IS NULL
      AND start_disambiguation IS NULL
      AND end_disambiguation IS NULL
      AND start_gap_strategy IS NULL
      AND end_gap_strategy IS NULL
    )
    OR
    (
      temporal_kind = 'fixed_instant'
      AND start_date IS NULL
      AND end_date_exclusive IS NULL
      AND start_local IS NULL
      AND end_local IS NULL
      AND starts_at IS NOT NULL
      AND ends_at IS NOT NULL
      AND isfinite(starts_at)
      AND isfinite(ends_at)
      AND ends_at > starts_at
      AND start_disambiguation IS NULL
      AND end_disambiguation IS NULL
      AND start_gap_strategy IS NULL
      AND end_gap_strategy IS NULL
      AND (time_zone IS NULL OR length(btrim(time_zone)) > 0)
    )
    OR
    (
      temporal_kind = 'zoned_civil'
      AND start_date IS NULL
      AND end_date_exclusive IS NULL
      AND start_local IS NOT NULL
      AND end_local IS NOT NULL
      AND isfinite(start_local)
      AND isfinite(end_local)
      AND time_zone IS NOT NULL
      AND length(btrim(time_zone)) > 0
      AND starts_at IS NOT NULL
      AND ends_at IS NOT NULL
      AND isfinite(starts_at)
      AND isfinite(ends_at)
      AND ends_at > starts_at
      AND start_disambiguation IS NOT NULL
      AND end_disambiguation IS NOT NULL
      AND start_gap_strategy IS NOT NULL
      AND start_gap_strategy = 'next-valid'
      AND end_gap_strategy IS NOT NULL
      AND end_gap_strategy = 'next-valid'
    )
  )
);

CREATE INDEX calendar_event_owner_timed_start_idx
  ON public.calendar_event (owner_user_id, starts_at)
  WHERE temporal_kind <> 'all_day' AND deleted_at IS NULL;

CREATE INDEX calendar_event_owner_all_day_start_idx
  ON public.calendar_event (owner_user_id, start_date)
  WHERE temporal_kind = 'all_day' AND deleted_at IS NULL;

CREATE INDEX calendar_event_owner_lifecycle_idx
  ON public.calendar_event (owner_user_id, archived_at, deleted_at);

ALTER TABLE public.calendar_event ENABLE ROW LEVEL SECURITY;

CREATE POLICY calendar_event_read_self
  ON public.calendar_event
  FOR SELECT
  TO authenticated
  USING (
    owner_user_id IN (
      SELECT id
      FROM public.user_profile
      WHERE auth_user_id = (SELECT auth.uid())
    )
  );

-- Deliberate object-level permissions. No client DELETE/TRUNCATE and no anon access.
REVOKE ALL PRIVILEGES ON TABLE public.calendar_event
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.calendar_event TO authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.calendar_event TO service_role;

-- Remove service_role's legacy residual Dxtm privileges on the append-only audit table.
-- Preserve authenticated owner-scoped SELECT and the existing immutability trigger.
REVOKE ALL PRIVILEGES ON TABLE public.audit_event
  FROM PUBLIC, anon, service_role;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN
  ON TABLE public.audit_event FROM authenticated;
GRANT SELECT ON TABLE public.audit_event TO authenticated;

CREATE OR REPLACE FUNCTION private.append_calendar_event_audit()
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
    RAISE EXCEPTION 'Phase 1 Event owner and actor fields must match the verified owner';
  END IF;

  IF TG_OP = 'INSERT' THEN
    v_details := jsonb_build_object(
      'changed_fields', to_jsonb(ARRAY['created']::text[]),
      'event_status_after', NEW.event_status,
      'lifecycle_after', CASE
        WHEN NEW.deleted_at IS NOT NULL THEN 'trash'
        WHEN NEW.archived_at IS NOT NULL THEN 'archived'
        ELSE 'active'
      END
    );

    INSERT INTO public.audit_event (
      id, account_user_id, actor_user_id, action, entity_type, entity_id,
      result, source, details, occurred_at, recorded_at
    ) VALUES (
      private.uuidv7(), NEW.owner_user_id, NEW.updated_by_user_id,
      'calendar_event.created', 'calendar_event', NEW.id,
      'success', 'user', v_details, clock_timestamp(), clock_timestamp()
    );

    RETURN NEW;
  END IF;

  IF TG_OP <> 'UPDATE' THEN
    RAISE EXCEPTION 'Unsupported calendar_event audit operation: %', TG_OP;
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.owner_user_id IS DISTINCT FROM OLD.owner_user_id
     OR NEW.created_by_user_id IS DISTINCT FROM OLD.created_by_user_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Calendar Event identity, owner, creator and creation time are immutable';
  END IF;

  IF NEW.title IS DISTINCT FROM OLD.title THEN
    v_changed_fields := array_append(v_changed_fields, 'title');
  END IF;
  IF NEW.description IS DISTINCT FROM OLD.description THEN
    v_changed_fields := array_append(v_changed_fields, 'description');
  END IF;
  IF NEW.location_label IS DISTINCT FROM OLD.location_label THEN
    v_changed_fields := array_append(v_changed_fields, 'location_label');
  END IF;
  IF NEW.location_kind IS DISTINCT FROM OLD.location_kind THEN
    v_changed_fields := array_append(v_changed_fields, 'location_kind');
  END IF;
  IF NEW.event_status IS DISTINCT FROM OLD.event_status THEN
    v_changed_fields := array_append(v_changed_fields, 'event_status');
  END IF;
  IF NEW.temporal_kind IS DISTINCT FROM OLD.temporal_kind THEN
    v_changed_fields := array_append(v_changed_fields, 'temporal_kind');
  END IF;
  IF NEW.start_date IS DISTINCT FROM OLD.start_date THEN
    v_changed_fields := array_append(v_changed_fields, 'start_date');
  END IF;
  IF NEW.end_date_exclusive IS DISTINCT FROM OLD.end_date_exclusive THEN
    v_changed_fields := array_append(v_changed_fields, 'end_date_exclusive');
  END IF;
  IF NEW.start_local IS DISTINCT FROM OLD.start_local THEN
    v_changed_fields := array_append(v_changed_fields, 'start_local');
  END IF;
  IF NEW.end_local IS DISTINCT FROM OLD.end_local THEN
    v_changed_fields := array_append(v_changed_fields, 'end_local');
  END IF;
  IF NEW.time_zone IS DISTINCT FROM OLD.time_zone THEN
    v_changed_fields := array_append(v_changed_fields, 'time_zone');
  END IF;
  IF NEW.starts_at IS DISTINCT FROM OLD.starts_at THEN
    v_changed_fields := array_append(v_changed_fields, 'starts_at');
  END IF;
  IF NEW.ends_at IS DISTINCT FROM OLD.ends_at THEN
    v_changed_fields := array_append(v_changed_fields, 'ends_at');
  END IF;
  IF NEW.start_disambiguation IS DISTINCT FROM OLD.start_disambiguation THEN
    v_changed_fields := array_append(v_changed_fields, 'start_disambiguation');
  END IF;
  IF NEW.end_disambiguation IS DISTINCT FROM OLD.end_disambiguation THEN
    v_changed_fields := array_append(v_changed_fields, 'end_disambiguation');
  END IF;
  IF NEW.start_gap_strategy IS DISTINCT FROM OLD.start_gap_strategy THEN
    v_changed_fields := array_append(v_changed_fields, 'start_gap_strategy');
  END IF;
  IF NEW.end_gap_strategy IS DISTINCT FROM OLD.end_gap_strategy THEN
    v_changed_fields := array_append(v_changed_fields, 'end_gap_strategy');
  END IF;
  IF NEW.archived_at IS DISTINCT FROM OLD.archived_at THEN
    v_changed_fields := array_append(v_changed_fields, 'archived_at');
  END IF;
  IF NEW.deleted_at IS DISTINCT FROM OLD.deleted_at THEN
    v_changed_fields := array_append(v_changed_fields, 'deleted_at');
  END IF;
  IF NEW.purge_after IS DISTINCT FROM OLD.purge_after THEN
    v_changed_fields := array_append(v_changed_fields, 'purge_after');
  END IF;

  -- An updated_at-only touch or a no-op is not a business mutation.
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
    'event_status_before', OLD.event_status,
    'event_status_after', NEW.event_status,
    'lifecycle_before', v_lifecycle_before,
    'lifecycle_after', v_lifecycle_after
  );

  INSERT INTO public.audit_event (
    id, account_user_id, actor_user_id, action, entity_type, entity_id,
    result, source, details, occurred_at, recorded_at
  ) VALUES (
    private.uuidv7(), NEW.owner_user_id, NEW.updated_by_user_id,
    'calendar_event.updated', 'calendar_event', NEW.id,
    'success', 'user', v_details, clock_timestamp(), clock_timestamp()
  );

  RETURN NEW;
END;
$function$;

ALTER FUNCTION private.append_calendar_event_audit() OWNER TO postgres;
REVOKE ALL PRIVILEGES ON FUNCTION private.append_calendar_event_audit()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER calendar_event_touch_updated_at
  BEFORE UPDATE ON public.calendar_event
  FOR EACH ROW EXECUTE FUNCTION private.touch_updated_at();

CREATE TRIGGER calendar_event_audit_append
  AFTER INSERT OR UPDATE ON public.calendar_event
  FOR EACH ROW EXECUTE FUNCTION private.append_calendar_event_audit();
