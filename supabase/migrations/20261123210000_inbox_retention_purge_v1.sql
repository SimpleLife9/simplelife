-- Purge expired Inbox captures after their 30-day recovery window.
-- Server-only, bounded, audited, and safe against live worker leases / restore races.

GRANT SELECT, DELETE ON TABLE public.processing_run TO service_role;
GRANT SELECT, DELETE ON TABLE public.capture_part TO service_role;
GRANT SELECT, DELETE ON TABLE public.capture_link TO service_role;
GRANT SELECT, DELETE ON TABLE public.capture TO service_role;
GRANT INSERT ON TABLE public.audit_event TO service_role;

-- Keep trash content readable/restorable, but do not allow new parts or provenance
-- links to be attached to a trashed capture.
DROP POLICY capture_part_self ON public.capture_part;
CREATE POLICY capture_part_self ON public.capture_part FOR ALL TO authenticated
USING (EXISTS (SELECT 1 FROM public.capture c WHERE c.id = capture_id))
WITH CHECK (EXISTS (
  SELECT 1 FROM public.capture c WHERE c.id = capture_id AND c.deleted_at IS NULL
));

DROP POLICY capture_link_self ON public.capture_link;
CREATE POLICY capture_link_self ON public.capture_link FOR ALL TO authenticated
USING (
  EXISTS (SELECT 1 FROM public.capture_part cp WHERE cp.id = capture_part_id)
  AND (
    (task_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.task t WHERE t.id = task_id))
    OR (goal_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.goal g WHERE g.id = goal_id))
    OR (subgoal_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.subgoal s WHERE s.id = subgoal_id))
    OR (project_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.project p WHERE p.id = project_id))
    OR (note_idea_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.note_idea n WHERE n.id = note_idea_id))
    OR (user_list_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.user_list l WHERE l.id = user_list_id))
    OR (list_item_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.list_item li WHERE li.id = list_item_id))
    OR (calendar_event_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.calendar_event e WHERE e.id = calendar_event_id))
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.capture_part cp
    JOIN public.capture c ON c.id = cp.capture_id
    WHERE cp.id = capture_part_id AND c.deleted_at IS NULL
  )
  AND (
    (task_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.task t WHERE t.id = task_id))
    OR (goal_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.goal g WHERE g.id = goal_id))
    OR (subgoal_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.subgoal s WHERE s.id = subgoal_id))
    OR (project_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.project p WHERE p.id = project_id))
    OR (note_idea_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.note_idea n WHERE n.id = note_idea_id))
    OR (user_list_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.user_list l WHERE l.id = user_list_id))
    OR (list_item_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.list_item li WHERE li.id = list_item_id))
    OR (calendar_event_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.calendar_event e WHERE e.id = calendar_event_id))
  )
);

CREATE OR REPLACE FUNCTION public.purge_expired_inbox_captures(
  p_batch_size integer,
  p_audit_ids uuid[]
)
RETURNS TABLE(purged_count integer, purged_capture_ids uuid[])
LANGUAGE plpgsql VOLATILE SECURITY INVOKER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_candidate record;
  v_capture public.capture%ROWTYPE;
  v_index integer := 0;
  v_rows integer;
  v_purged_ids uuid[] := ARRAY[]::uuid[];
