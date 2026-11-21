
REVOKE UPDATE ON public.user_profile, public.user_preference, public.life_area, public.goal,
 public.subgoal, public.project, public.task, public.task_project_link, public.contribution_relation,
 public.capture, public.capture_part, public.note_idea, public.user_list, public.list_item, public.capture_link
FROM authenticated;

GRANT UPDATE (display_name) ON public.user_profile TO authenticated;
GRANT UPDATE (time_zone, language, preferences) ON public.user_preference TO authenticated;
GRANT UPDATE (title, description, position, status, archived_at, deleted_at, purge_after)
 ON public.life_area TO authenticated;
GRANT UPDATE (life_area_id, title, expected_result, reason, target_date, status, archived_at, deleted_at, purge_after)
 ON public.goal TO authenticated;
GRANT UPDATE (title, expected_result, target_date, status, archived_at, deleted_at, purge_after)
 ON public.subgoal TO authenticated;
GRANT UPDATE (name, purpose, status, start_date, target_date, archived_at, deleted_at, purge_after)
 ON public.project TO authenticated;
GRANT UPDATE (assignee_user_id, action, description, status, priority, due_date, due_at, time_zone,
 estimated_duration_minutes, completed_at, completion_outcome, archived_at, deleted_at, purge_after)
 ON public.task TO authenticated;
GRANT UPDATE (relation_role) ON public.task_project_link TO authenticated;
GRANT UPDATE (relation_status) ON public.contribution_relation TO authenticated;
GRANT UPDATE (attention_status) ON public.capture TO authenticated;
GRANT UPDATE (interpretation, category, review_status) ON public.capture_part TO authenticated;
GRANT UPDATE (kind, title, content, status, archived_at, deleted_at, purge_after) ON public.note_idea TO authenticated;
GRANT UPDATE (name, purpose, status, archived_at, deleted_at, purge_after) ON public.user_list TO authenticated;
GRANT UPDATE (task_id, content, position, is_checked) ON public.list_item TO authenticated;
GRANT UPDATE (link_status, confidence) ON public.capture_link TO authenticated;
