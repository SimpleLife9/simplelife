import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { isSupabaseConfigured, supabase } from './lib/supabase.js';
import { ensureUserProfile } from './lib/profile.js';
import { uuidv7 } from './lib/uuidv7.js';
import { todayInHavana, addDaysToDateKey, formatDuration, formatDate } from './lib/date-time.js';
import { useRows } from './shared/hooks/useRows.js';
import { isOpenTask } from './features/tasks/domain/task-status.js';
import { SectionTitle } from './shared/components/SectionTitle.jsx';
import { EmptyState } from './shared/components/EmptyState.jsx';
import { TodayPage } from './features/today/TodayPage.jsx';
import { InboxPage } from './features/inbox/InboxPage.jsx';
import { GoalsPage } from './features/goals/GoalsPage.jsx';
import { Field } from './shared/components/Field.jsx';
import { StatusTag } from './shared/components/StatusTag.jsx';
import { ProjectsPage } from './features/projects/ProjectsPage.jsx';
import { TextAreaField } from './shared/components/TextAreaField.jsx';
import { ProjectStatusTag } from './shared/components/ProjectStatusTag.jsx';

const NAV = [
  { id: 'today', label: 'Hoy', icon: '☀️' },
  { id: 'inbox', label: 'Inbox', icon: '↳' },
  { id: 'goals', label: 'Objetivos', icon: '◎' },
  { id: 'projects', label: 'Proyectos', icon: '▤' },
  { id: 'more', label: 'Más', icon: '•••' },
];


function App() {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const [profileReady, setProfileReady] = useState(false);
  const [authMode, setAuthMode] = useState('signin');
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState('');
  const [authMessage, setAuthMessage] = useState('');
  const [activePage, setActivePage] = useState('today');
  const [morePage, setMorePage] = useState('tasks');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    if (!supabase) {
      setAuthReady(true);
      return undefined;
    }

    let alive = true;
    const loadSession = async () => {
      const { data, error: sessionError } = await supabase.auth.getSession();
      if (!alive) return;
      if (sessionError) setAuthError(sessionError.message);
      setSession(data.session);
      setAuthReady(true);
      if (data.session?.user) {
        setProfileReady(false);
        try {
          const ownProfile = await ensureUserProfile(data.session.user);
          if (alive) setProfile(ownProfile);
        } catch (profileError) {
          if (alive) setError(`No se pudo preparar tu perfil: ${profileError.message}`);
        } finally {
          if (alive) setProfileReady(true);
        }
      } else {
        setProfile(null);
        setProfileReady(true);
      }
    };

    void loadSession();
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      if (!nextSession?.user) {
        setProfile(null);
        setProfileReady(true);
        return;
      }
      setProfileReady(false);
      // Defer Supabase calls until the auth callback has returned.
      window.setTimeout(async () => {
        try {
          const ownProfile = await ensureUserProfile(nextSession.user);
          if (alive) setProfile(ownProfile);
        } catch (profileError) {
          if (alive) setError(`No se pudo preparar tu perfil: ${profileError.message}`);
        } finally {
          if (alive) setProfileReady(true);
        }
      }, 0);
    });

    return () => {
      alive = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  const showNotice = useCallback((message) => {
    setNotice(message);
    setError('');
    window.setTimeout(() => setNotice((current) => current === message ? '' : current), 3500);
  }, []);

  const showError = useCallback((message) => {
    setError(message);
    setNotice('');
  }, []);

  const runAction = useCallback(async (operation, successMessage) => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await operation();
      setRefreshKey((key) => key + 1);
      if (successMessage) showNotice(successMessage);
      return true;
    } catch (actionError) {
      showError(actionError?.message || 'No se pudo completar la operación.');
      return false;
    } finally {
      setBusy(false);
    }
  }, [showError, showNotice]);

  const handleAuth = async (event) => {
    event.preventDefault();
    setAuthBusy(true);
    setAuthError('');
    setAuthMessage('');
    const form = new FormData(event.currentTarget);
    const email = String(form.get('email') || '').trim().toLowerCase();
    const password = String(form.get('password') || '');
    const fullName = String(form.get('fullName') || '').trim();

    try {
      if (authMode === 'signup') {
        const { data, error: signupError } = await supabase.auth.signUp({
          email,
          password,
          options: { data: { full_name: fullName } },
        });
        if (signupError) throw signupError;
        if (data.session?.user) {
          const ownProfile = await ensureUserProfile(data.session.user);
          setProfile(ownProfile);
          setProfileReady(true);
          setSession(data.session);
        } else {
          setAuthMessage('Cuenta creada. Confirma tu correo y después inicia sesión.');
          setAuthMode('signin');
        }
      } else {
        const { data, error: signinError } = await supabase.auth.signInWithPassword({ email, password });
        if (signinError) throw signinError;
        if (data.session?.user) {
          const ownProfile = await ensureUserProfile(data.session.user);
          setProfile(ownProfile);
          setProfileReady(true);
          setSession(data.session);
        }
      }
    } catch (authFailure) {
      setAuthError(authFailure.message || 'No se pudo iniciar sesión.');
    } finally {
      setAuthBusy(false);
    }
  };

  const handleSignOut = async () => {
    const { error: signoutError } = await supabase.auth.signOut();
    if (signoutError) showError(signoutError.message);
    else showNotice('Sesión cerrada.');
  };

  if (!isSupabaseConfigured) return <ConfigurationScreen />;
  if (!authReady || (session && !profileReady)) return <LoadingScreen label="Preparando tu espacio…" />;
  if (!session) {
    return (
      <AuthScreen
        mode={authMode}
        setMode={setAuthMode}
        onSubmit={handleAuth}
        busy={authBusy}
        error={authError}
        message={authMessage}
      />
    );
  }

  const title = activePage === 'today'
    ? 'Hoy'
    : activePage === 'inbox'
      ? 'Inbox'
      : activePage === 'goals'
        ? 'Objetivos'
        : activePage === 'projects'
          ? 'Proyectos'
          : morePage === 'tasks' ? 'Tareas' : morePage === 'notes' ? 'Notas e ideas' : 'Listas';

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Brand />
        <div className="sidebar-label">TU ESPACIO</div>
        <nav className="side-nav" aria-label="Navegación principal">
          {NAV.map((item) => (
            <button key={item.id} className={`nav-item ${activePage === item.id ? 'active' : ''}`} onClick={() => setActivePage(item.id)}>
              <span className="nav-icon">{item.icon}</span><span>{item.label}</span>
              {item.id === 'inbox' && <span className="nav-dot" />}
            </button>
          ))}
        </nav>

        <div className="sidebar-bottom">
          <div className="privacy-note"><span>◈</span><div><strong>Tu espacio es privado</strong><small>Solo tú puedes ver tus datos.</small></div></div>
          <button className="profile-button" onClick={handleSignOut} title="Cerrar sesión">
            <span className="avatar">{(profile?.display_name || session.user.email || 'S').slice(0, 1).toUpperCase()}</span>
            <span className="profile-meta"><strong>{profile?.display_name || 'Mi cuenta'}</strong><small>{session.user.email}</small></span>
            <span className="profile-exit">↗</span>
          </button>
        </div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <div className="mobile-brand"><Brand compact /></div>
          <div className="breadcrumb">Mi vida <span>/</span> <strong>{title}</strong></div>
          <div className="topbar-right"><span className="sync-state"><i /> Sincronizado</span><button className="mobile-signout" onClick={handleSignOut}>Salir</button></div>
        </header>

        <section className="page-content">
          <div className="page-heading">
            <div>
              <div className="eyebrow">{activePage === 'today' ? new Intl.DateTimeFormat('es', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'America/Havana' }).format(new Date()) : 'YOUR LIFE. YOUR SYSTEM.'}</div>
              <h1>{title}</h1>
              <p>{activePage === 'today' ? 'Un paso claro. Después, el siguiente.' : pageDescription(activePage, morePage)}</p>
            </div>
          </div>
          {activePage === 'more' && (
            <nav className="more-page-tabs" aria-label="Secciones de Más">
              <button type="button" className={morePage === 'tasks' ? 'selected' : ''} aria-current={morePage === 'tasks' ? 'page' : undefined} onClick={() => setMorePage('tasks')}>Tareas</button>
              <button type="button" className={morePage === 'notes' ? 'selected' : ''} aria-current={morePage === 'notes' ? 'page' : undefined} onClick={() => setMorePage('notes')}>Notas e ideas</button>
              <button type="button" className={morePage === 'lists' ? 'selected' : ''} aria-current={morePage === 'lists' ? 'page' : undefined} onClick={() => setMorePage('lists')}>Listas</button>
            </nav>
          )}

          {(notice || error) && <div className={`alert ${error ? 'alert-error' : 'alert-success'}`}>{error || notice}<button onClick={() => { setError(''); setNotice(''); }}>×</button></div>}

          {activePage === 'today' && <TodayPage profile={profile} refreshKey={refreshKey} runAction={runAction} busy={busy} setActivePage={setActivePage} setMorePage={setMorePage} />}
          {activePage === 'inbox' && <InboxPage profile={profile} refreshKey={refreshKey} runAction={runAction} busy={busy} setActivePage={setActivePage} setMorePage={setMorePage} />}
          {activePage === 'goals' && <GoalsPage profile={profile} refreshKey={refreshKey} runAction={runAction} busy={busy} />}
          {activePage === 'projects' && <ProjectsPage profile={profile} refreshKey={refreshKey} runAction={runAction} busy={busy} setActivePage={setActivePage} setMorePage={setMorePage} />}
          {activePage === 'more' && morePage === 'tasks' && <TasksPage profile={profile} refreshKey={refreshKey} runAction={runAction} busy={busy} />}
          {activePage === 'more' && morePage === 'notes' && <NotesPage profile={profile} refreshKey={refreshKey} runAction={runAction} busy={busy} />}
          {activePage === 'more' && morePage === 'lists' && <ListsPage profile={profile} refreshKey={refreshKey} runAction={runAction} busy={busy} setActivePage={setActivePage} setMorePage={setMorePage} />}
        </section>
        <footer className="app-footer"><span>SimpleLife v0.1 · Desarrollo</span><span>Privado por defecto</span></footer>
      </main>
      <nav className="mobile-nav" aria-label="Navegación móvil">
        {NAV.map((item) => (
          <button key={item.id} className={activePage === item.id ? 'active' : ''} onClick={() => setActivePage(item.id)}>
            <span>{item.icon}</span><small>{item.label}</small>
          </button>
        ))}
      </nav>
    </div>
  );
}