BEGIN
  IF current_user <> 'service_role' THEN
    RAISE EXCEPTION 'Inbox retention purge requires service_role' USING ERRCODE = '42501';
  END IF;
  IF p_batch_size IS NULL OR p_batch_size NOT BETWEEN 1 AND 100
     OR p_audit_ids IS NULL OR cardinality(p_audit_ids) < p_batch_size THEN
    RAISE EXCEPTION 'A purge batch between 1 and 100 and matching audit IDs are required'
      USING ERRCODE = '22023';
  END IF;

  FOR v_index IN 1..p_batch_size LOOP
    IF p_audit_ids[v_index] IS NULL
       OR (get_byte(uuid_send(p_audit_ids[v_index]), 6) >> 4) <> 7
       OR (get_byte(uuid_send(p_audit_ids[v_index]), 8) & 192) <> 128 THEN
      RAISE EXCEPTION 'Every purge audit ID must be a valid UUIDv7' USING ERRCODE = '22023';
    END IF;
  END LOOP;
  IF (SELECT count(DISTINCT audit_id) FROM unnest(p_audit_ids[1:p_batch_size]) AS item(audit_id))
     <> p_batch_size THEN
    RAISE EXCEPTION 'Purge audit IDs must be unique' USING ERRCODE = '22023';
  END IF;

  v_index := 0;
  FOR v_candidate IN
    SELECT c.id
    FROM public.capture c
    WHERE c.deleted_at IS NOT NULL
      AND c.purge_after IS NOT NULL
      AND c.purge_after <= v_now
      AND NOT EXISTS (
        SELECT 1 FROM public.processing_run active_run
        WHERE active_run.capture_id = c.id
          AND active_run.status = 'running'
          AND active_run.lease_expires_at > v_now
      )
    ORDER BY c.purge_after, c.id
    LIMIT p_batch_size
  LOOP
    -- Match the worker lock order: processing_run first, capture second.
    -- NOWAIT avoids deadlocks with a worker finishing under its lease.
    BEGIN
      PERFORM 1
      FROM public.processing_run pr
      WHERE pr.capture_id = v_candidate.id
      ORDER BY pr.id
      FOR UPDATE NOWAIT;
    EXCEPTION WHEN lock_not_available THEN
      CONTINUE;
    END;

    SELECT c.* INTO v_capture
    FROM public.capture c
    WHERE c.id = v_candidate.id
      AND c.deleted_at IS NOT NULL
      AND c.purge_after <= v_now
    FOR UPDATE SKIP LOCKED;
    IF NOT FOUND THEN CONTINUE; END IF;

    -- A previously claimed worker may still own a non-expired lease.
    IF EXISTS (
      SELECT 1 FROM public.processing_run pr
      WHERE pr.capture_id = v_capture.id
        AND pr.status = 'running'
        AND pr.lease_expires_at > v_now
    ) THEN
      CONTINUE;
    END IF;

    INSERT INTO public.audit_event (
      id, account_user_id, actor_user_id, action, entity_type, entity_id,
      result, source, details, occurred_at, recorded_at
    ) VALUES (
      p_audit_ids[v_index + 1], v_capture.owner_user_id, NULL,
      'capture.purged', 'capture', v_capture.id,
      'success', 'system',
      jsonb_build_object('retention_days',30,'content_removed',true),
      v_now, v_now
    );

    DELETE FROM public.capture_link cl
    USING public.capture_part cp
    WHERE cl.capture_part_id = cp.id
      AND cp.capture_id = v_capture.id;

    DELETE FROM public.processing_run pr
    WHERE pr.capture_id = v_capture.id;

    DELETE FROM public.capture_part cp
    WHERE cp.capture_id = v_capture.id;

    DELETE FROM public.capture c
    WHERE c.id = v_capture.id
      AND c.deleted_at IS NOT NULL
      AND c.purge_after <= v_now;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows <> 1 THEN
      RAISE EXCEPTION 'Expired Inbox capture changed while being purged'
        USING ERRCODE = '40001';
    END IF;

    v_purged_ids := array_append(v_purged_ids, v_capture.id);
    v_index := v_index + 1;
  END LOOP;

  RETURN QUERY SELECT v_index, v_purged_ids;
END;
$function$;

ALTER FUNCTION public.purge_expired_inbox_captures(integer, uuid[]) OWNER TO postgres;
REVOKE ALL PRIVILEGES ON FUNCTION public.purge_expired_inbox_captures(integer, uuid[])
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.purge_expired_inbox_captures(integer, uuid[])
  TO service_role;
