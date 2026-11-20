import { useMemo } from 'react';
import { supabase } from '../../lib/supabase.js';
import { buildDashboardSnapshot } from '../../lib/dashboard.js';
import { todayInHavana, formatDate, formatDuration } from '../../lib/date-time.js';
import { useRows } from '../../shared/hooks/useRows.js';
import { TaskRow } from './components/TaskRow.jsx';
import { SectionTitle } from '../../shared/components/SectionTitle.jsx';
import { EmptyState } from '../../shared/components/EmptyState.jsx';
import { completeTodayTask, rescheduleTodayTask } from './services/today-tasks.js';

function TodayPage({ profile, refreshKey, runAction, busy, setActivePage, setMorePage }) {
  const { rows: tasks, loading, localError } = useRows('task', profile, refreshKey, (query) => query
    .is('deleted_at', null)
    .order('priority', { ascending: true }).order('created_at', { ascending: false }));
  const { rows: goals, loading: goalsLoading, localError: goalsError } = useRows('goal', profile, refreshKey, (query) => query.is('deleted_at', null));
  const { rows: subgoals, loading: subgoalsLoading, localError: subgoalsError } = useRows('subgoal', profile, refreshKey, (query) => query.is('deleted_at', null));
  const { rows: projects, loading: projectsLoading, localError: projectsError } = useRows('project', profile, refreshKey, (query) => query.is('deleted_at', null));
  const { rows: contributionRelations, loading: relationsLoading, localError: relationsError } = useRows('contribution_relation', profile, refreshKey);
  const { rows: taskProjectLinks, loading: projectLinksLoading, localError: projectLinksError } = useRows('task_project_link', profile, refreshKey);
  const today = todayInHavana();
  const snapshot = useMemo(() => buildDashboardSnapshot({
    tasks, goals, subgoals, projects, contributionRelations, taskProjectLinks, today,
  }), [tasks, goals, subgoals, projects, contributionRelations, taskProjectLinks, today]);
  const insightLoading = goalsLoading || subgoalsLoading || projectsLoading || relationsLoading || projectLinksLoading;
  const insightError = [goalsError, subgoalsError, projectsError, relationsError, projectLinksError].filter(Boolean).join(' · ');
  const openTasksPage = () => { setMorePage('tasks'); setActivePage('more'); };

  const completeTask = (task) => runAction(
    () => completeTodayTask(supabase, task, profile.id),
    'Tarea completada.'
  );

  const rescheduleToday = (task) => runAction(
    () => rescheduleTodayTask(supabase, task, profile.id, today),
    'Tarea movida a hoy.'
  );

  const renderProgressRows = (items, kind) => items.length ? items.slice(0, 3).map((item) => (
    <div className="today-progress-row" key={item.id}>
      <div className="today-progress-copy">
        <strong>{item.title}</strong>
        <span>{item.progress === null ? 'Sin tareas vinculadas' : `${item.progress}% · ${item.completedTasks} de ${item.totalTasks}`}</span>
      </div>
      <div className="today-progress-track" role="progressbar" aria-label={`Progreso de ${kind}: ${item.title}`} aria-valuemin="0" aria-valuemax="100" aria-valuenow={item.progress ?? 0}>
        <span style={{ width: `${item.progress ?? 0}%` }} />
      </div>
    </div>
  )) : <p className="muted today-insight-empty">Todavía no hay {kind.toLowerCase()} activos.</p>;

  return <>
    <div className="today-grid">
      <div className="today-main-card">
        <div className="card-kicker">TU FOCO DE HOY</div>
        <div className="focus-headline">Haz que hoy<br /><em>cuente.</em></div>
        <p>Elige una acción importante y avanza sin complicarte.</p>
        <button className="button button-light" onClick={() => setActivePage('inbox')}>Vaciar mi mente <span>↗</span></button>
        <div className="card-sprout">✳</div>
      </div>
      <div className="daily-summary daily-summary-four">
        <div className="summary-card"><span>EN TU LISTA</span><strong>{snapshot.openTasks.length}</strong><small>tareas abiertas</small></div>
        <div className="summary-card summary-soft"><span>ATRASADAS</span><strong>{snapshot.overdue.length}</strong><small>requieren atención</small></div>
        <div className="summary-card"><span>PARA HOY</span><strong>{snapshot.dueToday.length}</strong><small>con fecha de hoy</small></div>
        <div className="summary-card summary-soft"><span>TIEMPO ESTIMADO</span><strong>{snapshot.estimatedTodayMinutes ? formatDuration(snapshot.estimatedTodayMinutes) : '—'}</strong><small>{snapshot.estimatedTodayCount} de {snapshot.dueToday.length} con estimación</small></div>
      </div>
    </div>

    <div className="today-insight-grid">
      <section className="today-insight-card today-progress-card" aria-label="Avance real de metas y proyectos">
        <div className="today-insight-heading">
          <div><span className="insight-kicker">AVANCE CON EVIDENCIA</span><h2>Metas y proyectos en marcha</h2></div>
          <button type="button" className="text-button" onClick={() => setActivePage('goals')}>Ver metas →</button>
        </div>
        {insightLoading ? <p className="muted">Calculando avance…</p> : insightError ? <p className="form-error">No se pudo cargar todo el avance: {insightError}</p> : (
          <div className="today-progress-columns">
            <div className="today-progress-group">
              <div className="today-progress-group-title">Metas <span>{snapshot.goalProgress.length}</span></div>
              {renderProgressRows(snapshot.goalProgress, 'Metas')}
            </div>
            <div className="today-progress-group">
              <div className="today-progress-group-title">Proyectos <span>{snapshot.projectProgress.length}</span><button type="button" onClick={() => setActivePage('projects')}>Abrir</button></div>
              {renderProgressRows(snapshot.projectProgress, 'Proyectos')}
            </div>
          </div>
        )}
        <p className="today-progress-note">El porcentaje se calcula con tareas vinculadas completadas; no es una estimación manual.</p>
      </section>

      <aside className="today-insight-card today-week-card" aria-label="Pulso de la semana">
        <div className="today-insight-heading">
          <div><span className="insight-kicker">TU RITMO</span><h2>Últimos 7 días</h2></div>
        </div>
        <div className="today-week-stat"><strong>{snapshot.completedThisWeek}</strong><span>tareas completadas</span></div>
        <div className="today-week-counters">
          <div><span>Bloqueadas</span><strong>{snapshot.blockedTasks.length}</strong></div>
          <div><span>Hitos cercanos</span><strong>{snapshot.milestones.length}</strong></div>
        </div>
        {snapshot.blockedTasks.length > 0 && <div className="today-watch-group">
          <strong>Necesitan desbloqueo</strong>
          {snapshot.blockedTasks.slice(0, 2).map((task) => <div className="today-watch-row" key={task.id}><span>{task.action}</span><small>Bloqueada</small></div>)}
        </div>}
        {snapshot.milestones.length > 0 && <div className="today-watch-group">
          <strong>Próximos hitos</strong>
          {snapshot.milestones.slice(0, 3).map((item) => <div className="today-watch-row" key={item.id}>
            <span>{item.title}<small>{item.kind}</small></span>
            <small className={item.isOverdue ? 'watch-overdue' : ''}>{item.isOverdue ? 'Atrasado' : formatDate(item.targetDate)}</small>
          </div>)}
        </div>}
        {!snapshot.blockedTasks.length && !snapshot.milestones.length && <p className="muted today-insight-empty">No hay bloqueos ni hitos próximos registrados.</p>}
        <button type="button" className="text-button today-watch-link" onClick={openTasksPage}>Revisar tareas →</button>
      </aside>
    </div>

    <div className="content-grid">
      <div className="content-main">
        {snapshot.overdue.length > 0 && <>
          <SectionTitle detail={`${snapshot.overdue.length} ${snapshot.overdue.length === 1 ? 'tarea pendiente' : 'tareas pendientes'}`}>Atrasadas</SectionTitle>
          <div className="task-list task-list-overdue">{snapshot.overdue.map((task) => <TaskRow key={task.id} task={task} onComplete={() => completeTask(task)} onReschedule={() => rescheduleToday(task)} busy={busy} />)}</div>
          <div className="section-spacer" />
        </>}
        <SectionTitle detail={`${snapshot.dueToday.length} ${snapshot.dueToday.length === 1 ? 'elemento' : 'elementos'}`}>Para hoy</SectionTitle>
        {loading ? <p className="muted">Cargando tareas…</p> : localError ? <div className="form-error">{localError}</div> : snapshot.dueToday.length ? <div className="task-list">{snapshot.dueToday.map((task) => <TaskRow key={task.id} task={task} onComplete={() => completeTask(task)} busy={busy} />)}</div> : <EmptyState title="Tu día está despejado" detail="Las tareas que captures aparecerán aquí cuando tengan fecha de hoy." icon="☀️" />}
        <div className="section-spacer" />
        <SectionTitle detail="Pendientes activos">Siguiente</SectionTitle>
        {loading ? <p className="muted">Cargando…</p> : snapshot.nextTasks.length ? <div className="task-list">{snapshot.nextTasks.map((task) => <TaskRow key={task.id} task={task} onComplete={() => completeTask(task)} busy={busy} />)}</div> : <EmptyState title="Sin pendientes" detail="Has despejado tu lista. Captura una nueva acción cuando lo necesites." icon="✓" />}
      </div>
      <aside className="content-side">
        <div className="side-card"><div className="side-card-icon">↳</div><strong>Inbox universal</strong><p>Guarda cualquier idea o pendiente antes de que se te olvide.</p><button className="text-button" onClick={() => setActivePage('inbox')}>Abrir Inbox →</button></div>
        <div className="side-card side-card-tint"><div className="side-card-icon">◎</div><strong>Una vida con dirección</strong><p>Conecta tus acciones con metas que realmente importan.</p><button className="text-button" onClick={() => setActivePage('goals')}>Ver objetivos →</button></div>
      </aside>
    </div>
  </>;
}