function Brand({ compact = false }) {
  return <div className={`brand ${compact ? 'brand-compact' : ''}`}><span className="brand-mark"><span /></span><span>simple<span>life</span></span></div>;
}

function AuthScreen({ mode, setMode, onSubmit, busy, error, message }) {
  return (
    <div className="auth-screen">
      <div className="auth-art"><div className="auth-art-inner"><div className="auth-orbit orbit-one"/><div className="auth-orbit orbit-two"/><div className="auth-leaf">✳</div><div className="auth-quote">“Tu vida, organizada.<br />Tu atención, liberada.”</div><div className="auth-caption">YOUR LIFE. YOUR SYSTEM. YOUR INTELLIGENCE.</div></div></div>
      <div className="auth-panel">
        <Brand />
        <div className="auth-form-wrap">
          <div className="eyebrow">BIENVENIDO A TU ESPACIO</div>
          <h1>{mode === 'signup' ? 'Empieza con claridad.' : 'Vuelve a enfocarte.'}</h1>
          <p>{mode === 'signup' ? 'Crea tu cuenta privada de SimpleLife.' : 'Entra y continúa donde lo dejaste.'}</p>
          <form onSubmit={onSubmit} className="stack-form">
            {mode === 'signup' && <Field label="Cómo te llamas" name="fullName" placeholder="Tu nombre" autoComplete="name" required />}
            <Field label="Correo electrónico" name="email" type="email" placeholder="tu@correo.com" autoComplete="email" required />
            <Field label="Contraseña" name="password" type="password" placeholder="Mínimo 8 caracteres" autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} minLength={8} required />
            {error && <div className="form-error">{error}</div>}
            {message && <div className="form-success">{message}</div>}
            <button className="button button-primary button-full" type="submit" disabled={busy}>{busy ? 'Procesando…' : mode === 'signup' ? 'Crear mi cuenta' : 'Iniciar sesión'} <span>→</span></button>
          </form>
          <div className="auth-switch">{mode === 'signup' ? '¿Ya tienes cuenta?' : '¿Todavía no tienes cuenta?'} <button onClick={() => setMode(mode === 'signup' ? 'signin' : 'signup')}>{mode === 'signup' ? 'Inicia sesión' : 'Crear cuenta'}</button></div>
          <div className="auth-private">◈ Tus datos personales son privados por defecto.</div>
        </div>
      </div>
    </div>
  );
}

function ConfigurationScreen() {
  return <div className="center-screen"><Brand /><h1>Falta configurar la conexión</h1><p>Este proyecto debe ejecutarse con las variables de Supabase que vienen en <code>.env.example</code>.</p></div>;
}
function LoadingScreen({ label }) { return <div className="center-screen"><div className="loading-mark">✳</div><p>{label}</p></div>; }

function FormCard({ title, children, onSubmit, submitLabel = 'Guardar', busy = false, className = '' }) {
  return <form className={`form-card ${className}`} onSubmit={onSubmit}><div className="form-card-title">{title}</div>{children}<button className="button button-primary" type="submit" disabled={busy}>{busy ? 'Guardando…' : submitLabel} <span>→</span></button></form>;
}







