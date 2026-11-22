-- Give accepted Event state/lifecycle transitions explicit audit actions.
-- The row trigger remains the only audit writer; trigger append and Event update
-- still commit or roll back together in the same PostgreSQL transaction.

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
  v_action text := 'calendar_event.updated';
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

  IF NEW.event_status IS DISTINCT FROM OLD.event_status THEN
    IF NEW.event_status = 'cancelled' THEN
      v_action := 'calendar_event.cancelled';
    ELSIF OLD.event_status = 'cancelled' AND NEW.event_status = 'confirmed' THEN
      v_action := 'calendar_event.reopened';
    ELSIF NEW.event_status = 'finished' THEN
      v_action := 'calendar_event.finished';
    ELSE
      v_action := 'calendar_event.updated';
    END IF;
  ELSIF v_lifecycle_before IS DISTINCT FROM v_lifecycle_after THEN
    IF v_lifecycle_after = 'archived' THEN
      v_action := 'calendar_event.archived';
    ELSIF v_lifecycle_after = 'trash' THEN
      v_action := 'calendar_event.trashed';
    ELSIF v_lifecycle_before IN ('archived', 'trash') AND v_lifecycle_after = 'active' THEN
      v_action := 'calendar_event.restored';
    END IF;
  END IF;

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
    v_action, 'calendar_event', NEW.id,
    'success', 'user', v_details, clock_timestamp(), clock_timestamp()
  );

  RETURN NEW;
END;
$function$;

ALTER FUNCTION private.append_calendar_event_audit() OWNER TO postgres;
REVOKE ALL PRIVILEGES ON FUNCTION private.append_calendar_event_audit()
  FROM PUBLIC, anon, authenticated, service_role;

