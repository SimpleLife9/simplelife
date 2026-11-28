-- Enable Inbox provenance links to the Agenda's owner-scoped calendar_event domain.
ALTER TABLE public.capture_link
  ADD COLUMN calendar_event_id uuid REFERENCES public.calendar_event(id) ON DELETE RESTRICT;

DO $migration$
DECLARE v_constraint text;
BEGIN
  SELECT c.conname INTO v_constraint
  FROM pg_constraint c
  WHERE c.conrelid = 'public.capture_link'::regclass
    AND c.contype = 'c'
    AND pg_get_constraintdef(c.oid) LIKE '%num_nonnulls%';
  IF v_constraint IS NULL THEN
    RAISE EXCEPTION 'Could not find capture_link single-target constraint';
  END IF;
  EXECUTE format('ALTER TABLE public.capture_link DROP CONSTRAINT %I', v_constraint);
END;
$migration$;

ALTER TABLE public.capture_link
  ADD CONSTRAINT capture_link_exactly_one_target_check
  CHECK (num_nonnulls(task_id, goal_id, subgoal_id, project_id, note_idea_id, user_list_id, list_item_id, calendar_event_id) = 1)
  NOT VALID;
ALTER TABLE public.capture_link VALIDATE CONSTRAINT capture_link_exactly_one_target_check;
CREATE INDEX capture_link_calendar_event_id_idx
  ON public.capture_link(calendar_event_id) WHERE calendar_event_id IS NOT NULL;

-- The Inbox UI supports one confirmed destination per source fragment.
-- Suggested/rejected alternatives may remain, but concurrent confirmations
-- must serialize through this database invariant.
CREATE UNIQUE INDEX capture_link_one_confirmed_per_part_uq
  ON public.capture_link(capture_part_id)
  WHERE link_status = 'confirmed';

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
);

