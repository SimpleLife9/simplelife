
CREATE OR REPLACE FUNCTION private.touch_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$;
CREATE OR REPLACE FUNCTION private.reject_audit_mutation()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN RAISE EXCEPTION 'audit_event is append-only' USING ERRCODE='55000'; END $$;

DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['user_profile','user_preference','life_area','goal','subgoal','project','task','task_project_link','contribution_relation','capture','capture_part','processing_run','note_idea','user_list','list_item','capture_link']
 LOOP EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION private.touch_updated_at()',t||'_touch',t); END LOOP;
END $$;
CREATE TRIGGER audit_event_immutable BEFORE UPDATE OR DELETE ON public.audit_event FOR EACH ROW EXECUTE FUNCTION private.reject_audit_mutation();

CREATE POLICY profile_self ON public.user_profile FOR ALL TO authenticated
 USING(auth_user_id=(SELECT auth.uid())) WITH CHECK(auth_user_id=(SELECT auth.uid()));
CREATE POLICY preference_self ON public.user_preference FOR ALL TO authenticated
 USING(user_id IN (SELECT id FROM public.user_profile WHERE auth_user_id=(SELECT auth.uid())))
 WITH CHECK(user_id IN (SELECT id FROM public.user_profile WHERE auth_user_id=(SELECT auth.uid())));
CREATE POLICY life_area_self ON public.life_area FOR ALL TO authenticated
 USING(owner_user_id IN (SELECT id FROM public.user_profile WHERE auth_user_id=(SELECT auth.uid())))
 WITH CHECK(owner_user_id IN (SELECT id FROM public.user_profile WHERE auth_user_id=(SELECT auth.uid()))
 AND created_by_user_id IN (SELECT id FROM public.user_profile WHERE auth_user_id=(SELECT auth.uid())));
CREATE POLICY goal_self ON public.goal FOR ALL TO authenticated
 USING(owner_user_id IN (SELECT id FROM public.user_profile WHERE auth_user_id=(SELECT auth.uid())))
 WITH CHECK(owner_user_id IN (SELECT id FROM public.user_profile WHERE auth_user_id=(SELECT auth.uid()))
 AND created_by_user_id IN (SELECT id FROM public.user_profile WHERE auth_user_id=(SELECT auth.uid())));
CREATE POLICY subgoal_self ON public.subgoal FOR ALL TO authenticated
 USING(EXISTS(SELECT 1 FROM public.goal g WHERE g.id=goal_id))
 WITH CHECK(created_by_user_id IN (SELECT id FROM public.user_profile WHERE auth_user_id=(SELECT auth.uid()))
 AND EXISTS(SELECT 1 FROM public.goal g WHERE g.id=goal_id));
CREATE POLICY project_self ON public.project FOR ALL TO authenticated
 USING(owner_user_id IN (SELECT id FROM public.user_profile WHERE auth_user_id=(SELECT auth.uid())))
 WITH CHECK(owner_user_id IN (SELECT id FROM public.user_profile WHERE auth_user_id=(SELECT auth.uid()))
 AND created_by_user_id IN (SELECT id FROM public.user_profile WHERE auth_user_id=(SELECT auth.uid())));
CREATE POLICY task_self ON public.task FOR ALL TO authenticated
 USING(owner_user_id IN (SELECT id FROM public.user_profile WHERE auth_user_id=(SELECT auth.uid())))
 WITH CHECK(owner_user_id IN (SELECT id FROM public.user_profile WHERE auth_user_id=(SELECT auth.uid()))
 AND created_by_user_id IN (SELECT id FROM public.user_profile WHERE auth_user_id=(SELECT auth.uid()))
 AND (assignee_user_id IS NULL OR assignee_user_id=owner_user_id));
CREATE POLICY task_project_link_self ON public.task_project_link FOR ALL TO authenticated
 USING(EXISTS(SELECT 1 FROM public.task t WHERE t.id=task_id) AND EXISTS(SELECT 1 FROM public.project p WHERE p.id=project_id))
 WITH CHECK(created_by_user_id IN (SELECT id FROM public.user_profile WHERE auth_user_id=(SELECT auth.uid()))
 AND EXISTS(SELECT 1 FROM public.task t WHERE t.id=task_id) AND EXISTS(SELECT 1 FROM public.project p WHERE p.id=project_id));
CREATE POLICY contribution_self ON public.contribution_relation FOR ALL TO authenticated
 USING(
  ((project_id IS NOT NULL AND EXISTS(SELECT 1 FROM public.project p WHERE p.id=project_id))
   OR (task_id IS NOT NULL AND EXISTS(SELECT 1 FROM public.task t WHERE t.id=task_id)))
  AND
  ((goal_id IS NOT NULL AND EXISTS(SELECT 1 FROM public.goal g WHERE g.id=goal_id))
   OR (subgoal_id IS NOT NULL AND EXISTS(SELECT 1 FROM public.subgoal s WHERE s.id=subgoal_id)))
 )
 WITH CHECK(
  created_by_user_id IN (SELECT id FROM public.user_profile WHERE auth_user_id=(SELECT auth.uid()))
  AND ((project_id IS NOT NULL AND EXISTS(SELECT 1 FROM public.project p WHERE p.id=project_id))
   OR (task_id IS NOT NULL AND EXISTS(SELECT 1 FROM public.task t WHERE t.id=task_id)))
  AND ((goal_id IS NOT NULL AND EXISTS(SELECT 1 FROM public.goal g WHERE g.id=goal_id))
   OR (subgoal_id IS NOT NULL AND EXISTS(SELECT 1 FROM public.subgoal s WHERE s.id=subgoal_id)))
 );