function TasksPage({ profile, refreshKey, runAction, busy }) {
  const { rows: tasks, loading, localError } = useRows('task', profile, refreshKey, (query) => query.is('deleted_at', null).order('priority', { ascending: true }).order('created_at', { ascending: false }));
  const { rows: projects } = useRows('project', profile, refreshKey, (query) => query.is('deleted_at', null).order('name'));
  const { rows: taskProjectLinks } = useRows('task_project_link', profile, refreshKey);
  const { rows: goals } = useRows('goal', profile, refreshKey, (query) => query.is('deleted_at', null).order('created_at', { ascending: false }));
  const { rows: subgoals } = useRows('subgoal', profile, refreshKey, (query) => query.is('deleted_at', null).order('created_at'));
  const { rows: contributionRelations } = useRows('contribution_relation', profile, refreshKey);
  const [action, setAction] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState('3');
  const [dueDate, setDueDate] = useState('');
  const [estimatedDuration, setEstimatedDuration] = useState('');
  const [projectId, setProjectId] = useState('');
  const [editingTask, setEditingTask] = useState(null);
  const [editAction, setEditAction] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editPriority, setEditPriority] = useState('3');
  const [editDueDate, setEditDueDate] = useState('');
  const [editEstimatedDuration, setEditEstimatedDuration] = useState('');
  const [taskSearch, setTaskSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('open');
  const [archiveFilter, setArchiveFilter] = useState('active');
  const [priorityFilter, setPriorityFilter] = useState('all');
  const [dateFilter, setDateFilter] = useState('all');
  const [taskSort, setTaskSort] = useState('priority');
  const [selectedTaskIds, setSelectedTaskIds] = useState([]);
  const [bulkDueDate, setBulkDueDate] = useState('');
  const [showNewTask, setShowNewTask] = useState(false);
  const [objectiveFilter, setObjectiveFilter] = useState('all');
  const [projectFilter, setProjectFilter] = useState('all');
  const [relationTask, setRelationTask] = useState(null);
  const [relationTarget, setRelationTarget] = useState('');
  const [projectTask, setProjectTask] = useState(null);
  const [projectTarget, setProjectTarget] = useState('');
  const today = todayInHavana();
  const nextWeek = addDaysToDateKey(today, 7);
  const activeObjectiveProjects = projects.filter((project) => !project.archived_at);
  const activeObjectiveGoals = goals.filter((goal) => !goal.archived_at);
  const activeObjectiveSubgoals = subgoals.filter((subgoal) => !subgoal.archived_at && goals.some((goal) => goal.id === subgoal.goal_id && !goal.archived_at));
  const taskProjectRows = projectTask ? taskProjectLinks.filter((link) => link.task_id === projectTask.id) : [];
  const getTaskObjectiveLabel = (relation) => {
    const goal = relation.goal_id ? goals.find((row) => row.id === relation.goal_id) : null;
    if (goal) return `Meta: ${goal.title}`;
    const subgoal = relation.subgoal_id ? subgoals.find((row) => row.id === relation.subgoal_id) : null;
    if (!subgoal) return 'Objetivo no disponible';
    const parentGoal = goals.find((row) => row.id === subgoal.goal_id);
    return parentGoal ? `Submeta: ${subgoal.title} · ${parentGoal.title}` : `Submeta: ${subgoal.title}`;
  };
  const relationTaskRows = relationTask ? contributionRelations.filter((relation) => relation.task_id === relationTask.id && relation.relation_status === 'confirmed') : [];
  const relationTargetParts = relationTarget ? relationTarget.split(':') : [];
  const relationTargetKind = relationTargetParts[0] || '';
  const relationTargetId = relationTargetParts[1] || '';
  const relationTargetField = relationTargetKind === 'goal' ? 'goal_id' : 'subgoal_id';
  const relationExisting = relationTask && relationTargetId
    ? contributionRelations.find((relation) => relation.task_id === relationTask.id && relation[relationTargetField] === relationTargetId && !relation[relationTargetKind === 'goal' ? 'subgoal_id' : 'goal_id'])
    : null;
  const relationTargetIsLinked = Boolean(relationExisting?.relation_status === 'confirmed');
  const closeNewTask = () => {
    if (busy) return;
    setShowNewTask(false);
    setAction(''); setDescription(''); setPriority('3'); setDueDate(''); setEstimatedDuration(''); setProjectId('');
  };

  const visibleTasks = useMemo(() => {
    const term = taskSearch.trim().toLocaleLowerCase('es');
    const filtered = tasks.filter((task) => {
      const statusMatches = statusFilter === 'all'
        || (statusFilter === 'open' && !['completed', 'cancelled'].includes(task.status))
        || (statusFilter === 'completed' && task.status === 'completed');
      const archiveMatches = archiveFilter === 'all'
        || (archiveFilter === 'active' && !task.archived_at)
        || (archiveFilter === 'archived' && Boolean(task.archived_at));
      const taskObjectives = contributionRelations.filter((relation) => relation.task_id === task.id && relation.relation_status === 'confirmed');
      const taskProjects = taskProjectLinks.filter((link) => link.task_id === task.id);
      let projectMatches = projectFilter === 'all';
      if (projectFilter === 'none') projectMatches = taskProjects.length === 0;
      else if (projectFilter.startsWith('project:')) {
        const targetProjectId = projectFilter.slice('project:'.length);
        projectMatches = taskProjects.some((link) => link.project_id === targetProjectId);
      }
      let objectiveMatches = objectiveFilter === 'all';
      if (objectiveFilter === 'none') objectiveMatches = taskObjectives.length === 0;
      else if (!objectiveMatches && objectiveFilter.includes(':')) {
        const [kind, targetId] = objectiveFilter.split(':');
        objectiveMatches = taskObjectives.some((relation) => {
          if (kind === 'goal') {
            if (relation.goal_id === targetId) return true;
            return Boolean(relation.subgoal_id && subgoals.some((subgoal) => subgoal.id === relation.subgoal_id && subgoal.goal_id === targetId));
          }
          return kind === 'subgoal' && relation.subgoal_id === targetId;
        });
      }
      const priorityMatches = priorityFilter === 'all' || String(task.priority) === priorityFilter;
      const dateMatches = dateFilter === 'all'
        || (dateFilter === 'overdue' && isOpenTask(task) && Boolean(task.due_date) && task.due_date < today)
        || (dateFilter === 'today' && task.due_date === today)
        || (dateFilter === 'next7' && task.due_date > today && task.due_date <= nextWeek)
        || (dateFilter === 'no-date' && !task.due_date);
      const searchMatches = !term || `${task.action || ''} ${task.description || ''}`.toLocaleLowerCase('es').includes(term);
      return statusMatches && archiveMatches && objectiveMatches && projectMatches && priorityMatches && dateMatches && searchMatches;
    });

    const compareDueDate = (a, b) => {
      if (!a.due_date && !b.due_date) return 0;
      if (!a.due_date) return 1;
      if (!b.due_date) return -1;
      return String(a.due_date).localeCompare(String(b.due_date));
    };
    filtered.sort((a, b) => {
      if (taskSort === 'due') return compareDueDate(a, b) || (a.priority ?? 3) - (b.priority ?? 3);
      if (taskSort === 'recent') return String(b.created_at || '').localeCompare(String(a.created_at || ''));
      return (a.priority ?? 3) - (b.priority ?? 3) || compareDueDate(a, b) || String(b.created_at || '').localeCompare(String(a.created_at || ''));
    });
    return filtered;
  }, [tasks, subgoals, contributionRelations, taskProjectLinks, taskSearch, statusFilter, archiveFilter, objectiveFilter, projectFilter, priorityFilter, dateFilter, taskSort, today, nextWeek]);

  const openEditor = (task) => {
    setEditingTask(task);
    setEditAction(task.action || '');
    setEditDescription(task.description || '');
    setEditPriority(String(task.priority ?? 3));
    setEditDueDate(task.due_date || '');
    setEditEstimatedDuration(task.estimated_duration_minutes == null ? '' : String(task.estimated_duration_minutes));
  };

  const addTask = async (event) => {
    event.preventDefault();
    if (!action.trim()) return;
    await runAction(async () => {
      const taskId = uuidv7();
      const { error: insertError } = await supabase.from('task').insert({
        id: taskId, owner_user_id: profile.id, created_by_user_id: profile.id,
        action: action.trim(), description: description.trim() || null,
        priority: Number(priority), due_date: dueDate || null,
        estimated_duration_minutes: estimatedDuration.trim() ? Number(estimatedDuration) : null,
        status: 'todo', time_zone: 'America/Havana',
      });
      if (insertError) throw insertError;
      if (projectId) {
        const { error: linkError } = await supabase.from('task_project_link').insert({ id: uuidv7(), task_id: taskId, project_id: projectId, created_by_user_id: profile.id, relation_role: 'primary' });
        if (linkError) throw new Error(`La tarea se creó, pero no se pudo vincular al proyecto: ${linkError.message}`);
      }
      setAction(''); setDescription(''); setPriority('3'); setDueDate(''); setEstimatedDuration(''); setProjectId('');
      setShowNewTask(false);
    }, 'Tarea creada.');
  };

  const saveTask = async (event) => {
    event.preventDefault();
    if (!editingTask || !editAction.trim()) return;
    await runAction(async () => {
      const { data, error: updateError } = await supabase
        .from('task')
        .update({
          action: editAction.trim(),
          description: editDescription.trim() || null,
          priority: Number(editPriority),
          due_date: editDueDate || null,
          estimated_duration_minutes: editEstimatedDuration.trim() ? Number(editEstimatedDuration) : null,
        })
        .eq('id', editingTask.id)
        .eq('owner_user_id', profile.id)
        .select('id');
      if (updateError) throw updateError;
      if (!data?.length) throw new Error('No se pudo actualizar la tarea. Puede que ya no exista o no pertenezca a esta cuenta.');
      setEditingTask(null);
    }, 'Tarea actualizada.');
  };

  const completeTask = (task) => runAction(async () => {
    const { error: updateError } = await supabase.from('task').update({ status: 'completed', completed_at: new Date().toISOString(), completion_outcome: 'complete' }).eq('id', task.id).eq('owner_user_id', profile.id);
    if (updateError) throw updateError;
  }, 'Tarea completada.');

  const taskStatusLabels = { todo: 'Pendiente', in_progress: 'En curso', blocked: 'Bloqueada' };

  const changeTaskStatus = (task, nextStatus) => {
    if (!Object.hasOwn(taskStatusLabels, nextStatus) || nextStatus === task.status || task.archived_at) return;
    return runAction(async () => {
      const { data, error: updateError } = await supabase.from('task')
        .update({ status: nextStatus })
        .eq('id', task.id)
        .eq('owner_user_id', profile.id)
        .eq('status', task.status)
        .is('archived_at', null)
        .is('deleted_at', null)
        .select('id');
      if (updateError) throw updateError;
      if (!data?.length) throw new Error('No se pudo cambiar el estado. Actualiza la lista antes de reintentar.');
    }, `Estado actualizado: ${taskStatusLabels[nextStatus]}.`);
  };

  const reopenTask = (task) => runAction(async () => {
    const { data, error: updateError } = await supabase.from('task')
      .update({ status: 'todo', completed_at: null, completion_outcome: null })
      .eq('id', task.id)
      .eq('owner_user_id', profile.id)
      .eq('status', 'completed')
      .select('id');
    if (updateError) throw updateError;
    if (!data?.length) throw new Error('No se pudo reabrir la tarea. Puede que ya no esté completada o no pertenezca a esta cuenta.');
  }, 'Tarea reabierta.');

  const archiveTask = (task) => runAction(async () => {
    const { data, error: updateError } = await supabase.from('task')
      .update({ archived_at: new Date().toISOString() })
      .eq('id', task.id)
      .eq('owner_user_id', profile.id)
      .is('archived_at', null)
      .is('deleted_at', null)
      .select('id');
    if (updateError) throw updateError;
    if (!data?.length) throw new Error('No se pudo archivar la tarea. Puede que ya esté archivada o no pertenezca a esta cuenta.');
    setSelectedTaskIds((current) => current.filter((id) => id !== task.id));
  }, 'Tarea archivada.');

  const restoreTask = (task) => runAction(async () => {
    const { data, error: updateError } = await supabase.from('task')
      .update({ archived_at: null })
      .eq('id', task.id)
      .eq('owner_user_id', profile.id)
      .not('archived_at', 'is', null)
      .is('deleted_at', null)
      .select('id');
    if (updateError) throw updateError;
    if (!data?.length) throw new Error('No se pudo restaurar la tarea. Actualiza la lista antes de reintentar.');
  }, 'Tarea restaurada.');

  const openTaskRelations = (task) => { setRelationTask(task); setRelationTarget(''); };
  const closeTaskRelations = () => {
    if (busy) return;
    setRelationTask(null);
    setRelationTarget('');
  };

  const saveTaskRelation = async (event) => {
    event.preventDefault();
    if (!relationTask || relationTask.archived_at || !relationTargetId || !['goal', 'subgoal'].includes(relationTargetKind)) return;
    const selectedGoal = relationTargetKind === 'goal'
      ? goals.find((goal) => goal.id === relationTargetId)
      : goals.find((goal) => goal.id === subgoals.find((subgoal) => subgoal.id === relationTargetId)?.goal_id);
    const selectedSubgoal = relationTargetKind === 'subgoal' ? subgoals.find((subgoal) => subgoal.id === relationTargetId) : null;
    if (!selectedGoal || selectedGoal.archived_at || (relationTargetKind === 'subgoal' && (!selectedSubgoal || selectedSubgoal.archived_at))) return;
    const saved = await runAction(async () => {
      if (relationExisting) {
        if (relationExisting.relation_status === 'confirmed') throw new Error('Este objetivo ya está vinculado a esta tarea.');
        const { data, error } = await supabase.from('contribution_relation')
          .update({ relation_status: 'confirmed' })
          .eq('id', relationExisting.id)
          .eq('task_id', relationTask.id)
          .eq('relation_status', relationExisting.relation_status)
          .select('id');
        if (error) throw error;
        if (!data?.length) throw new Error('No se pudo restaurar el vínculo. Actualiza la vista e inténtalo de nuevo.');
      } else {
        const payload = {
          id: uuidv7(),
          task_id: relationTask.id,
          [relationTargetField]: relationTargetId,
          relation_status: 'confirmed',
          created_by_user_id: profile.id,
        };
        const { data, error } = await supabase.from('contribution_relation').insert(payload).select('id');
        if (error) throw error;
        if (!data?.length) throw new Error('No se pudo crear el vínculo entre la tarea y el objetivo.');
      }
    }, relationExisting ? 'Vínculo restaurado.' : 'Objetivo vinculado a la tarea.');
    if (saved) setRelationTarget('');
  };

  const removeTaskRelation = (relation) => runAction(async () => {
    const { data, error } = await supabase.from('contribution_relation')
      .update({ relation_status: 'removed' })
      .eq('id', relation.id)
      .eq('task_id', relationTask.id)
      .eq('relation_status', 'confirmed')
      .select('id');
    if (error) throw error;
    if (!data?.length) throw new Error('No se pudo desvincular el objetivo. Actualiza la vista e inténtalo de nuevo.');
  }, relation.goal_id ? 'Meta desvinculada de la tarea.' : 'Submeta desvinculada de la tarea.');

  const openTaskProjects = (task) => { setProjectTask(task); setProjectTarget(''); };
  const closeTaskProjects = () => {
    if (busy) return;
    setProjectTask(null);
    setProjectTarget('');
  };

  const addTaskProject = async (event) => {
    event.preventDefault();
    if (!projectTask || projectTask.archived_at || !projectTarget) return;
    const targetProject = activeObjectiveProjects.find((project) => project.id === projectTarget);
    if (!targetProject || taskProjectRows.some((link) => link.project_id === projectTarget)) return;
    const role = taskProjectRows.some((link) => link.relation_role === 'primary') ? 'additional' : 'primary';
    const saved = await runAction(async () => {
      const payload = {
        id: uuidv7(),
        task_id: projectTask.id,
        project_id: targetProject.id,
        relation_role: role,
        created_by_user_id: profile.id,
      };
      const { data, error } = await supabase.from('task_project_link').insert(payload).select('id');
      if (error) throw error;
      if (!data?.length) throw new Error('No se pudo vincular el proyecto a esta tarea.');
    }, role === 'primary' ? 'Proyecto principal vinculado a la tarea.' : 'Proyecto adicional vinculado a la tarea.');
    if (saved) setProjectTarget('');
  };

  const setPrimaryTaskProject = (link) => {
    if (!projectTask || projectTask.archived_at || link.relation_role === 'primary') return;
    const linkedProject = projects.find((project) => project.id === link.project_id);
    if (!linkedProject || linkedProject.archived_at) return;
    return runAction(async () => {
      const previousPrimary = taskProjectRows.find((row) => row.relation_role === 'primary');
      if (previousPrimary) {
        const { data, error } = await supabase.from('task_project_link')
          .update({ relation_role: 'additional' })
          .eq('id', previousPrimary.id)
          .eq('task_id', projectTask.id)
          .eq('relation_role', 'primary')
          .select('id');
        if (error) throw error;
        if (!data?.length) throw new Error('No se pudo liberar el lugar de proyecto principal. Actualiza la lista e inténtalo de nuevo.');
      }

      const { data, error } = await supabase.from('task_project_link')
        .update({ relation_role: 'primary' })
        .eq('id', link.id)
        .eq('task_id', projectTask.id)
        .eq('relation_role', 'additional')
        .select('id');
      if (error || !data?.length) {
        if (previousPrimary) {
          const rollback = await supabase.from('task_project_link')
            .update({ relation_role: 'primary' })
            .eq('id', previousPrimary.id)
            .eq('task_id', projectTask.id)
            .eq('relation_role', 'additional')
            .select('id');
          if (rollback.error || !rollback.data?.length) {
            throw new Error('No se pudo cambiar el proyecto principal y tampoco se pudo restaurar automáticamente el anterior. Los vínculos siguen conservados; actualiza la vista antes de reintentar.');
          }
        }
        if (error) throw error;
        throw new Error('No se pudo establecer el proyecto principal. Actualiza la lista e inténtalo de nuevo.');
      }
    }, 'Proyecto principal actualizado. El anterior se conserva como adicional.');
  };

  const selectableTasks = visibleTasks.filter((task) => isOpenTask(task) && !task.archived_at);
  const selectedVisibleTasks = selectableTasks.filter((task) => selectedTaskIds.includes(task.id));
  const allVisibleSelected = selectableTasks.length > 0 && selectedVisibleTasks.length === selectableTasks.length;
  const toggleVisibleSelection = () => {
    const visibleIds = selectableTasks.map((task) => task.id);
    setSelectedTaskIds((current) => allVisibleSelected
      ? current.filter((id) => !visibleIds.includes(id))
      : [...new Set([...current, ...visibleIds])]);
  };
  const toggleTaskSelection = (taskId, checked) => {
    setSelectedTaskIds((current) => checked
      ? [...new Set([...current, taskId])]
      : current.filter((id) => id !== taskId));
  };
  const clearSelection = () => { setSelectedTaskIds([]); setBulkDueDate(''); };

  const bulkComplete = () => {
    const ids = selectedVisibleTasks.map((task) => task.id);
    if (!ids.length) return;
    return runAction(async () => {
      const { data, error: updateError } = await supabase.from('task')
        .update({ status: 'completed', completed_at: new Date().toISOString(), completion_outcome: 'complete' })
        .in('id', ids).eq('owner_user_id', profile.id).in('status', ['todo', 'in_progress', 'blocked']).select('id');
      if (updateError) throw updateError;
      if ((data || []).length !== ids.length) throw new Error('No se pudieron completar todas las tareas seleccionadas. Actualiza la lista antes de reintentar.');
      clearSelection();
    }, `${ids.length} ${ids.length === 1 ? 'tarea completada' : 'tareas completadas'}.`);
  };

  const bulkReschedule = (nextDate) => {
    const ids = selectedVisibleTasks.map((task) => task.id);
    if (!ids.length) return;
    return runAction(async () => {
      const { data, error: updateError } = await supabase.from('task')
        .update({ due_date: nextDate })
        .in('id', ids).eq('owner_user_id', profile.id).in('status', ['todo', 'in_progress', 'blocked']).select('id');
      if (updateError) throw updateError;
      if ((data || []).length !== ids.length) throw new Error('No se pudo actualizar la fecha de todas las tareas seleccionadas.');
      clearSelection();
    }, nextDate ? 'Fecha actualizada en las tareas seleccionadas.' : 'Fechas eliminadas de las tareas seleccionadas.');
  };

  const bulkArchive = () => {
    const ids = selectedVisibleTasks.map((task) => task.id);
    if (!ids.length) return;
    return runAction(async () => {
      const { data, error: updateError } = await supabase.from('task')
        .update({ archived_at: new Date().toISOString() })
        .in('id', ids)
        .eq('owner_user_id', profile.id)
        .is('archived_at', null)
        .is('deleted_at', null)
        .in('status', ['todo', 'in_progress', 'blocked'])
        .select('id');
      if (updateError) throw updateError;
      if ((data || []).length !== ids.length) throw new Error('No se pudieron archivar todas las tareas seleccionadas. Actualiza la lista antes de reintentar.');
      clearSelection();
    }, `${ids.length} ${ids.length === 1 ? 'tarea archivada' : 'tareas archivadas'}.`);
  };

  return <>
    <div className="management-layout management-layout-single">
      <div className="content-main">
        <div className="section-heading-row">
          <SectionTitle detail={`${visibleTasks.length} de ${tasks.length} tareas`}>Todas tus tareas</SectionTitle>
          <div className="section-create-actions"><button type="button" className="section-create-button" onClick={() => setShowNewTask(true)}>Nueva Tarea</button></div>
        </div>
        <div className="task-toolbar" aria-label="Buscar y organizar tareas">
          <label className="task-toolbar-field task-search-field">
            <span>Buscar</span>
            <input aria-label="Buscar tareas" type="search" value={taskSearch} onChange={(event) => { setTaskSearch(event.target.value); clearSelection(); }} placeholder="Nombre o detalles…" />
          </label>
          <label className="task-toolbar-field">
            <span>Estado</span>
            <select aria-label="Filtrar por estado" value={statusFilter} onChange={(event) => { setStatusFilter(event.target.value); clearSelection(); }}>
              <option value="open">Activas</option>
              <option value="completed">Completadas</option>
              <option value="all">Todas</option>
            </select>
          </label>
          <label className="task-toolbar-field">
            <span>Archivo</span>
            <select aria-label="Filtrar por archivo" value={archiveFilter} onChange={(event) => { setArchiveFilter(event.target.value); clearSelection(); }}>
              <option value="active">Sin archivar</option>
              <option value="archived">Archivadas</option>
              <option value="all">Todas</option>
            </select>
          </label>
          <label className="task-toolbar-field">
            <span>Prioridad</span>
            <select aria-label="Filtrar por prioridad" value={priorityFilter} onChange={(event) => { setPriorityFilter(event.target.value); clearSelection(); }}>
              <option value="all">Todas</option>
              <option value="1">1 · Muy alta</option>
              <option value="2">2 · Alta</option>
              <option value="3">3 · Normal</option>
              <option value="4">4 · Baja</option>
              <option value="5">5 · Flexible</option>
            </select>
          </label>
          <label className="task-toolbar-field">
            <span>Fecha</span>
            <select aria-label="Filtrar por fecha" value={dateFilter} onChange={(event) => { setDateFilter(event.target.value); clearSelection(); }}>
              <option value="all">Todas las fechas</option>
              <option value="overdue">Vencidas</option>
              <option value="today">Para hoy</option>
              <option value="next7">Próximos 7 días</option>
              <option value="no-date">Sin fecha</option>
            </select>
          </label>
          <label className="task-toolbar-field">
            <span>Meta o submeta</span>
            <select aria-label="Filtrar por meta o submeta" value={objectiveFilter} onChange={(event) => { setObjectiveFilter(event.target.value); clearSelection(); }}>
              <option value="all">Todos los objetivos</option>
              <option value="none">Sin objetivo</option>
              <optgroup label="Metas">{goals.map((goal) => <option key={goal.id} value={'goal:' + goal.id}>{goal.title}{goal.archived_at ? ' · Archivada' : ''}</option>)}</optgroup>
              <optgroup label="Submetas">{subgoals.map((subgoal) => {
                const parentGoal = goals.find((goal) => goal.id === subgoal.goal_id);
                return <option key={subgoal.id} value={'subgoal:' + subgoal.id}>{subgoal.title} · {parentGoal?.title || 'Meta'}{subgoal.archived_at || parentGoal?.archived_at ? ' · Archivada' : ''}</option>;
              })}</optgroup>
            </select>
          </label>
          <label className="task-toolbar-field">
            <span>Proyecto</span>
            <select aria-label="Filtrar por proyecto" value={projectFilter} onChange={(event) => { setProjectFilter(event.target.value); clearSelection(); }}>
              <option value="all">Todos los proyectos</option>
              <option value="none">Sin proyecto</option>
              {projects.map((project) => <option key={project.id} value={'project:' + project.id}>{project.name}{project.archived_at ? ' · Archivado' : ''}</option>)}
            </select>
          </label>
          <label className="task-toolbar-field">
            <span>Ordenar</span>
            <select aria-label="Ordenar tareas" value={taskSort} onChange={(event) => { setTaskSort(event.target.value); clearSelection(); }}>
              <option value="priority">Por prioridad</option>
              <option value="due">Por fecha</option>
              <option value="recent">Más recientes</option>
            </select>
          </label>
        </div>
        {!loading && !localError && selectableTasks.length > 0 && <div className="bulk-task-toolbar" aria-label="Acciones para tareas seleccionadas">
          <label className="bulk-select-all">
            <input type="checkbox" aria-label="Seleccionar todas las tareas visibles" checked={allVisibleSelected} onChange={toggleVisibleSelection} />
            <span>Seleccionar visibles</span>
          </label>
          <span className="bulk-selection-count">{selectedVisibleTasks.length} seleccionadas</span>
          {selectedVisibleTasks.length > 0 && <>
            <button type="button" className="bulk-task-button" onClick={bulkComplete} disabled={busy}>Completar seleccionadas</button>
            <button type="button" className="bulk-task-button bulk-task-secondary" onClick={bulkArchive} disabled={busy}>Archivar seleccionadas</button>
            <label className="bulk-date-field"><span>Nueva fecha</span><input type="date" aria-label="Nueva fecha para selección" value={bulkDueDate} onChange={(event) => setBulkDueDate(event.target.value)} /></label>
            <button type="button" className="bulk-task-button" onClick={() => bulkReschedule(bulkDueDate)} disabled={busy || !bulkDueDate}>Aplicar fecha</button>
            <button type="button" className="bulk-task-button bulk-task-secondary" onClick={() => bulkReschedule(null)} disabled={busy}>Quitar fecha</button>
            <button type="button" className="bulk-task-clear" onClick={clearSelection} disabled={busy}>Limpiar</button>
          </>}
        </div>}
        {loading ? <p className="muted">Cargando…</p> : localError ? <div className="form-error">{localError}</div> : tasks.length ? visibleTasks.length ? (
          <div className="task-list">
            {visibleTasks.map((task) => {
              const taskObjectives = contributionRelations.filter((relation) => relation.task_id === task.id && relation.relation_status === 'confirmed');
              const taskProjects = taskProjectLinks.filter((link) => link.task_id === task.id);
              return (
              <div className={`task-row ${task.status === 'completed' ? 'task-done' : ''} ${task.archived_at ? 'task-row-archived' : ''}`} key={task.id}>
                {isOpenTask(task) && !task.archived_at
                  ? <input className="task-select-checkbox" type="checkbox" aria-label={`Seleccionar tarea: ${task.action}`} checked={selectedTaskIds.includes(task.id)} onChange={(event) => toggleTaskSelection(task.id, event.target.checked)} disabled={busy} />
                  : <span className="task-select-spacer" />}
                {task.status === 'completed'
                  ? <span className="task-check checked" aria-label="Tarea completada">✓</span>
                  : <button className="task-check" onClick={() => completeTask(task)} disabled={busy} aria-label={`Completar tarea: ${task.action}`} />}
                <div className="task-row-copy">
                  <strong>{task.action}</strong>
                  <small>{task.due_date ? `Fecha: ${formatDate(task.due_date)}` : 'Sin fecha'} · Prioridad {task.priority}{task.estimated_duration_minutes ? ` · ${formatDuration(task.estimated_duration_minutes)}` : ''}</small>
                  <div className="task-objective-line">
                    <span>{taskObjectives.length ? taskObjectives.map(getTaskObjectiveLabel).join(' · ') : 'Sin meta o submeta vinculada'}</span>
                    <button type="button" onClick={() => openTaskRelations(task)} disabled={busy || Boolean(task.archived_at)} aria-label={`Gestionar objetivos: ${task.action}`}>{taskObjectives.length ? 'Gestionar' : 'Vincular objetivo'}</button>
                  </div>
                  <div className="task-objective-line task-project-line">
                    <span>{taskProjects.length ? taskProjects.map((link) => {
                      const project = projects.find((row) => row.id === link.project_id);
                      return `${project?.name || 'Proyecto no disponible'} (${link.relation_role === 'primary' ? 'principal' : 'adicional'})`;
                    }).join(' · ') : 'Sin proyecto vinculado'}</span>
                    <button type="button" onClick={() => openTaskProjects(task)} disabled={busy || Boolean(task.archived_at)} aria-label={`${taskProjects.length ? 'Gestionar proyectos' : 'Vincular proyecto'}: ${task.action}`}>{taskProjects.length ? 'Gestionar' : 'Vincular proyecto'}</button>
                  </div>
                </div>
                {!task.archived_at && isOpenTask(task) ? (
                  <select
                    className="task-status-select"
                    aria-label={`Cambiar estado: ${task.action}`}
                    value={task.status}
                    onChange={(event) => changeTaskStatus(task, event.target.value)}
                    disabled={busy}
                  >
                    <option value="todo">Pendiente</option>
                    <option value="in_progress">En curso</option>
                    <option value="blocked">Bloqueada</option>
                  </select>
                ) : <StatusTag status={task.status} />}
                {task.archived_at && <span className="task-archived-tag">Archivada</span>}
                {!task.archived_at && task.status === 'completed' && (
                  <button
                    type="button"
                    className="task-edit-button task-reopen-button"
                    onClick={() => reopenTask(task)}
                    disabled={busy}
                    aria-label={`Reabrir tarea: ${task.action}`}
                  >Reabrir</button>
                )}
                {!task.archived_at && <button
                  type="button"
                  className="task-edit-button"
                  onClick={() => openEditor(task)}
                  disabled={busy}
                  aria-label={`Editar tarea: ${task.action}`}
                >Editar</button>}
                {task.archived_at
                  ? <button type="button" className="task-edit-button task-archive-button" onClick={() => restoreTask(task)} disabled={busy} aria-label={`Restaurar tarea: ${task.action}`}>Restaurar</button>
                  : <button type="button" className="task-edit-button task-archive-button" onClick={() => archiveTask(task)} disabled={busy} aria-label={`Archivar tarea: ${task.action}`}>Archivar</button>}
              </div>
              );
            })}
          </div>
        ) : <EmptyState title="No hay coincidencias" detail="Cambia la búsqueda o los filtros para ver otras tareas." icon="⌕" /> : <EmptyState title="No hay tareas todavía" detail="Añade una acción pequeña para empezar a moverte." />}
      </div>
    </div>

    {showNewTask && (
      <div className="task-editor-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) closeNewTask(); }} onKeyDown={(event) => { if (event.key === 'Escape' && !busy) closeNewTask(); }}>
        <section className="task-editor-dialog floating-form-dialog" role="dialog" aria-modal="true" aria-labelledby="task-create-title">
          <div className="task-editor-heading">
            <div><div className="eyebrow">UNA ACCIÓN CONCRETA</div><h2 id="task-create-title">Nueva tarea</h2></div>
            <button type="button" className="task-editor-close" onClick={closeNewTask} disabled={busy} aria-label="Cerrar nueva tarea">×</button>
          </div>
          <form className="task-editor-form" onSubmit={addTask}>
            <Field label="¿Qué necesitas hacer?" name="action" value={action} onChange={(event) => setAction(event.target.value)} placeholder="Ej. Llamar al proveedor" required autoFocus />
            <TextAreaField label="Detalles (opcional)" name="description" value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Información que te ayude a ejecutarla…" rows={3} />
            <label className="field"><span>Prioridad</span><select aria-label="Prioridad" value={priority} onChange={(event) => setPriority(event.target.value)}><option value="1">1 · Muy alta</option><option value="2">2 · Alta</option><option value="3">3 · Normal</option><option value="4">4 · Baja</option><option value="5">5 · Flexible</option></select></label>
            <Field label="Fecha (opcional)" name="due" type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} />
            <Field label="¿Cuánto tiempo crees que te llevará?" name="estimatedDuration" type="number" min="1" max="10080" step="1" value={estimatedDuration} onChange={(event) => setEstimatedDuration(event.target.value)} placeholder="Ej. 45" />
            <p className="task-estimate-help">Indica aproximadamente cuánto tardarás en completar esta tarea. Se usa para organizar tu día; no inicia un temporizador.</p>
            <label className="field"><span>Proyecto (opcional)</span><select value={projectId} onChange={(event) => setProjectId(event.target.value)}><option value="">Sin proyecto</option>{projects.filter((project) => !project.archived_at).map((project) => <option value={project.id} key={project.id}>{project.name}</option>)}</select></label>
            <div className="task-editor-actions">
              <button type="button" className="button task-editor-cancel" onClick={closeNewTask} disabled={busy}>Cancelar</button>
              <button type="submit" className="button button-primary" disabled={busy || !action.trim()}>{busy ? 'Guardando…' : 'Añadir tarea'} <span>→</span></button>
            </div>
          </form>
        </section>
      </div>
    )}

    {editingTask && (
      <div
        className="task-editor-overlay"
        onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setEditingTask(null); }}
        onKeyDown={(event) => { if (event.key === 'Escape' && !busy) setEditingTask(null); }}
      >
        <section className="task-editor-dialog" role="dialog" aria-modal="true" aria-labelledby="task-editor-title">
          <div className="task-editor-heading">
            <div><div className="eyebrow">ACTUALIZA TU PLAN</div><h2 id="task-editor-title">Editar tarea</h2></div>
            <button type="button" className="task-editor-close" onClick={() => setEditingTask(null)} disabled={busy} aria-label="Cerrar edición">×</button>
          </div>
          <form className="task-editor-form" onSubmit={saveTask}>
            <Field label="Nombre de la tarea" name="editAction" value={editAction} onChange={(event) => setEditAction(event.target.value)} required autoFocus />
            <TextAreaField label="Detalles (opcional)" name="editDescription" value={editDescription} onChange={(event) => setEditDescription(event.target.value)} placeholder="Información que te ayude a ejecutarla…" rows={3} />
            <label className="field">
              <span>Prioridad</span>
              <select value={editPriority} onChange={(event) => setEditPriority(event.target.value)}>
                <option value="1">1 · Muy alta</option><option value="2">2 · Alta</option><option value="3">3 · Normal</option><option value="4">4 · Baja</option><option value="5">5 · Flexible</option>
              </select>
            </label>
            <Field label="Fecha (opcional)" name="editDue" type="date" value={editDueDate} onChange={(event) => setEditDueDate(event.target.value)} />
            <Field label="¿Cuánto tiempo crees que te llevará?" name="editEstimatedDuration" type="number" min="1" max="10080" step="1" value={editEstimatedDuration} onChange={(event) => setEditEstimatedDuration(event.target.value)} placeholder="Ej. 45" />
            <p className="task-estimate-help">Indica aproximadamente cuánto tardarás en completar esta tarea. Se usa para organizar tu día; no inicia un temporizador.</p>
            <p className="task-editor-note">El estado de la tarea y su asociación a proyectos se mantienen sin cambios.</p>
            <div className="task-editor-actions">
              <button type="button" className="button task-editor-cancel" onClick={() => setEditingTask(null)} disabled={busy}>Cancelar</button>
              <button type="submit" className="button button-primary" disabled={busy || !editAction.trim()}>{busy ? 'Guardando…' : 'Guardar cambios'} <span>→</span></button>
            </div>
          </form>
        </section>
      </div>
    )}
    {relationTask && (
      <div className="task-editor-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) closeTaskRelations(); }} onKeyDown={(event) => { if (event.key === 'Escape' && !busy) closeTaskRelations(); }}>
        <section className="task-editor-dialog" role="dialog" aria-modal="true" aria-labelledby="task-objective-title">
          <div className="task-editor-heading">
            <div><div className="eyebrow">CONECTA ACCIONES CON RESULTADOS</div><h2 id="task-objective-title">Objetivos de la tarea</h2></div>
            <button type="button" className="task-editor-close" onClick={closeTaskRelations} disabled={busy} aria-label="Cerrar objetivos de la tarea">×</button>
          </div>
          <div className="task-objective-selected"><strong>{relationTask.action}</strong><small>Esta tarea puede contribuir a una o varias metas o submetas.</small></div>
          <div className="task-objective-current">
            <span>Objetivos vinculados</span>
            {relationTaskRows.length ? relationTaskRows.map((relation) => {
              const label = getTaskObjectiveLabel(relation);
              return <div className="project-relation-row" key={relation.id}>
                <div><span>{relation.goal_id ? 'Meta' : 'Submeta'}</span><strong>{label.replace(/^Meta: |^Submeta: /, '')}</strong></div>
                <button type="button" className="text-button" disabled={busy} onClick={() => removeTaskRelation(relation)} aria-label={`Desvincular ${relation.goal_id ? 'meta' : 'submeta'}: ${label.replace(/^Meta: |^Submeta: /, '')}`}>Desvincular</button>
              </div>;
            }) : <p className="muted">Esta tarea todavía no contribuye a ninguna meta o submeta.</p>}
          </div>
          <form className="project-relation-form" onSubmit={saveTaskRelation}>
            <label className="field"><span>Meta o submeta</span><select aria-label="Seleccionar meta o submeta" required value={relationTarget} onChange={(event) => setRelationTarget(event.target.value)} disabled={busy}>
              <option value="">Selecciona un objetivo</option>
              <optgroup label="Metas">{activeObjectiveGoals.map((goal) => <option key={goal.id} value={'goal:' + goal.id}>{goal.title}</option>)}</optgroup>
              <optgroup label="Submetas">{activeObjectiveSubgoals.map((subgoal) => {
                const parentGoal = goals.find((goal) => goal.id === subgoal.goal_id);
                return <option key={subgoal.id} value={'subgoal:' + subgoal.id}>{subgoal.title} — {parentGoal?.title || 'Meta'}</option>;
              })}</optgroup>
            </select></label>
            {relationTargetIsLinked && <p className="task-editor-note">Este objetivo ya está vinculado a esta tarea.</p>}
            {relationExisting && relationExisting.relation_status !== 'confirmed' && <p className="task-editor-note">Este vínculo existe en el historial y se restaurará sin crear otro registro.</p>}
            <button type="submit" className="button button-primary" disabled={busy || !relationTarget || relationTargetIsLinked}>Vincular meta o submeta <span>→</span></button>
          </form>
          <div className="task-editor-actions"><button type="button" className="button task-editor-cancel" onClick={closeTaskRelations} disabled={busy}>Cerrar</button></div>
        </section>
      </div>
    )}
    {projectTask && (
      <div className="task-editor-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) closeTaskProjects(); }} onKeyDown={(event) => { if (event.key === 'Escape' && !busy) closeTaskProjects(); }}>
        <section className="task-editor-dialog" role="dialog" aria-modal="true" aria-labelledby="task-project-title">
          <div className="task-editor-heading">
            <div><div className="eyebrow">ORGANIZA EL TRABAJO POR INICIATIVAS</div><h2 id="task-project-title">Proyectos de la tarea</h2></div>
            <button type="button" className="task-editor-close" onClick={closeTaskProjects} disabled={busy} aria-label="Cerrar proyectos de la tarea">×</button>
          </div>
          <div className="task-objective-selected"><strong>{projectTask.action}</strong><small>Una tarea puede tener un proyecto principal y pertenecer también a otros proyectos relacionados.</small></div>
          <div className="task-objective-current">
            <span>Proyectos vinculados</span>
            {taskProjectRows.length ? taskProjectRows.map((link) => {
              const linkedProject = projects.find((project) => project.id === link.project_id);
              return <div className="project-relation-row" key={link.id}>
                <div><span>{link.relation_role === 'primary' ? 'Proyecto principal' : 'Proyecto adicional'}</span><strong>{linkedProject?.name || 'Proyecto no disponible'}</strong>{linkedProject?.archived_at && <small>Archivado</small>}</div>
                {link.relation_role !== 'primary' && <button type="button" className="text-button" disabled={busy || Boolean(projectTask.archived_at) || Boolean(linkedProject?.archived_at)} onClick={() => setPrimaryTaskProject(link)} aria-label={'Hacer principal: ' + (linkedProject?.name || 'proyecto')}>Hacer principal</button>}
              </div>;
            }) : <p className="muted">Esta tarea todavía no pertenece a ningún proyecto.</p>}
          </div>
          {!projectTask.archived_at && <form className="project-relation-form" onSubmit={addTaskProject}>
            <label className="field"><span>Agregar proyecto</span><select aria-label="Seleccionar proyecto" required value={projectTarget} onChange={(event) => setProjectTarget(event.target.value)} disabled={busy}>
              <option value="">Selecciona un proyecto activo</option>
              {activeObjectiveProjects.filter((project) => !taskProjectRows.some((link) => link.project_id === project.id)).map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
            </select></label>
            {!activeObjectiveProjects.some((project) => !taskProjectRows.some((link) => link.project_id === project.id)) && <p className="task-editor-note">No hay otros proyectos activos disponibles para vincular.</p>}
            <button type="submit" className="button button-primary" disabled={busy || !projectTarget || taskProjectRows.some((link) => link.project_id === projectTarget)}>Vincular proyecto <span>→</span></button>
          </form>}
          <p className="task-editor-note">Los vínculos se conservan. Puedes cambiar cuál es el proyecto principal; los demás quedan como adicionales. No se elimina ninguna relación.</p>
          <div className="task-editor-actions"><button type="button" className="button task-editor-cancel" onClick={closeTaskProjects} disabled={busy}>Cerrar</button></div>
        </section>
      </div>
    )}
  </>;
}
function NotesPage({ profile, refreshKey, runAction, busy }) {
  const { rows, loading, localError } = useRows('note_idea', profile, refreshKey, (query) => query.is('deleted_at', null).order('created_at', { ascending: false }));
  const [kind, setKind] = useState('note');
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const addNote = async (event) => {
    event.preventDefault();
    if (!content.trim()) return;
    await runAction(async () => {
      const { error: insertError } = await supabase.from('note_idea').insert({ id: uuidv7(), owner_user_id: profile.id, created_by_user_id: profile.id, kind, title: title.trim() || null, content: content.trim(), status: 'active' });
      if (insertError) throw insertError;
      setTitle(''); setContent('');
    }, kind === 'idea' ? 'Idea guardada.' : 'Nota guardada.');
  };
  return <div className="management-layout"><div className="content-main"><SectionTitle detail={`${rows.length} registros`}>Tu biblioteca</SectionTitle>{loading ? <p className="muted">Cargando…</p> : localError ? <div className="form-error">{localError}</div> : rows.length ? <div className="notes-grid">{rows.map((note) => <article className="note-card" key={note.id}><span className="note-kind">{note.kind === 'idea' ? '✦ IDEA' : '✎ NOTA'}</span><h3>{note.title || (note.kind === 'idea' ? 'Idea sin título' : 'Nota sin título')}</h3><p>{note.content}</p><small>{note.created_at && !Number.isNaN(new Date(note.created_at).getTime()) ? new Intl.DateTimeFormat('es', { dateStyle: 'medium', timeZone: 'America/Havana' }).format(new Date(note.created_at)) : 'Fecha no disponible'}</small></article>)}</div> : <EmptyState title="Tu biblioteca está vacía" detail="Guarda pensamientos e ideas para volver a ellos cuando quieras." icon="✎" />}</div><aside className="content-side"><FormCard title="Nueva nota o idea" onSubmit={addNote} submitLabel="Guardar" busy={busy}><label className="field"><span>Tipo</span><select value={kind} onChange={(event) => setKind(event.target.value)}><option value="note">Nota</option><option value="idea">Idea</option></select></label><Field label="Título (opcional)" name="title" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Dale un nombre" /><TextAreaField label="Contenido" name="content" value={content} onChange={(event) => setContent(event.target.value)} placeholder="Escribe lo que quieras conservar…" rows={5} required /></FormCard></aside></div>;
}

