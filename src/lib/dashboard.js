const isVisible = (row) => row && !row.deleted_at && !row.archived_at;
const isCountableTask = (task) => task && !task.deleted_at && task.status !== 'cancelled'
  && (!task.archived_at || task.status === 'completed');
const isOpen = (task) => isVisible(task) && !['completed', 'cancelled'].includes(task.status);

function shiftDateKey(value, days) {
  const [year, month, day] = String(value || '').split('-').map(Number);
  if (!year || !month || !day) return '';
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return [date.getUTCFullYear(), String(date.getUTCMonth() + 1).padStart(2, '0'), String(date.getUTCDate()).padStart(2, '0')].join('-');
}

function dateKeyInHavana(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Havana', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(date);
}

function calculateProgress(entity, linkedTaskIds, taskById, kind) {
  const tasksForEntity = [...new Set(linkedTaskIds)]
    .map((id) => taskById.get(id))
    .filter(isCountableTask);
  const completedTasks = tasksForEntity.filter((task) => task.status === 'completed').length;
  const blockedTasks = tasksForEntity.filter((task) => isOpen(task) && task.status === 'blocked').length;
  return {
    id: entity.id,
    title: kind === 'project' ? entity.name : entity.title,
    targetDate: entity.target_date || null,
    totalTasks: tasksForEntity.length,
    completedTasks,
    blockedTasks,
    progress: tasksForEntity.length ? Math.round((completedTasks / tasksForEntity.length) * 100) : null,
  };
}

/**
 * Derives a lightweight daily dashboard from existing records only.
 * Progress is evidence-based: completed linked tasks / countable linked tasks.
 */
export function buildDashboardSnapshot({
  tasks = [],
  goals = [],
  subgoals = [],
  projects = [],
  contributionRelations = [],
  taskProjectLinks = [],
  today,
}) {
  const allTasks = tasks.filter((task) => task && !task.deleted_at);
  const openTasks = allTasks.filter(isOpen);
  const overdue = openTasks.filter((task) => task.due_date && task.due_date < today)
    .sort((a, b) => a.due_date.localeCompare(b.due_date) || Number(a.priority || 3) - Number(b.priority || 3));
  const dueToday = openTasks.filter((task) => task.due_date === today)
    .sort((a, b) => Number(a.priority || 3) - Number(b.priority || 3) || String(a.action).localeCompare(String(b.action)));
  const nextTasks = openTasks.filter((task) => !task.due_date || task.due_date > today)
    .sort((a, b) => {
      if (!a.due_date && b.due_date) return 1;
      if (a.due_date && !b.due_date) return -1;
      return String(a.due_date || '').localeCompare(String(b.due_date || ''))
        || Number(a.priority || 3) - Number(b.priority || 3);
    }).slice(0, 6);
  const blockedTasks = openTasks.filter((task) => task.status === 'blocked')
    .sort((a, b) => Number(a.priority || 3) - Number(b.priority || 3));
  const estimatedTodayTasks = dueToday.filter((task) => Number(task.estimated_duration_minutes) > 0);
  const completedSince = shiftDateKey(today, -6);
  const completedThisWeek = allTasks.filter((task) => task.status === 'completed' && task.completed_at)
    .filter((task) => {
      const completedDate = dateKeyInHavana(task.completed_at);
      return completedDate >= completedSince && completedDate <= today;
    }).length;

  const activeGoals = goals.filter((goal) => isVisible(goal) && goal.status === 'active');
  const activeSubgoals = subgoals.filter((subgoal) => subgoal && !subgoal.deleted_at);
  const goalProgress = activeGoals.map((goal) => {
    const childIds = new Set(activeSubgoals.filter((subgoal) => subgoal.goal_id === goal.id).map((subgoal) => subgoal.id));
    const taskIds = contributionRelations
      .filter((relation) => relation.relation_status === 'confirmed'
        && (relation.goal_id === goal.id || childIds.has(relation.subgoal_id)))
      .map((relation) => relation.task_id);
    return calculateProgress(goal, taskIds, new Map(allTasks.map((task) => [task.id, task])), 'goal');
  }).sort((a, b) => {
    if (a.targetDate && b.targetDate) return a.targetDate.localeCompare(b.targetDate);
    if (a.targetDate) return -1;
    if (b.targetDate) return 1;
    return a.title.localeCompare(b.title);
  });

  const activeProjects = projects.filter((project) => isVisible(project) && ['planning', 'active'].includes(project.status));
  const taskById = new Map(allTasks.map((task) => [task.id, task]));
  const projectProgress = activeProjects.map((project) => {
    const taskIds = taskProjectLinks.filter((link) => link.project_id === project.id).map((link) => link.task_id);
    return calculateProgress(project, taskIds, taskById, 'project');
  }).sort((a, b) => {
    if (a.targetDate && b.targetDate) return a.targetDate.localeCompare(b.targetDate);
    if (a.targetDate) return -1;
    if (b.targetDate) return 1;
    return a.title.localeCompare(b.title);
  });

  const nextWeek = shiftDateKey(today, 7);
  const milestones = [
    ...activeGoals.filter((goal) => goal.target_date && goal.target_date <= nextWeek && goal.status === 'active')
      .map((goal) => ({ id: `goal-${goal.id}`, title: goal.title, kind: 'Meta', targetDate: goal.target_date })),
    ...activeProjects.filter((project) => project.target_date && project.target_date <= nextWeek)
      .map((project) => ({ id: `project-${project.id}`, title: project.name, kind: 'Proyecto', targetDate: project.target_date })),
  ].map((item) => ({ ...item, isOverdue: item.targetDate < today }))
    .sort((a, b) => a.targetDate.localeCompare(b.targetDate) || a.title.localeCompare(b.title));

  return {
    openTasks,
    overdue,
    dueToday,
    nextTasks,
    blockedTasks,
    estimatedTodayMinutes: estimatedTodayTasks.reduce((total, task) => total + (Number(task.estimated_duration_minutes) || 0), 0),
    estimatedTodayCount: estimatedTodayTasks.length,
    completedThisWeek,
    goalProgress,
    projectProgress,
    milestones,
  };
}