CREATE POLICY capture_self ON public.capture FOR ALL TO authenticated
 USING(owner_user_id IN (SELECT id FROM public.user_profile WHERE auth_user_id=(SELECT auth.uid())))
 WITH CHECK(owner_user_id IN (SELECT id FROM public.user_profile WHERE auth_user_id=(SELECT auth.uid()))
 AND created_by_user_id IN (SELECT id FROM public.user_profile WHERE auth_user_id=(SELECT auth.uid())));
CREATE POLICY capture_part_self ON public.capture_part FOR ALL TO authenticated
 USING(EXISTS(SELECT 1 FROM public.capture c WHERE c.id=capture_id))
 WITH CHECK(EXISTS(SELECT 1 FROM public.capture c WHERE c.id=capture_id));
CREATE POLICY processing_run_read_self ON public.processing_run FOR SELECT TO authenticated
 USING(EXISTS(SELECT 1 FROM public.capture c WHERE c.id=capture_id));
CREATE POLICY note_idea_self ON public.note_idea FOR ALL TO authenticated
 USING(owner_user_id IN (SELECT id FROM public.user_profile WHERE auth_user_id=(SELECT auth.uid())))
 WITH CHECK(owner_user_id IN (SELECT id FROM public.user_profile WHERE auth_user_id=(SELECT auth.uid()))
 AND created_by_user_id IN (SELECT id FROM public.user_profile WHERE auth_user_id=(SELECT auth.uid())));
CREATE POLICY user_list_self ON public.user_list FOR ALL TO authenticated
 USING(owner_user_id IN (SELECT id FROM public.user_profile WHERE auth_user_id=(SELECT auth.uid())))
 WITH CHECK(owner_user_id IN (SELECT id FROM public.user_profile WHERE auth_user_id=(SELECT auth.uid()))
 AND created_by_user_id IN (SELECT id FROM public.user_profile WHERE auth_user_id=(SELECT auth.uid())));
CREATE POLICY list_item_self ON public.list_item FOR ALL TO authenticated
 USING(EXISTS(SELECT 1 FROM public.user_list l WHERE l.id=list_id) AND (task_id IS NULL OR EXISTS(SELECT 1 FROM public.task t WHERE t.id=task_id)))
 WITH CHECK(EXISTS(SELECT 1 FROM public.user_list l WHERE l.id=list_id) AND (task_id IS NULL OR EXISTS(SELECT 1 FROM public.task t WHERE t.id=task_id)));
CREATE POLICY capture_link_self ON public.capture_link FOR ALL TO authenticated
 USING(
  EXISTS(SELECT 1 FROM public.capture_part cp WHERE cp.id=capture_part_id)
  AND ((task_id IS NOT NULL AND EXISTS(SELECT 1 FROM public.task t WHERE t.id=task_id))
   OR (goal_id IS NOT NULL AND EXISTS(SELECT 1 FROM public.goal g WHERE g.id=goal_id))
   OR (subgoal_id IS NOT NULL AND EXISTS(SELECT 1 FROM public.subgoal s WHERE s.id=subgoal_id))
   OR (project_id IS NOT NULL AND EXISTS(SELECT 1 FROM public.project p WHERE p.id=project_id))
   OR (note_idea_id IS NOT NULL AND EXISTS(SELECT 1 FROM public.note_idea n WHERE n.id=note_idea_id))
   OR (user_list_id IS NOT NULL AND EXISTS(SELECT 1 FROM public.user_list l WHERE l.id=user_list_id))
   OR (list_item_id IS NOT NULL AND EXISTS(SELECT 1 FROM public.list_item li WHERE li.id=list_item_id))
  )
 )
 WITH CHECK(
  EXISTS(SELECT 1 FROM public.capture_part cp WHERE cp.id=capture_part_id)
  AND ((task_id IS NOT NULL AND EXISTS(SELECT 1 FROM public.task t WHERE t.id=task_id))
   OR (goal_id IS NOT NULL AND EXISTS(SELECT 1 FROM public.goal g WHERE g.id=goal_id))
   OR (subgoal_id IS NOT NULL AND EXISTS(SELECT 1 FROM public.subgoal s WHERE s.id=subgoal_id))
   OR (project_id IS NOT NULL AND EXISTS(SELECT 1 FROM public.project p WHERE p.id=project_id))
   OR (note_idea_id IS NOT NULL AND EXISTS(SELECT 1 FROM public.note_idea n WHERE n.id=note_idea_id))
   OR (user_list_id IS NOT NULL AND EXISTS(SELECT 1 FROM public.user_list l WHERE l.id=user_list_id))
   OR (list_item_id IS NOT NULL AND EXISTS(SELECT 1 FROM public.list_item li WHERE li.id=list_item_id))
  )
 );
CREATE POLICY audit_read_self ON public.audit_event FOR SELECT TO authenticated
 USING(account_user_id IN (SELECT id FROM public.user_profile WHERE auth_user_id=(SELECT auth.uid())));

GRANT USAGE ON SCHEMA public TO authenticated;
GRANT SELECT,INSERT,UPDATE ON public.user_profile,public.user_preference,public.life_area,public.goal,public.subgoal,
 public.project,public.task,public.task_project_link,public.contribution_relation,public.capture,public.capture_part,
 public.note_idea,public.user_list,public.list_item,public.capture_link TO authenticated;
GRANT SELECT ON public.processing_run,public.audit_event TO authenticated;
REVOKE DELETE ON ALL TABLES IN SCHEMA public FROM PUBLIC,anon,authenticated;