function ListsPage({ profile, refreshKey, runAction, busy, setActivePage, setMorePage }) {
  const { rows: lists, loading, localError } = useRows('user_list', profile, refreshKey, (query) => query.is('deleted_at', null).order('created_at', { ascending: false }));
  const { rows: allItems } = useRows('list_item', profile, refreshKey, (query) => query.order('position').order('created_at'));
  const { rows: tasks } = useRows('task', profile, refreshKey, (query) => query.is('deleted_at', null).order('created_at', { ascending: false }));
  const [name, setName] = useState('');
  const [draftItems, setDraftItems] = useState({});
  const [converting, setConverting] = useState(null);
  const [conversionTaskId, setConversionTaskId] = useState(null);
  const [conversionTitle, setConversionTitle] = useState('');
  const [conversionPriority, setConversionPriority] = useState('3');
  const [conversionDueDate, setConversionDueDate] = useState('');

  const createList = async (event) => {
    event.preventDefault();
    if (!name.trim()) return;
    await runAction(async () => {
      const { error: insertError } = await supabase.from('user_list').insert({ id: uuidv7(), owner_user_id: profile.id, created_by_user_id: profile.id, name: name.trim(), status: 'active' });
      if (insertError) throw insertError;
      setName('');
    }, 'Lista creada.');
  };
  const addItem = async (listId) => {
    const content = (draftItems[listId] || '').trim();
    if (!content) return;
    await runAction(async () => {
      const position = allItems.filter((item) => item.list_id === listId).length;
      const { error: insertError } = await supabase.from('list_item').insert({ id: uuidv7(), list_id: listId, content, position, is_checked: false, task_id: null });
      if (insertError) throw insertError;
      setDraftItems((current) => ({ ...current, [listId]: '' }));
    }, 'Elemento añadido.');
  };
  const toggleItem = (item) => runAction(async () => {
    const { error: updateError } = await supabase.from('list_item').update({ is_checked: !item.is_checked }).eq('id', item.id).eq('list_id', item.list_id);
    if (updateError) throw updateError;
  });

  const openConversion = (list, item) => {
    if (item.task_id) return;
    setConverting({ item, listId: list.id, listName: list.name });
    setConversionTaskId(uuidv7());
    setConversionTitle(String(item.content || '').slice(0, 240));
    setConversionPriority('3');
    setConversionDueDate('');
  };
  const closeConversion = () => {
    if (busy) return;
    setConverting(null);
    setConversionTaskId(null);
    setConversionTitle('');
    setConversionPriority('3');
    setConversionDueDate('');
  };

  const ensureTaskRow = async (taskRow) => {
    const { data: existing, error: readError } = await supabase.from('task')
      .select('id').eq('id', taskRow.id).maybeSingle();
    if (readError) throw readError;
    if (existing?.id) return;
    const { data, error } = await supabase.from('task').insert(taskRow).select('id');
    if (error) throw error;
    if (!data?.length) throw new Error('La tarea se creó sin confirmación de lectura. Reintenta desde esta misma ventana para completar el vínculo.');
  };

  const convertItemToTask = async (event) => {
    event.preventDefault();
    if (!converting || !conversionTaskId || !conversionTitle.trim()) return;
    const { item, listId, listName } = converting;
    const taskId = conversionTaskId;
    const sourceText = String(item.content || '');
    const taskRow = {
      id: taskId,
      owner_user_id: profile.id,
      created_by_user_id: profile.id,
      action: conversionTitle.trim(),
      description: sourceText + '\n\nOrigen: elemento de la lista "' + listName + '".',
      status: 'todo',
      priority: Number(conversionPriority),
      due_date: conversionDueDate || null,
      time_zone: 'America/Havana',
    };
    const saved = await runAction(async () => {
      await ensureTaskRow(taskRow);
      const { data, error: updateError } = await supabase.from('list_item')
        .update({ task_id: taskId })
        .eq('id', item.id)
        .eq('list_id', listId)
        .is('task_id', null)
        .select('id');
      if (updateError) throw updateError;
      if (!data?.length) {
        const { data: current, error: readError } = await supabase.from('list_item')
          .select('id, task_id').eq('id', item.id).eq('list_id', listId).maybeSingle();
        if (readError) throw readError;
        if (current?.task_id !== taskId) {
          throw new Error('La tarea se creó, pero el elemento de la lista ya tiene otro vínculo o no pudo actualizarse. Revisa la lista antes de volver a intentarlo.');
        }
      }
    }, 'Tarea creada y vinculada al elemento de la lista.');
    if (saved) closeConversion();
  };

  const openTasks = () => { setMorePage('tasks'); setActivePage('more'); };
  const taskStatusLabels = { todo: 'Pendiente', in_progress: 'En curso', blocked: 'Bloqueada', completed: 'Completada', cancelled: 'Cancelada' };

  return <>
    <div className="management-layout">
      <div className="content-main">
        <SectionTitle detail={lists.length + ' listas'}>Tus listas</SectionTitle>
        {loading ? <p className="muted">Cargando…</p> : localError ? <div className="form-error">{localError}</div> : lists.length ? (
          <div className="lists-grid">{lists.map((list) => {
            const items = allItems.filter((item) => item.list_id === list.id);
            return <div className="list-card" key={list.id}>
              <div className="list-card-head"><span>☷</span><div><h3>{list.name}</h3><small>{items.filter((item) => item.is_checked).length} de {items.length} marcados</small></div></div>
              <div className="list-items">{items.map((item) => {
                const linkedTask = item.task_id ? tasks.find((task) => task.id === item.task_id) : null;
                return <div className="list-item-wrap" key={item.id}>
                  <label className={'list-item ' + (item.is_checked ? 'checked' : '')}>
                    <input type="checkbox" checked={item.is_checked} onChange={() => toggleItem(item)} disabled={busy} />
                    <span>{item.content}</span>
                  </label>
                  <div className="list-item-tools">
                    {item.task_id ? (
                      <>
                        <span className="list-task-link">{linkedTask ? 'Tarea vinculada · ' + (taskStatusLabels[linkedTask.status] || 'Asociada') : 'Tarea vinculada'}</span>
                        <button type="button" className="list-task-action" onClick={openTasks}>Abrir tareas →</button>
                      </>
                    ) : (
                      <button type="button" className="list-task-action" onClick={() => openConversion(list, item)} disabled={busy} aria-label={'Convertir en tarea: ' + item.content}>Convertir en tarea →</button>
                    )}
                  </div>
                </div>;
              })}</div>
              <div className="list-add">
                <input value={draftItems[list.id] || ''} onChange={(event) => setDraftItems((current) => ({ ...current, [list.id]: event.target.value }))} placeholder="Añadir elemento…" onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addItem(list.id); } }} />
                <button type="button" onClick={() => addItem(list.id)} disabled={busy || !(draftItems[list.id] || '').trim()}>+</button>
              </div>
            </div>;
          })}</div>
        ) : <EmptyState title="Sin listas por ahora" detail="Compras, preparativos o cualquier conjunto de elementos que quieras ordenar." icon="☷" />}
      </div>
      <aside className="content-side">
        <FormCard title="Crear una lista" onSubmit={createList} submitLabel="Crear lista" busy={busy}>
          <Field label="Nombre de la lista" name="list" value={name} onChange={(event) => setName(event.target.value)} placeholder="Ej. Compras de la semana" required />
        </FormCard>
        <div className="side-tip"><strong>Una lista no es una tarea.</strong><p>Sus elementos permanecen simples. Cuando decidas convertir uno, se crea una tarea vinculada y el elemento original permanece en la lista.</p></div>
      </aside>
    </div>

    {converting && (
      <div className="task-editor-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) closeConversion(); }} onKeyDown={(event) => { if (event.key === 'Escape' && !busy) closeConversion(); }}>
        <section className="task-editor-dialog" role="dialog" aria-modal="true" aria-labelledby="list-convert-title">
          <div className="task-editor-heading">
            <div><div className="eyebrow">CONSERVA EL ELEMENTO ORIGINAL</div><h2 id="list-convert-title">Convertir en tarea</h2></div>
            <button type="button" className="task-editor-close" onClick={closeConversion} disabled={busy} aria-label="Cerrar conversión">×</button>
          </div>
          <div className="capture-original-preview"><span>ELEMENTO DE LISTA · {converting.listName}</span><p>{converting.item.content}</p></div>
          <form className="task-editor-form" onSubmit={convertItemToTask}>
            <Field label="Título de la tarea" name="conversionTitle" value={conversionTitle} onChange={(event) => setConversionTitle(event.target.value)} required />
            <label className="field"><span>Prioridad</span><select aria-label="Prioridad de la tarea" value={conversionPriority} onChange={(event) => setConversionPriority(event.target.value)} disabled={busy}><option value="1">1 · Muy alta</option><option value="2">2 · Alta</option><option value="3">3 · Normal</option><option value="4">4 · Baja</option><option value="5">5 · Flexible</option></select></label>
            <Field label="Fecha objetivo (opcional)" name="conversionDueDate" type="date" value={conversionDueDate} onChange={(event) => setConversionDueDate(event.target.value)} />
            <p className="task-editor-note">El texto original completo quedará en los detalles de la tarea y el elemento seguirá en esta lista. Si la operación se interrumpe, reintenta desde esta misma ventana para completar el vínculo sin duplicar la tarea.</p>
            <div className="task-editor-actions">
              <button type="button" className="button task-editor-cancel" onClick={closeConversion} disabled={busy}>Cancelar</button>
              <button type="submit" className="button button-primary" disabled={busy || !conversionTitle.trim()}>{busy ? 'Creando tarea…' : 'Crear y vincular tarea'} <span>→</span></button>
            </div>
          </form>
        </section>
      </div>
    )}
  </>;
}

function pageDescription(activePage, morePage) {
  if (activePage === 'inbox') return 'Captura primero. Organiza después.';
  if (activePage === 'goals') return 'Conecta lo que quieres con la vida que estás construyendo.';
  if (activePage === 'projects') return 'Resultados concretos, organizados en proyectos.';
  if (morePage === 'tasks') return 'Acciones claras, con prioridad y contexto.';
  if (morePage === 'notes') return 'Un lugar para conservar ideas y pensamientos.';
  return 'Elementos sencillos que puedes organizar y compartir más adelante.';
}

export default App;
