import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { isSupabaseConfigured, supabase } from './lib/supabase.js';
import { ensureUserProfile } from './lib/profile.js';
import { uuidv7 } from './lib/uuidv7.js';
import { buildDashboardSnapshot } from './lib/dashboard.js';
import { todayInHavana, addDaysToDateKey, formatDuration, formatDate } from './lib/date-time.js';
import { TaskRow } from './features/today/components/TaskRow.jsx';
import { useRows } from './shared/hooks/useRows.js';

const NAV = [
  { id: 'today', label: 'Hoy', icon: '☀️' },
  { id: 'inbox', label: 'Inbox', icon: '↳' },
  { id: 'goals', label: 'Objetivos', icon: '◎' },
  { id: 'projects', label: 'Proyectos', icon: '▤' },
  { id: 'more', label: 'Más', icon: '•••' },
];

const isOpenTask = (task) => !['completed', 'cancelled'].includes(task.status);

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

function Field({ label, name, type = 'text', placeholder, required = false, autoComplete, minLength, min, max, step, value, onChange, autoFocus = false }) {
  return <label className="field"><span>{label}</span><input name={name} type={type} placeholder={placeholder} required={required} autoComplete={autoComplete} minLength={minLength} min={min} max={max} step={step} value={value} onChange={onChange} autoFocus={autoFocus} /></label>;
}
function TextAreaField({ label, name, placeholder, required = false, rows = 3, value, onChange }) {
  return <label className="field"><span>{label}</span><textarea name={name} placeholder={placeholder} required={required} rows={rows} value={value} onChange={onChange} /></label>;
}
function SectionTitle({ children, detail }) { return <div className="section-title"><h2>{children}</h2>{detail && <span>{detail}</span>}</div>; }
function EmptyState({ title, detail, icon = '✳' }) { return <div className="empty-state"><div>{icon}</div><strong>{title}</strong><p>{detail}</p></div>; }
function FormCard({ title, children, onSubmit, submitLabel = 'Guardar', busy = false, className = '' }) {
  return <form className={`form-card ${className}`} onSubmit={onSubmit}><div className="form-card-title">{title}</div>{children}<button className="button button-primary" type="submit" disabled={busy}>{busy ? 'Guardando…' : submitLabel} <span>→</span></button></form>;
}


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

  const completeTask = (task) => runAction(async () => {
    const { error: updateError } = await supabase.from('task').update({ status: 'completed', completed_at: new Date().toISOString(), completion_outcome: 'complete' }).eq('id', task.id).eq('owner_user_id', profile.id);
    if (updateError) throw updateError;
  }, 'Tarea completada.');

  const rescheduleToday = (task) => runAction(async () => {
    const { data, error: updateError } = await supabase.from('task').update({ due_date: today })
      .eq('id', task.id).eq('owner_user_id', profile.id).select('id');
    if (updateError) throw updateError;
    if (!data?.length) throw new Error('No se pudo mover la tarea a hoy. Puede que ya no exista o no pertenezca a esta cuenta.');
  }, 'Tarea movida a hoy.');

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


function InboxPage({ profile, refreshKey, runAction, busy, setActivePage, setMorePage }) {
  const { rows, loading, localError } = useRows('capture', profile, refreshKey, (query) => query
    .is('deleted_at', null).order('captured_at', { ascending: false }).limit(50));
  const { rows: captureParts } = useRows('capture_part', profile, refreshKey, (query) => query.order('part_index'));
  const { rows: captureLinks } = useRows('capture_link', profile, refreshKey);
  const { rows: lists } = useRows('user_list', profile, refreshKey, (query) => query
    .is('deleted_at', null).is('archived_at', null).eq('status', 'active').order('name'));
  const { rows: listItems } = useRows('list_item', profile, refreshKey, (query) => query.order('position').order('created_at'));

  const [captureSearch, setCaptureSearch] = useState('');
  const [attentionFilter, setAttentionFilter] = useState('needs_review');
  const [selectedCapture, setSelectedCapture] = useState(null);
  const [destinationType, setDestinationType] = useState('task');
  const [taskTitle, setTaskTitle] = useState('');
  const [taskPriority, setTaskPriority] = useState('3');
  const [taskDueDate, setTaskDueDate] = useState('');
  const [noteTitle, setNoteTitle] = useState('');
  const [listMode, setListMode] = useState('new');
  const [selectedListId, setSelectedListId] = useState('');
  const [newListName, setNewListName] = useState('');
  const [listItemText, setListItemText] = useState('');
  const [operationIds, setOperationIds] = useState(null);

  const getCapturePart = (captureId) => captureParts.find((part) => part.capture_id === captureId);
  const getConfirmedLink = (captureId) => {
    const part = getCapturePart(captureId);
    return part ? captureLinks.find((link) => link.capture_part_id === part.id && link.link_status === 'confirmed') : null;
  };
  const getLinkKind = (link) => {
    if (link?.task_id) return 'task';
    if (link?.note_idea_id) return 'note_idea';
    if (link?.user_list_id || link?.list_item_id) return 'list';
    if (link?.goal_id || link?.subgoal_id) return 'goal_subgoal';
    if (link?.project_id) return 'project';
    return 'unknown';
  };
  const organizedCount = rows.filter((capture) => Boolean(getConfirmedLink(capture.id))).length;
  const pendingCount = rows.filter((capture) => capture.attention_status === 'needs_review' && !getConfirmedLink(capture.id)).length;

  const visibleCaptures = useMemo(() => {
    const term = captureSearch.trim().toLocaleLowerCase('es');
    return rows.filter((capture) => {
      const part = captureParts.find((item) => item.capture_id === capture.id);
      const organized = Boolean(part && captureLinks.some((link) => link.capture_part_id === part.id && link.link_status === 'confirmed'));
      const statusMatches = attentionFilter === 'all'
        || (attentionFilter === 'needs_review' && capture.attention_status === 'needs_review' && !organized)
        || (attentionFilter === 'reviewed' && capture.attention_status === 'reviewed' && !organized)
        || (attentionFilter === 'organized' && organized)
        || (attentionFilter === 'archived' && capture.attention_status === 'archived');
      const searchMatches = !term || String(capture.content_original || '').toLocaleLowerCase('es').includes(term);
      return statusMatches && searchMatches;
    });
  }, [rows, captureParts, captureLinks, captureSearch, attentionFilter]);

  const updateAttention = (capture, nextStatus) => runAction(async () => {
    const { data, error } = await supabase.from('capture')
      .update({ attention_status: nextStatus })
      .eq('id', capture.id)
      .eq('owner_user_id', profile.id)
      .select('id');
    if (error) throw error;
    if (!data?.length) throw new Error('No se pudo actualizar la captura. Puede que ya no exista o no pertenezca a esta cuenta.');
  }, nextStatus === 'reviewed'
    ? 'Captura marcada como revisada.'
    : nextStatus === 'archived'
      ? 'Captura archivada.'
      : 'Captura devuelta a pendientes.');

  const submit = async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const formElement = event.currentTarget;
    const text = String(form.get('capture') || '').trim();
    if (!text) return;
    await runAction(async () => {
      const captureId = uuidv7();
      const { error: captureError } = await supabase.from('capture').insert({
        id: captureId, owner_user_id: profile.id, created_by_user_id: profile.id,
        input_type: 'text', content_original: text,
      });
      if (captureError) throw captureError;
      const { error: partError } = await supabase.from('capture_part').insert({
        id: uuidv7(), capture_id: captureId, part_index: 0, original_fragment: text,
      });
      if (partError) throw new Error('La captura se guardó, pero falta preparar su fragmento: ' + partError.message);
      formElement.reset();
    }, 'Captura guardada.');
  };

  const openOrganizer = (capture) => {
    const part = getCapturePart(capture.id);
    setSelectedCapture(capture);
    setDestinationType('task');
    setTaskTitle(String(capture.content_original || '').slice(0, 240));
    setTaskPriority('3');
    setTaskDueDate('');
    setNoteTitle('');
    setListMode('new');
    setSelectedListId(lists[0]?.id || '');
    setNewListName(String(capture.content_original || '').slice(0, 200));
    setListItemText(String(capture.content_original || '').slice(0, 500));
    setOperationIds({ partId: part?.id || uuidv7(), targetId: uuidv7(), itemId: uuidv7(), linkId: uuidv7() });
  };

  const closeOrganizer = () => {
    if (busy) return;
    setSelectedCapture(null);
    setOperationIds(null);
  };

  const resetTargetIds = () => setOperationIds((current) => current
    ? { ...current, targetId: uuidv7(), itemId: uuidv7(), linkId: uuidv7() }
    : current);

  const ensureRow = async (table, row) => {
    const { data: existing, error: readError } = await supabase.from(table)
      .select('id').eq('id', row.id).maybeSingle();
    if (readError) throw readError;
    if (existing?.id) return;
    const { data, error } = await supabase.from(table).insert(row).select('id');
    if (error) throw error;
    if (!data?.length) throw new Error('No se pudo guardar el elemento en ' + table + '.');
  };

  const saveOrganization = async (event) => {
    event.preventDefault();
    if (!selectedCapture || !operationIds || getConfirmedLink(selectedCapture.id)) return;
    const sourceText = String(selectedCapture.content_original || '');
    if (!sourceText.trim()) return;
    if (destinationType === 'task' && !taskTitle.trim()) return;
    if (destinationType === 'list' && listMode === 'new' && !newListName.trim()) return;
    if (destinationType === 'list' && listMode === 'existing' && !selectedListId) return;
    if (destinationType === 'list' && !listItemText.trim()) return;

    const ids = operationIds;
    const selectedList = lists.find((list) => list.id === selectedListId);
    const category = destinationType === 'task' ? 'task'
      : destinationType === 'note' || destinationType === 'idea' ? 'note_idea' : 'list';
    const interpretation = destinationType === 'task' ? 'Clasificación manual confirmada: tarea.'
      : destinationType === 'note' ? 'Clasificación manual confirmada: nota.'
        : destinationType === 'idea' ? 'Clasificación manual confirmada: idea.'
          : 'Clasificación manual confirmada: lista.';
    const successMessage = destinationType === 'task' ? 'Captura organizada como tarea.'
      : destinationType === 'note' ? 'Captura guardada como nota.'
        : destinationType === 'idea' ? 'Captura guardada como idea.'
          : 'Captura añadida a una lista.';

    const saved = await runAction(async () => {
      const existingPart = getCapturePart(selectedCapture.id);
      const partId = existingPart?.id || ids.partId;
      await ensureRow('capture_part', {
        id: partId, capture_id: selectedCapture.id, part_index: 0, original_fragment: sourceText,
      });

      let linkTarget = {};
      if (destinationType === 'task') {
        await ensureRow('task', {
          id: ids.targetId, owner_user_id: profile.id, created_by_user_id: profile.id,
          action: taskTitle.trim(), description: sourceText, status: 'todo',
          priority: Number(taskPriority), due_date: taskDueDate || null, time_zone: 'America/Havana',
        });
        linkTarget = { task_id: ids.targetId };
      } else if (destinationType === 'note' || destinationType === 'idea') {
        await ensureRow('note_idea', {
          id: ids.targetId, owner_user_id: profile.id, created_by_user_id: profile.id,
          kind: destinationType, title: noteTitle.trim() || null, content: sourceText, status: 'active',
        });
        linkTarget = { note_idea_id: ids.targetId };
      } else if (destinationType === 'list' && listMode === 'new') {
        await ensureRow('user_list', {
          id: ids.targetId, owner_user_id: profile.id, created_by_user_id: profile.id,
          name: newListName.trim(), purpose: 'Creada desde una captura del Inbox.', status: 'active',
        });
        await ensureRow('list_item', {
          id: ids.itemId, list_id: ids.targetId, content: listItemText.trim(), position: 0, is_checked: false,
        });
        linkTarget = { list_item_id: ids.itemId };
      } else if (destinationType === 'list' && listMode === 'existing' && selectedList) {
        await ensureRow('list_item', {
          id: ids.targetId, list_id: selectedList.id, content: listItemText.trim(),
          position: listItems.filter((item) => item.list_id === selectedList.id).length, is_checked: false,
        });
        linkTarget = { list_item_id: ids.targetId };
      } else {
        throw new Error('Selecciona una lista válida para continuar.');
      }

      await ensureRow('capture_link', {
        id: ids.linkId, capture_part_id: partId, ...linkTarget, link_status: 'confirmed',
      });

      const { data: partUpdate, error: partError } = await supabase.from('capture_part')
        .update({ category, interpretation, review_status: 'accepted' })
        .eq('id', partId).select('id');
      if (partError) throw partError;
      if (!partUpdate?.length) throw new Error('El elemento fue creado, pero no se pudo confirmar su clasificación. Reintenta esta misma operación.');

      const { data: captureUpdate, error: captureError } = await supabase.from('capture')
        .update({ attention_status: 'reviewed' })
        .eq('id', selectedCapture.id).eq('owner_user_id', profile.id).select('id');
      if (captureError) throw captureError;
      if (!captureUpdate?.length) throw new Error('El elemento quedó creado, pero no se pudo actualizar el estado de su captura.');
    }, successMessage);

    if (saved) closeOrganizer();
  };

  const attentionLabels = { needs_review: 'Pendiente de revisión', reviewed: 'Revisada', archived: 'Archivada' };
  const typeLabels = { task: 'Tarea', note_idea: 'Nota o idea', list: 'Lista' };
  const openOrganizedTarget = (link) => {
    const kind = getLinkKind(link);
    if (kind === 'task') { setMorePage('tasks'); setActivePage('more'); }
    else if (kind === 'note_idea') { setMorePage('notes'); setActivePage('more'); }
    else if (kind === 'list') { setMorePage('lists'); setActivePage('more'); }
  };

  return <div className="inbox-layout">
    <div className="inbox-composer"><div className="composer-top"><span className="composer-icon">↳</span><div><strong>Sácalo de tu cabeza.</strong><p>Una frase basta. No necesitas organizarla ahora.</p></div></div>
      <form onSubmit={submit}><textarea name="capture" rows="4" placeholder="Escribe aquí lo que tienes en mente…" required /><div className="composer-bottom"><span>✦ El original se conserva sin alteraciones.</span><button className="button button-primary" disabled={busy}>Guardar captura <span>→</span></button></div></form>
    </div>
    <div className="inbox-list-wrap">
      <SectionTitle detail={visibleCaptures.length + ' de ' + rows.length + ' capturas · ' + pendingCount + ' por organizar · ' + organizedCount + ' organizadas'}>Capturado recientemente</SectionTitle>
      <div className="capture-toolbar" aria-label="Buscar y revisar capturas">
        <label className="capture-toolbar-field capture-search-field">
          <span>Buscar</span>
          <input aria-label="Buscar capturas" type="search" value={captureSearch} onChange={(event) => setCaptureSearch(event.target.value)} placeholder="Buscar en el contenido original…" />
        </label>
        <label className="capture-toolbar-field">
          <span>Revisión</span>
          <select aria-label="Filtrar capturas por revisión" value={attentionFilter} onChange={(event) => setAttentionFilter(event.target.value)}>
            <option value="needs_review">Por organizar</option><option value="organized">Organizadas</option>
            <option value="reviewed">Revisadas sin organizar</option><option value="archived">Archivadas</option><option value="all">Todas</option>
          </select>
        </label>
      </div>
      {loading ? <p className="muted">Cargando…</p> : localError ? <div className="form-error">{localError}</div> : rows.length ? visibleCaptures.length ? (
        <div className="capture-list">{visibleCaptures.map((capture) => {
          const part = captureParts.find((item) => item.capture_id === capture.id);
          const confirmedLink = part ? captureLinks.find((link) => link.capture_part_id === part.id && link.link_status === 'confirmed') : null;
          const linkKind = getLinkKind(confirmedLink);
          const label = part?.category === 'task' ? 'Tarea'
            : part?.category === 'note_idea' ? 'Nota o idea'
              : part?.category === 'list' ? 'Lista' : typeLabels[linkKind] || 'Elemento';
          const rowClass = 'capture-row ' + (confirmedLink ? 'capture-row-organized' : 'capture-row-' + capture.attention_status);
          return <div className={rowClass} key={capture.id}>
            <span className="capture-bullet">{confirmedLink ? '✓' : '✳'}</span>
            <div className="capture-row-content">
              <p>{capture.content_original}</p>
              <small>{new Intl.DateTimeFormat('es', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Havana' }).format(new Date(capture.captured_at))}</small>
              <div className="capture-row-actions">
                {confirmedLink
                  ? <span className="capture-status capture-status-organized">Organizada · {label}{capture.attention_status === 'archived' ? ' · Archivada' : ''}</span>
                  : <span className={'capture-status capture-status-' + capture.attention_status}>{attentionLabels[capture.attention_status] || 'Pendiente de revisión'}</span>}
                {confirmedLink ? (
                  <>
                    <button type="button" className="capture-action-button" onClick={() => openOrganizedTarget(confirmedLink)}>Abrir {linkKind === 'task' ? 'tareas' : linkKind === 'note_idea' ? 'notas e ideas' : 'listas'} →</button>
                    <button type="button" className="capture-action-button capture-archive-button" disabled={busy} onClick={() => updateAttention(capture, capture.attention_status === 'archived' ? 'needs_review' : 'archived')} aria-label={capture.attention_status === 'archived' ? 'Restaurar captura: ' + capture.content_original : 'Archivar captura: ' + capture.content_original}>{capture.attention_status === 'archived' ? 'Restaurar' : 'Archivar'}</button>
                  </>
                ) : capture.attention_status !== 'archived' ? (
                  <>
                    <button type="button" className="capture-action-button" disabled={busy} onClick={() => openOrganizer(capture)} aria-label={'Organizar captura: ' + capture.content_original}>Organizar</button>
                    <button type="button" className="capture-action-button" disabled={busy} onClick={() => updateAttention(capture, capture.attention_status === 'reviewed' ? 'needs_review' : 'reviewed')} aria-label={capture.attention_status === 'reviewed' ? 'Volver a pendientes: ' + capture.content_original : 'Marcar revisada: ' + capture.content_original}>{capture.attention_status === 'reviewed' ? 'Volver a pendientes' : 'Marcar revisada'}</button>
                    <button type="button" className="capture-action-button capture-archive-button" disabled={busy} onClick={() => updateAttention(capture, 'archived')} aria-label={'Archivar captura: ' + capture.content_original}>Archivar</button>
                  </>
                ) : <button type="button" className="capture-action-button" disabled={busy} onClick={() => updateAttention(capture, 'needs_review')} aria-label={'Restaurar captura: ' + capture.content_original}>Restaurar</button>}
              </div>
            </div>
          </div>;
        })}</div>
      ) : <EmptyState title="No hay coincidencias" detail="Cambia la búsqueda o el filtro para encontrar otras capturas." icon="⌕" />
      : <EmptyState title="El Inbox está vacío" detail="Empieza escribiendo cualquier cosa que no quieras olvidar." /> }
    </div>
    <div className="honest-note"><span>ⓘ</span><p>La organización es manual y requiere tu confirmación. SimpleLife conserva la captura original y registra su relación con la tarea, nota, idea o elemento de lista. La clasificación automática con IA todavía no está conectada.</p></div>

    {selectedCapture && (
      <div className="task-editor-overlay capture-organizer-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) closeOrganizer(); }}>
        <section className="task-editor-dialog capture-organizer-dialog" role="dialog" aria-modal="true" aria-labelledby="capture-organizer-title">
          <div className="task-editor-heading">
            <div><div className="eyebrow">ORGANIZACIÓN MANUAL</div><h2 id="capture-organizer-title">Organizar captura</h2></div>
            <button type="button" className="task-editor-close" onClick={closeOrganizer} aria-label="Cerrar organizador">×</button>
          </div>
          <div className="capture-original-preview"><span>CAPTURA ORIGINAL · NO SE MODIFICA</span><p>{selectedCapture.content_original}</p></div>
          <form className="capture-organizer-form" onSubmit={saveOrganization}>
            <label className="field"><span>Tipo de destino</span><select aria-label="Tipo de destino" value={destinationType} disabled={busy} onChange={(event) => { setDestinationType(event.target.value); resetTargetIds(); }}>
              <option value="task">Tarea</option><option value="note">Nota</option><option value="idea">Idea</option><option value="list">Lista</option>
            </select></label>
            {destinationType === 'task' && <>
              <label className="field"><span>Título de la tarea</span><input aria-label="Título de la tarea" maxLength={240} value={taskTitle} onChange={(event) => setTaskTitle(event.target.value)} required disabled={busy} /></label>
              <div className="capture-organizer-two-col">
                <label className="field"><span>Prioridad</span><select aria-label="Prioridad de la tarea" value={taskPriority} onChange={(event) => setTaskPriority(event.target.value)} disabled={busy}><option value="1">Muy alta</option><option value="2">Alta</option><option value="3">Normal</option><option value="4">Baja</option><option value="5">Flexible</option></select></label>
                <label className="field"><span>Fecha objetivo (opcional)</span><input aria-label="Fecha objetivo" type="date" value={taskDueDate} onChange={(event) => setTaskDueDate(event.target.value)} disabled={busy} /></label>
              </div>
              <p className="capture-organizer-help">El texto completo de la captura quedará guardado en la descripción de la tarea.</p>
            </>}
            {(destinationType === 'note' || destinationType === 'idea') && <label className="field"><span>Título (opcional)</span><input aria-label="Título (opcional)" maxLength={200} value={noteTitle} onChange={(event) => setNoteTitle(event.target.value)} placeholder="Dale un nombre" disabled={busy} /></label>}
            {destinationType === 'list' && <>
              <label className="field"><span>Acción de lista</span><select aria-label="Acción de lista" value={listMode} onChange={(event) => { setListMode(event.target.value); resetTargetIds(); }} disabled={busy}>
                <option value="new">Crear una nueva lista</option><option value="existing" disabled={!lists.length}>Añadir a una lista existente</option>
              </select></label>
              {listMode === 'new' ? <>
                <label className="field"><span>Nombre de la nueva lista</span><input aria-label="Nombre de la nueva lista" maxLength={200} value={newListName} onChange={(event) => setNewListName(event.target.value)} required disabled={busy} /></label>
                <label className="field"><span>Texto del primer elemento (máximo 500 caracteres)</span><textarea aria-label="Texto del primer elemento" maxLength={500} rows={3} value={listItemText} onChange={(event) => setListItemText(event.target.value)} required disabled={busy} /></label>
                <p className="capture-organizer-help">La captura se añadirá como primer elemento de la lista nueva. El original completo seguirá conservado en Inbox.</p>
              </> : <>
                <label className="field"><span>Lista existente</span><select aria-label="Lista existente" value={selectedListId} onChange={(event) => setSelectedListId(event.target.value)} required disabled={busy}><option value="">Selecciona una lista</option>{lists.map((list) => <option key={list.id} value={list.id}>{list.name}</option>)}</select></label>
                <label className="field"><span>Texto del elemento (máximo 500 caracteres)</span><textarea aria-label="Texto del elemento" maxLength={500} rows={3} value={listItemText} onChange={(event) => setListItemText(event.target.value)} required disabled={busy} /></label>
              </>}
            </>}
            <div className="capture-organizer-actions"><button type="button" className="capture-action-button" onClick={closeOrganizer} disabled={busy}>Cancelar</button><button type="submit" className="button button-primary" disabled={busy || !operationIds}>{busy ? 'Organizando…' : 'Confirmar y organizar'} <span>→</span></button></div>
          </form>
        </section>
      </div>
    )}
  </div>;
}

function GoalsPage({ profile, refreshKey, runAction, busy }) {
  const { rows: areas, loading, localError } = useRows('life_area', profile, refreshKey, (query) => query.is('deleted_at', null).order('position').order('created_at'));
  const { rows: goals } = useRows('goal', profile, refreshKey, (query) => query.is('deleted_at', null).order('created_at', { ascending: false }));
  const { rows: subgoals } = useRows('subgoal', profile, refreshKey, (query) => query.is('deleted_at', null).order('created_at'));
  const { rows: tasks } = useRows('task', profile, refreshKey, (query) => query.is('deleted_at', null).order('created_at', { ascending: false }));
  const { rows: projects } = useRows('project', profile, refreshKey, (query) => query.is('deleted_at', null));
  const { rows: contributionRelations } = useRows('contribution_relation', profile, refreshKey);
  const [activeView, setActiveView] = useState('areas');
  const [areaTitle, setAreaTitle] = useState('');
  const [areaDescription, setAreaDescription] = useState('');
  const [editingArea, setEditingArea] = useState(null);
  const [selectedArea, setSelectedArea] = useState('');
  const [goalTitle, setGoalTitle] = useState('');
  const [goalReason, setGoalReason] = useState('');
  const [expectedResult, setExpectedResult] = useState('');
  const [targetDate, setTargetDate] = useState('');
  const [editingGoal, setEditingGoal] = useState(null);
  const [editingSubgoal, setEditingSubgoal] = useState(null);
  const [subgoalTitle, setSubgoalTitle] = useState('');
  const [subgoalExpectedResult, setSubgoalExpectedResult] = useState('');
  const [subgoalTargetDate, setSubgoalTargetDate] = useState('');
  const [showAreaModal, setShowAreaModal] = useState(false);
  const [showGoalModal, setShowGoalModal] = useState(false);
  const [showSubgoalModal, setShowSubgoalModal] = useState(false);
  const [subgoalGoalFilter, setSubgoalGoalFilter] = useState('all');
  const [newSubgoalGoalId, setNewSubgoalGoalId] = useState('');
  const [newSubgoalTitle, setNewSubgoalTitle] = useState('');
  const [newSubgoalExpectedResult, setNewSubgoalExpectedResult] = useState('');
  const [newSubgoalTargetDate, setNewSubgoalTargetDate] = useState('');

  const closeAreaModal = () => { if (busy) return; setShowAreaModal(false); setEditingArea(null); setAreaTitle(''); setAreaDescription(''); };
  const closeGoalModal = () => { if (busy) return; setShowGoalModal(false); setEditingGoal(null); setSelectedArea(''); setGoalTitle(''); setGoalReason(''); setExpectedResult(''); setTargetDate(''); };
  const closeSubgoalModal = () => {
    if (busy) return;
    setShowSubgoalModal(false); setNewSubgoalGoalId(''); setNewSubgoalTitle(''); setNewSubgoalExpectedResult(''); setNewSubgoalTargetDate('');
  };
  const openAreaEditor = (area) => { setEditingArea(area); setAreaTitle(area.title || ''); setAreaDescription(area.description || ''); setShowAreaModal(true); };
  const openGoalEditor = (goal) => { setEditingGoal(goal); setSelectedArea(goal.life_area_id || ''); setGoalTitle(goal.title || ''); setGoalReason(goal.reason || ''); setExpectedResult(goal.expected_result || ''); setTargetDate(goal.target_date || ''); setShowGoalModal(true); };
  const openSubgoalEditor = (subgoal) => { setEditingSubgoal(subgoal); setSubgoalTitle(subgoal.title || ''); setSubgoalExpectedResult(subgoal.expected_result || ''); setSubgoalTargetDate(subgoal.target_date || ''); };

  const saveArea = async (event) => {
    event.preventDefault();
    const title = areaTitle.trim();
    if (!title) return;
    const saved = await runAction(async () => {
      const payload = { title, description: areaDescription.trim() || null };
      if (editingArea) {
        const { data, error } = await supabase.from('life_area').update(payload).eq('id', editingArea.id).eq('owner_user_id', profile.id).is('deleted_at', null).select('id');
        if (error) throw error;
        if (!data?.length) throw new Error('No se pudo actualizar el área. Actualiza la vista e inténtalo de nuevo.');
      } else {
        const { error } = await supabase.from('life_area').insert({ id: uuidv7(), owner_user_id: profile.id, created_by_user_id: profile.id, title, description: payload.description });
        if (error) throw error;
      }
    }, editingArea ? 'Área actualizada.' : 'Área creada.');
    if (!saved) return;
    closeAreaModal();
  };

  const setAreaStatus = (area) => runAction(async () => {
    const nextStatus = area.status === 'paused' ? 'active' : 'paused';
    const { data, error } = await supabase.from('life_area').update({ status: nextStatus }).eq('id', area.id).eq('owner_user_id', profile.id).is('deleted_at', null).select('id');
    if (error) throw error;
    if (!data?.length) throw new Error('No se pudo cambiar el estado del área.');
  }, area.status === 'paused' ? 'Área reactivada.' : 'Área pausada.');

  const moveArea = (area, direction) => runAction(async () => {
    const currentIndex = areas.findIndex((item) => item.id === area.id);
    const nextIndex = currentIndex + direction;
    if (currentIndex < 0 || nextIndex < 0 || nextIndex >= areas.length) return;
    const reordered = [...areas];
    [reordered[currentIndex], reordered[nextIndex]] = [reordered[nextIndex], reordered[currentIndex]];
    // Normalize every position, including rows whose old position was NULL.
    for (let index = 0; index < reordered.length; index += 1) {
      const item = reordered[index];
      const { data, error } = await supabase.from('life_area').update({ position: index })
        .eq('id', item.id).eq('owner_user_id', profile.id).is('deleted_at', null).select('id');
      if (error) throw error;
      if (!data?.length) throw new Error('No se pudo guardar el nuevo orden de las áreas. Actualiza la vista e inténtalo de nuevo.');
    }
  }, direction < 0 ? 'Área movida hacia arriba. Orden guardado.' : 'Área movida hacia abajo. Orden guardado.');

  const saveGoal = async (event) => {
    event.preventDefault();
    if (!selectedArea || !goalTitle.trim()) return;
    const saved = await runAction(async () => {
      const payload = { life_area_id: selectedArea, title: goalTitle.trim(), reason: goalReason.trim() || null, expected_result: expectedResult.trim() || null, target_date: targetDate || null };
      if (editingGoal) {
        const { data, error } = await supabase.from('goal').update(payload).eq('id', editingGoal.id).eq('owner_user_id', profile.id).is('deleted_at', null).select('id');
        if (error) throw error;
        if (!data?.length) throw new Error('No se pudo actualizar la meta. Actualiza la vista e inténtalo de nuevo.');
      } else {
        const { error } = await supabase.from('goal').insert({ id: uuidv7(), owner_user_id: profile.id, created_by_user_id: profile.id, ...payload, status: 'active' });
        if (error) throw error;
      }
    }, editingGoal ? 'Meta actualizada.' : 'Meta creada.');
    if (!saved) return;
    closeGoalModal();
  };

  const setGoalStatus = (goal, status) => runAction(async () => {
    const { data, error } = await supabase.from('goal').update({ status }).eq('id', goal.id).eq('owner_user_id', profile.id).is('deleted_at', null).select('id');
    if (error) throw error;
    if (!data?.length) throw new Error('No se pudo actualizar el estado de la meta.');
  }, status === 'completed' ? 'Meta completada.' : status === 'paused' ? 'Meta pausada.' : status === 'active' ? 'Meta reactivada.' : 'Estado de la meta actualizado.');

  const createSubgoal = async (event) => {
    event.preventDefault();
    if (!newSubgoalGoalId || !newSubgoalTitle.trim()) return;
    const saved = await runAction(async () => {
      const payload = {
        id: uuidv7(), goal_id: newSubgoalGoalId, created_by_user_id: profile.id,
        title: newSubgoalTitle.trim(), expected_result: newSubgoalExpectedResult.trim() || null,
        target_date: newSubgoalTargetDate || null, status: 'active',
      };
      const { error } = await supabase.from('subgoal').insert(payload);
      if (error) throw error;
    }, 'Submeta creada.');
    if (saved) closeSubgoalModal();
  };

  const saveSubgoal = async (event) => {
    event.preventDefault();
    if (!editingSubgoal || !subgoalTitle.trim()) return;
    const saved = await runAction(async () => {
      const payload = { title: subgoalTitle.trim(), expected_result: subgoalExpectedResult.trim() || null, target_date: subgoalTargetDate || null };
      const { data, error } = await supabase.from('subgoal').update(payload).eq('id', editingSubgoal.id).eq('goal_id', editingSubgoal.goal_id).is('deleted_at', null).select('id');
      if (error) throw error;
      if (!data?.length) throw new Error('No se pudo actualizar la submeta.');
    }, 'Submeta actualizada.');
    if (saved) setEditingSubgoal(null);
  };

  const setSubgoalStatus = (subgoal, status) => runAction(async () => {
    const { data, error } = await supabase.from('subgoal').update({ status }).eq('id', subgoal.id).eq('goal_id', subgoal.goal_id).is('deleted_at', null).select('id');
    if (error) throw error;
    if (!data?.length) throw new Error('No se pudo actualizar el estado de la submeta.');
  }, status === 'completed' ? 'Submeta completada.' : status === 'active' ? 'Submeta reactivada.' : status === 'paused' ? 'Submeta pausada.' : 'Estado de la submeta actualizado.');

  const openNewSubgoal = (goalId) => {
    setNewSubgoalGoalId(goalId || (subgoalGoalFilter !== 'all' ? subgoalGoalFilter : (goals[0]?.id || '')));
    setShowSubgoalModal(true);
  };
  const visibleSubgoals = subgoals.filter((subgoal) => subgoalGoalFilter === 'all' || subgoal.goal_id === subgoalGoalFilter);
  const viewHeading = activeView === 'areas' ? 'Tus áreas de vida' : activeView === 'goals' ? 'Tus metas' : 'Tus submetas';

  return <>
    <div className="management-layout management-layout-single">
      <div className="content-main">
        <div className="goals-page-intro">
          <SectionTitle detail={areas.length + ' áreas · ' + goals.length + ' metas · ' + subgoals.length + ' submetas'}>Organiza tu vida</SectionTitle>
        </div>
        <div className="life-view-tabs" role="group" aria-label="Apartados de objetivos">
          <button type="button" className={activeView === 'areas' ? 'life-view-tab active' : 'life-view-tab'} aria-pressed={activeView === 'areas'} onClick={() => setActiveView('areas')}>Áreas</button>
          <button type="button" className={activeView === 'goals' ? 'life-view-tab active' : 'life-view-tab'} aria-pressed={activeView === 'goals'} onClick={() => setActiveView('goals')}>Metas</button>
          <button type="button" className={activeView === 'subgoals' ? 'life-view-tab active' : 'life-view-tab'} aria-pressed={activeView === 'subgoals'} onClick={() => setActiveView('subgoals')}>Submetas</button>
        </div>
        <div className="section-heading-row goals-section-heading">
          <SectionTitle detail={activeView === 'areas' ? 'Ordena y administra los ámbitos importantes de tu vida.' : activeView === 'goals' ? 'Cada meta tiene un resultado, un motivo y una fecha objetivo.' : 'Desglosa cada meta en pasos concretos que puedas completar.'}>{viewHeading}</SectionTitle>
          <div className="section-create-actions">
            {activeView === 'areas' && <button type="button" className="section-create-button" onClick={() => setShowAreaModal(true)}>Nueva Área</button>}
            {activeView === 'goals' && <button type="button" className="section-create-button" onClick={() => setShowGoalModal(true)}>Nueva Meta</button>}
            {activeView === 'subgoals' && <button type="button" className="section-create-button" onClick={() => openNewSubgoal('')} disabled={!goals.length || busy}>Nueva Submeta</button>}
          </div>
        </div>

        {loading && activeView === 'areas' ? <p className="muted">Cargando áreas…</p> : localError && activeView === 'areas' ? <div className="form-error">{localError}</div> : <>
          {activeView === 'areas' && (areas.length ? <div className="area-grid">{areas.map((area, areaIndex) => {
            const areaGoals = goals.filter((goal) => goal.life_area_id === area.id);
            return <div className="area-card" key={area.id}>
              <div className="area-card-top"><span className="area-symbol">◎</span><span className="area-count">Posición {areaIndex + 1} de {areas.length}</span></div>
              <div className="area-heading-edit"><div><h3>{area.title}</h3>{area.description && <p>{area.description}</p>}</div><button type="button" className="task-edit-button" onClick={() => openAreaEditor(area)} aria-label={'Editar área: ' + area.title}>Editar área</button></div>
              <div className="area-area-summary"><strong>{areaGoals.length} {areaGoals.length === 1 ? 'meta asociada' : 'metas asociadas'}</strong><button type="button" className="text-button" onClick={() => { setSubgoalGoalFilter('all'); setActiveView('goals'); }}>Ver todas las metas →</button></div>
              <div className="area-inline-actions"><StatusTag status={area.status || 'active'} /><div className="area-management-actions"><button type="button" className="text-button" disabled={busy || areaIndex === 0} onClick={() => moveArea(area, -1)} aria-label={'Mover área arriba: ' + area.title}>↑ Subir</button><button type="button" className="text-button" disabled={busy || areaIndex === areas.length - 1} onClick={() => moveArea(area, 1)} aria-label={'Mover área abajo: ' + area.title}>↓ Bajar</button><button type="button" className="text-button" disabled={busy} onClick={() => setAreaStatus(area)}>{area.status === 'paused' ? 'Reactivar área' : 'Pausar área'}</button></div></div>
            </div>;
          })}</div> : <EmptyState title="Empieza por tus áreas" detail="Crea ámbitos para ordenar lo que importa en tu vida." />)}

          {activeView === 'goals' && (goals.length ? <div className="goal-catalog-grid">{goals.map((goal, goalIndex) => {
            const area = areas.find((item) => item.id === goal.life_area_id);
            const goalSubgoals = subgoals.filter((subgoal) => subgoal.goal_id === goal.id);
            const goalProjects = contributionRelations.filter((relation) => relation.goal_id === goal.id && relation.project_id && relation.relation_status === 'confirmed').map((relation) => projects.find((project) => project.id === relation.project_id)).filter(Boolean);
            const goalTaskRows = tasks.filter((task) => contributionRelations.some((relation) => relation.task_id === task.id && relation.relation_status === 'confirmed' && (relation.goal_id === goal.id || goalSubgoals.some((subgoal) => relation.subgoal_id === subgoal.id))));
            return <article className="goal-record-card" key={goal.id}>
              <div className="goal-record-heading"><div><span className="record-eyebrow">META {goalIndex + 1}</span><h3>{goal.title}</h3><p>Área: {area?.title || 'Área no disponible'}</p></div><button type="button" className="task-edit-button" onClick={() => openGoalEditor(goal)} aria-label={'Editar meta: ' + goal.title}>Editar meta</button></div>
              <div className="goal-record-details">
                <div><span>Resultado esperado</span><p>{goal.expected_result || 'Aún no definido'}</p></div>
                <div><span>Motivo</span><p>{goal.reason || 'Aún no indicado'}</p></div>
                <div><span>Fecha objetivo</span><p>{goal.target_date ? formatDate(goal.target_date) : 'Sin fecha'}</p></div>
              </div>
              <div className="goal-related-projects"><span>Proyectos vinculados</span>{goalProjects.length ? <div>{goalProjects.map((project) => <span className="goal-related-project-tag" key={project.id}>{project.name}</span>)}</div> : <small>Sin proyectos vinculados</small>}</div>
              <div className="goal-related-tasks"><span>Tareas que contribuyen · {goalTaskRows.length}</span>{goalTaskRows.length ? <div>{goalTaskRows.slice(0, 4).map((task) => <span className="goal-related-task-tag" key={task.id}><strong>{task.action}</strong><small>{task.archived_at ? 'Archivada' : task.status === 'completed' ? 'Completada' : task.status === 'in_progress' ? 'En curso' : task.status === 'blocked' ? 'Bloqueada' : 'Pendiente'}</small></span>)}{goalTaskRows.length > 4 && <small>+{goalTaskRows.length - 4} tareas más</small>}</div> : <small>Sin tareas vinculadas</small>}</div>
              <div className="goal-record-footer">
                <label className="record-status-field"><span>Estado de la meta</span><select aria-label={'Estado de meta: ' + goal.title} value={goal.status || 'active'} disabled={busy} onChange={(event) => setGoalStatus(goal, event.target.value)}><option value="draft">Borrador</option><option value="active">Activa</option><option value="paused">En pausa</option><option value="completed">Completada</option><option value="cancelled">Cancelada</option></select></label>
                <button type="button" className="text-button" onClick={() => { setSubgoalGoalFilter(goal.id); setActiveView('subgoals'); }}>Ver {goalSubgoals.length} submetas →</button>
              </div>
            </article>;
          })}</div> : <EmptyState title="Todavía no tienes metas" detail="Pulsa Nueva Meta para crear la primera y asociarla a un área." />)}

          {activeView === 'subgoals' && (goals.length ? <>
            <div className="subgoal-toolbar">
              <label className="goal-filter-field"><span>Mostrar submetas de</span><select aria-label="Filtrar submetas por meta" value={subgoalGoalFilter} onChange={(event) => setSubgoalGoalFilter(event.target.value)}><option value="all">Todas las metas</option>{goals.map((goal) => <option key={goal.id} value={goal.id}>{goal.title}</option>)}</select></label>
            </div>
            {visibleSubgoals.length ? <div className="subgoal-catalog-grid">{visibleSubgoals.map((subgoal, subgoalIndex) => {
              const parentGoal = goals.find((goal) => goal.id === subgoal.goal_id);
              const subgoalProjects = contributionRelations.filter((relation) => relation.subgoal_id === subgoal.id && relation.project_id && relation.relation_status === 'confirmed').map((relation) => projects.find((project) => project.id === relation.project_id)).filter(Boolean);
              const subgoalTaskRows = tasks.filter((task) => contributionRelations.some((relation) => relation.task_id === task.id && relation.subgoal_id === subgoal.id && relation.relation_status === 'confirmed'));
              return <article className="subgoal-record-card" key={subgoal.id}>
                <div className="goal-record-heading"><div><span className="record-eyebrow">SUBMETA {subgoalIndex + 1}</span><h3>{subgoal.title}</h3><p>Meta: {parentGoal?.title || 'Meta no disponible'}</p></div><button type="button" className="task-edit-button" onClick={() => openSubgoalEditor(subgoal)} aria-label={'Editar submeta: ' + subgoal.title}>Editar submeta</button></div>
                <div className="goal-record-details">
                  <div><span>Resultado esperado</span><p>{subgoal.expected_result || 'Aún no definido'}</p></div>
                  <div><span>Fecha objetivo</span><p>{subgoal.target_date ? formatDate(subgoal.target_date) : 'Sin fecha'}</p></div>
                </div>
                <div className="goal-related-projects"><span>Proyectos vinculados</span>{subgoalProjects.length ? <div>{subgoalProjects.map((project) => <span className="goal-related-project-tag" key={project.id}>{project.name}</span>)}</div> : <small>Sin proyectos vinculados</small>}</div>
                <div className="goal-related-tasks"><span>Tareas que contribuyen · {subgoalTaskRows.length}</span>{subgoalTaskRows.length ? <div>{subgoalTaskRows.slice(0, 4).map((task) => <span className="goal-related-task-tag" key={task.id}><strong>{task.action}</strong><small>{task.archived_at ? 'Archivada' : task.status === 'completed' ? 'Completada' : task.status === 'in_progress' ? 'En curso' : task.status === 'blocked' ? 'Bloqueada' : 'Pendiente'}</small></span>)}{subgoalTaskRows.length > 4 && <small>+{subgoalTaskRows.length - 4} tareas más</small>}</div> : <small>Sin tareas vinculadas</small>}</div>
                <div className="goal-record-footer"><label className="record-status-field"><span>Estado de la submeta</span><select aria-label={'Estado de submeta: ' + subgoal.title} value={subgoal.status || 'active'} disabled={busy} onChange={(event) => setSubgoalStatus(subgoal, event.target.value)}><option value="draft">Borrador</option><option value="active">Activa</option><option value="paused">En pausa</option><option value="completed">Completada</option><option value="cancelled">Cancelada</option></select></label></div>
              </article>;
            })}</div> : <EmptyState title="Esta meta todavía no tiene submetas" detail="Pulsa Nueva Submeta para desglosarla en acciones concretas." />}
          </> : <EmptyState title="Primero crea una meta" detail="Las submetas siempre pertenecen a una meta existente." />)}
        </>}
      </div>
    </div>

    {showAreaModal && <div className="task-editor-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) closeAreaModal(); }} onKeyDown={(event) => { if (event.key === 'Escape' && !busy) closeAreaModal(); }}>
      <section className="task-editor-dialog floating-form-dialog" role="dialog" aria-modal="true" aria-labelledby="area-editor-title">
        <div className="task-editor-heading"><div><div className="eyebrow">ORGANIZA TU VIDA</div><h2 id="area-editor-title">{editingArea ? 'Editar área' : 'Nueva área'}</h2></div><button type="button" className="task-editor-close" onClick={closeAreaModal} disabled={busy} aria-label="Cerrar área">×</button></div>
        <form className="task-editor-form" onSubmit={saveArea}>
          <Field label="Nombre del área" name="area" value={areaTitle} onChange={(event) => setAreaTitle(event.target.value)} placeholder="Ej. Finanzas, físico, familia…" required />
          <Field label="Descripción (opcional)" name="areaDescription" value={areaDescription} onChange={(event) => setAreaDescription(event.target.value)} placeholder="Qué representa esta área…" />
          <div className="task-editor-actions"><button type="button" className="button task-editor-cancel" onClick={closeAreaModal} disabled={busy}>Cancelar</button><button type="submit" className="button button-primary" disabled={busy || !areaTitle.trim()}>{busy ? 'Guardando…' : editingArea ? 'Guardar cambios' : 'Crear área'} <span>→</span></button></div>
        </form>
      </section>
    </div>}

    {showGoalModal && <div className="task-editor-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) closeGoalModal(); }} onKeyDown={(event) => { if (event.key === 'Escape' && !busy) closeGoalModal(); }}>
      <section className="task-editor-dialog floating-form-dialog" role="dialog" aria-modal="true" aria-labelledby="goal-editor-title">
        <div className="task-editor-heading"><div><div className="eyebrow">DEFINE LO QUE BUSCAS</div><h2 id="goal-editor-title">{editingGoal ? 'Editar meta' : 'Nueva meta'}</h2></div><button type="button" className="task-editor-close" onClick={closeGoalModal} disabled={busy} aria-label="Cerrar meta">×</button></div>
        <form className="task-editor-form" onSubmit={saveGoal}>
          <label className="field"><span>Área de vida</span><select required value={selectedArea} onChange={(event) => setSelectedArea(event.target.value)}><option value="">Selecciona un área</option>{areas.map((area) => <option key={area.id} value={area.id}>{area.title}</option>)}</select></label>
          {areas.length === 0 && <p className="task-editor-note">Primero crea un área de vida para poder asociar esta meta.</p>}
          <Field label="Resultado que buscas" name="goal" value={goalTitle} onChange={(event) => setGoalTitle(event.target.value)} placeholder="Ej. Ahorrar 2.000 €" required />
          <Field label="Resultado esperado (opcional)" name="expectedResult" value={expectedResult} onChange={(event) => setExpectedResult(event.target.value)} placeholder="Cómo sabrás que lo lograste…" />
          <Field label="Motivo (opcional)" name="reason" value={goalReason} onChange={(event) => setGoalReason(event.target.value)} placeholder="¿Por qué es importante?" />
          <Field label="Fecha objetivo (opcional)" name="targetDate" type="date" value={targetDate} onChange={(event) => setTargetDate(event.target.value)} />
          <div className="task-editor-actions"><button type="button" className="button task-editor-cancel" onClick={closeGoalModal} disabled={busy}>Cancelar</button><button type="submit" className="button button-primary" disabled={busy || areas.length === 0 || !selectedArea || !goalTitle.trim()}>{busy ? 'Guardando…' : editingGoal ? 'Guardar cambios' : 'Crear meta'} <span>→</span></button></div>
        </form>
      </section>
    </div>}

    {showSubgoalModal && <div className="task-editor-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) closeSubgoalModal(); }} onKeyDown={(event) => { if (event.key === 'Escape' && !busy) closeSubgoalModal(); }}>
      <section className="task-editor-dialog floating-form-dialog" role="dialog" aria-modal="true" aria-labelledby="new-subgoal-title">
        <div className="task-editor-heading"><div><div className="eyebrow">CONVIERTE LA META EN PASOS</div><h2 id="new-subgoal-title">Nueva submeta</h2></div><button type="button" className="task-editor-close" onClick={closeSubgoalModal} disabled={busy} aria-label="Cerrar nueva submeta">×</button></div>
        <form className="task-editor-form" onSubmit={createSubgoal}>
          <label className="field"><span>Meta a la que pertenece</span><select aria-label="Meta a la que pertenece" required value={newSubgoalGoalId} onChange={(event) => setNewSubgoalGoalId(event.target.value)}><option value="">Selecciona una meta</option>{goals.map((goal) => <option key={goal.id} value={goal.id}>{goal.title}</option>)}</select></label>
          <Field label="Nombre de la submeta" name="newSubgoalTitle" value={newSubgoalTitle} onChange={(event) => setNewSubgoalTitle(event.target.value)} placeholder="Ej. Ahorrar una cantidad fija cada mes" required />
          <Field label="Resultado esperado (opcional)" name="newSubgoalExpected" value={newSubgoalExpectedResult} onChange={(event) => setNewSubgoalExpectedResult(event.target.value)} />
          <Field label="Fecha objetivo (opcional)" name="newSubgoalTargetDate" type="date" value={newSubgoalTargetDate} onChange={(event) => setNewSubgoalTargetDate(event.target.value)} />
          <div className="task-editor-actions"><button type="button" className="button task-editor-cancel" onClick={closeSubgoalModal} disabled={busy}>Cancelar</button><button type="submit" className="button button-primary" disabled={busy || !newSubgoalGoalId || !newSubgoalTitle.trim()}>{busy ? 'Guardando…' : 'Crear submeta'} <span>→</span></button></div>
        </form>
      </section>
    </div>}

    {editingSubgoal && <div className="task-editor-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setEditingSubgoal(null); }} onKeyDown={(event) => { if (event.key === 'Escape' && !busy) setEditingSubgoal(null); }}>
      <section className="task-editor-dialog floating-form-dialog" role="dialog" aria-modal="true" aria-labelledby="subgoal-editor-title">
        <div className="task-editor-heading"><div><div className="eyebrow">DESGLOSA TU META</div><h2 id="subgoal-editor-title">Editar submeta</h2></div><button type="button" className="task-editor-close" onClick={() => setEditingSubgoal(null)} disabled={busy} aria-label="Cerrar submeta">×</button></div>
        <form className="task-editor-form" onSubmit={saveSubgoal}>
          <Field label="Nombre de la submeta" name="subgoalTitle" value={subgoalTitle} onChange={(event) => setSubgoalTitle(event.target.value)} required />
          <Field label="Resultado esperado (opcional)" name="subgoalExpectedResult" value={subgoalExpectedResult} onChange={(event) => setSubgoalExpectedResult(event.target.value)} />
          <Field label="Fecha objetivo (opcional)" name="subgoalTargetDate" type="date" value={subgoalTargetDate} onChange={(event) => setSubgoalTargetDate(event.target.value)} />
          <div className="task-editor-actions"><button type="button" className="button task-editor-cancel" onClick={() => setEditingSubgoal(null)} disabled={busy}>Cancelar</button><button type="submit" className="button button-primary" disabled={busy || !subgoalTitle.trim()}>Guardar cambios <span>→</span></button></div>
        </form>
      </section>
    </div>}
  </>;
}
function StatusTag({ status }) {
  const labels = { draft: 'Borrador', planning: 'En planificación', todo: 'Pendiente', in_progress: 'En curso', blocked: 'Bloqueada', active: 'Activa', paused: 'En pausa', completed: 'Completada', cancelled: 'Cancelada' };
  return <span className={`status-tag status-${status}`}>{labels[status] || status}</span>;
}
function ProjectStatusTag({ status, archived = false }) {
  if (archived) return <span className="status-tag status-archived">Archivado</span>;
  const labels = { planning: 'En planificación', active: 'En marcha', paused: 'En pausa', completed: 'Completado', cancelled: 'Cancelado' };
  return <span className={`status-tag status-${status}`}>{labels[status] || status}</span>;
}

function ProjectsPage({ profile, refreshKey, runAction, busy, setActivePage, setMorePage }) {
  const { rows: projects, loading, localError } = useRows('project', profile, refreshKey, (query) => query.is('deleted_at', null).order('created_at', { ascending: false }));
  const { rows: links } = useRows('task_project_link', profile, refreshKey);
  const { rows: tasks } = useRows('task', profile, refreshKey, (query) => query.is('deleted_at', null));
  const { rows: goals } = useRows('goal', profile, refreshKey, (query) => query.is('deleted_at', null));
  const { rows: subgoals } = useRows('subgoal', profile, refreshKey, (query) => query.is('deleted_at', null));
  const { rows: contributionRelations } = useRows('contribution_relation', profile, refreshKey);
  const [name, setName] = useState('');
  const [purpose, setPurpose] = useState('');
  const [startDate, setStartDate] = useState('');
  const [targetDate, setTargetDate] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [lifecycleFilter, setLifecycleFilter] = useState('active');
  const [sortBy, setSortBy] = useState('recent');
  const [editingProject, setEditingProject] = useState(null);
  const [editName, setEditName] = useState('');
  const [editPurpose, setEditPurpose] = useState('');
  const [editStartDate, setEditStartDate] = useState('');
  const [editTargetDate, setEditTargetDate] = useState('');
  const [editStatus, setEditStatus] = useState('planning');
  const [selectedProject, setSelectedProject] = useState(null);
  const [showRelationForm, setShowRelationForm] = useState(false);
  const [relationTarget, setRelationTarget] = useState('');
  const [showNewProject, setShowNewProject] = useState(false);
  const closeNewProject = () => {
    if (busy) return;
    setShowNewProject(false);
    setName(''); setPurpose(''); setStartDate(''); setTargetDate('');
  };

  const visibleProjects = useMemo(() => {
    const term = search.trim().toLocaleLowerCase('es');
    const filtered = projects.filter((project) => {
      const lifecycleMatches = lifecycleFilter === 'all'
        || (lifecycleFilter === 'active' && !project.archived_at)
        || (lifecycleFilter === 'archived' && Boolean(project.archived_at));
      // Work-state filters apply only to projects that are not archived.
      const statusMatches = statusFilter === 'all' || (!project.archived_at && project.status === statusFilter);
      const searchMatches = !term || `${project.name || ''} ${project.purpose || ''}`.toLocaleLowerCase('es').includes(term);
      return lifecycleMatches && statusMatches && searchMatches;
    });
    const compareTarget = (a, b) => {
      if (!a.target_date && !b.target_date) return 0;
      if (!a.target_date) return 1;
      if (!b.target_date) return -1;
      return String(a.target_date).localeCompare(String(b.target_date));
    };
    filtered.sort((a, b) => {
      if (sortBy === 'name') return String(a.name || '').localeCompare(String(b.name || ''), 'es');
      if (sortBy === 'target') return compareTarget(a, b) || String(a.name || '').localeCompare(String(b.name || ''), 'es');
      return String(b.created_at || '').localeCompare(String(a.created_at || ''));
    });
    return filtered;
  }, [projects, search, statusFilter, lifecycleFilter, sortBy]);

  const openEditor = (project) => {
    setEditingProject(project);
    setEditName(project.name || '');
    setEditPurpose(project.purpose || '');
    setEditStartDate(project.start_date || '');
    setEditTargetDate(project.target_date || '');
    setEditStatus(project.status || 'planning');
  };

  const addProject = async (event) => {
    event.preventDefault();
    if (!name.trim()) return;
    if (startDate && targetDate && startDate > targetDate) {
      await runAction(async () => { throw new Error('La fecha de inicio no puede ser posterior a la fecha objetivo.'); });
      return;
    }
    await runAction(async () => {
      const { error: insertError } = await supabase.from('project').insert({
        id: uuidv7(), owner_user_id: profile.id, created_by_user_id: profile.id,
        name: name.trim(), purpose: purpose.trim() || null,
        start_date: startDate || null, target_date: targetDate || null, status: 'active',
      });
      if (insertError) throw insertError;
      setName(''); setPurpose(''); setStartDate(''); setTargetDate('');
      setShowNewProject(false);
    }, 'Proyecto creado.');
  };

  const saveProject = async (event) => {
    event.preventDefault();
    if (!editingProject || !editName.trim()) return;
    if (editStartDate && editTargetDate && editStartDate > editTargetDate) {
      await runAction(async () => { throw new Error('La fecha de inicio no puede ser posterior a la fecha objetivo.'); });
      return;
    }
    await runAction(async () => {
      const projectUpdates = {
        name: editName.trim(),
        purpose: editPurpose.trim() || null,
        start_date: editStartDate || null,
        target_date: editTargetDate || null,
      };
      // Preserve work status while archived; it becomes editable again after restoration.
      if (!editingProject.archived_at) projectUpdates.status = editStatus;
      const { data, error: updateError } = await supabase.from('project').update(projectUpdates)
        .eq('id', editingProject.id).eq('owner_user_id', profile.id).is('deleted_at', null).select('id');
      if (updateError) throw updateError;
      if (!data?.length) throw new Error('No se pudo actualizar el proyecto. Puede que ya no exista o no pertenezca a esta cuenta.');
      setEditingProject(null);
    }, 'Proyecto actualizado.');
  };

  const toggleArchive = (project) => runAction(async () => {
    const archive = !project.archived_at;
    const { data, error: updateError } = await supabase.from('project')
      .update({ archived_at: archive ? new Date().toISOString() : null })
      .eq('id', project.id)
      .eq('owner_user_id', profile.id)
      .is('deleted_at', null)
      .select('id');
    if (updateError) throw updateError;
    if (!data?.length) throw new Error('No se pudo cambiar el archivo del proyecto. Actualiza la vista e inténtalo de nuevo.');
  }, project.archived_at ? 'Proyecto restaurado.' : 'Proyecto archivado.');

  const projectRelations = selectedProject
    ? contributionRelations.filter((relation) => relation.project_id === selectedProject.id && relation.relation_status === 'confirmed')
    : [];
  const relationTargetIsLinked = (() => {
    if (!relationTarget || !selectedProject) return false;
    const [kind, id] = relationTarget.split(':');
    return contributionRelations.some((relation) => relation.project_id === selectedProject.id
      && relation.relation_status === 'confirmed'
      && (kind === 'goal' ? relation.goal_id === id && !relation.subgoal_id : relation.subgoal_id === id && !relation.goal_id));
  })();

  const saveProjectRelation = async (event) => {
    event.preventDefault();
    if (!selectedProject || selectedProject.archived_at || !relationTarget) return;
    const [kind, targetId] = relationTarget.split(':');
    if (!['goal', 'subgoal'].includes(kind) || !targetId) return;
    const targetField = kind === 'goal' ? 'goal_id' : 'subgoal_id';
    const otherField = kind === 'goal' ? 'subgoal_id' : 'goal_id';
    const existing = contributionRelations.find((relation) => relation.project_id === selectedProject.id
      && relation[targetField] === targetId && !relation[otherField]);
    const saved = await runAction(async () => {
      if (existing) {
        if (existing.relation_status === 'confirmed') throw new Error('Este elemento ya está vinculado a este proyecto.');
        const { data, error } = await supabase.from('contribution_relation').update({ relation_status: 'confirmed' })
          .eq('id', existing.id).eq('project_id', selectedProject.id).select('id');
        if (error) throw error;
        if (!data?.length) throw new Error('No se pudo restaurar el vínculo. Actualiza la vista e inténtalo de nuevo.');
      } else {
        const payload = {
          id: uuidv7(), project_id: selectedProject.id, [targetField]: targetId,
          relation_status: 'confirmed', created_by_user_id: profile.id,
        };
        const { data, error } = await supabase.from('contribution_relation').insert(payload).select('id');
        if (error) throw error;
        if (!data?.length) throw new Error('No se pudo crear el vínculo entre el proyecto y el objetivo.');
      }
    }, existing ? 'Vínculo restaurado.' : kind === 'goal' ? 'Meta vinculada al proyecto.' : 'Submeta vinculada al proyecto.');
    if (saved) { setShowRelationForm(false); setRelationTarget(''); }
  };

  const removeProjectRelation = (relation) => runAction(async () => {
    const { data, error } = await supabase.from('contribution_relation').update({ relation_status: 'removed' })
      .eq('id', relation.id).eq('project_id', selectedProject.id).select('id');
    if (error) throw error;
    if (!data?.length) throw new Error('No se pudo desvincular el objetivo. Actualiza la vista e inténtalo de nuevo.');
  }, relation.goal_id ? 'Meta desvinculada del proyecto.' : 'Submeta desvinculada del proyecto.');

  const projectTaskRows = selectedProject
    ? tasks.filter((task) => links.some((link) => link.project_id === selectedProject.id && link.task_id === task.id))
      .sort((a, b) => String(a.due_date || '9999-12-31').localeCompare(String(b.due_date || '9999-12-31')))
    : [];
  const taskCounts = {
    total: projectTaskRows.length,
    completed: projectTaskRows.filter((task) => task.status === 'completed').length,
    blocked: projectTaskRows.filter((task) => task.status === 'blocked').length,
    active: projectTaskRows.filter((task) => ['todo', 'in_progress'].includes(task.status)).length,
  };

  return <>
    <div className="management-layout management-layout-single">
      <div className="content-main">
        <div className="section-heading-row">
          <SectionTitle detail={`${visibleProjects.length} de ${projects.length} proyectos`}>
            {lifecycleFilter === 'archived' ? 'Proyectos archivados' : lifecycleFilter === 'all' ? 'Todos los proyectos' : 'Proyectos sin archivar'}
          </SectionTitle>
          <div className="section-create-actions"><button type="button" className="section-create-button" onClick={() => setShowNewProject(true)}>Nuevo Proyecto</button></div>
        </div>
        <div className="project-toolbar" aria-label="Buscar y organizar proyectos">
          <label className="project-toolbar-field project-search-field">
            <span>Buscar</span>
            <input aria-label="Buscar proyectos" type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Nombre o propósito…" />
          </label>
          <label className="project-toolbar-field">
            <span>Estado de trabajo</span>
            <select aria-label="Filtrar por estado de trabajo" value={statusFilter} disabled={lifecycleFilter === 'archived'} onChange={(event) => setStatusFilter(event.target.value)}>
              <option value="all">Todos</option>
              <option value="planning">Planificación</option>
              <option value="active">En marcha</option>
              <option value="paused">En pausa</option>
              <option value="completed">Completados</option>
              <option value="cancelled">Cancelados</option>
            </select>
          </label>
          <label className="project-toolbar-field">
            <span>Archivo</span>
            <select aria-label="Filtrar proyectos por archivo" value={lifecycleFilter} onChange={(event) => { const nextValue = event.target.value; setLifecycleFilter(nextValue); if (nextValue === 'archived') setStatusFilter('all'); }}>
              <option value="active">Sin archivar</option>
              <option value="archived">Archivados</option>
              <option value="all">Todos</option>
            </select>
          </label>
          <label className="project-toolbar-field">
            <span>Ordenar</span>
            <select aria-label="Ordenar proyectos" value={sortBy} onChange={(event) => setSortBy(event.target.value)}>
              <option value="recent">Más recientes</option>
              <option value="name">Nombre</option>
              <option value="target">Fecha objetivo</option>
            </select>
          </label>
        </div>
        {loading ? <p className="muted">Cargando…</p> : localError ? <div className="form-error">{localError}</div> : visibleProjects.length ? (
          <div className="project-grid">
            {visibleProjects.map((project) => {
              const count = tasks.filter((task) => links.some((link) => link.project_id === project.id && link.task_id === task.id)).length;
              return <article className={`project-card ${project.archived_at ? 'project-card-archived' : ''}`} key={project.id}>
                <button type="button" className="project-open-button" onClick={() => setSelectedProject(project)} aria-label={`Ver proyecto: ${project.name}`}>
                  <div className="project-cover"><span>✳</span><small>{project.target_date ? `Hasta ${formatDate(project.target_date)}` : 'Sin fecha objetivo'}</small></div>
                  <div className="project-body"><ProjectStatusTag status={project.status} archived={Boolean(project.archived_at)} /><h3>{project.name}</h3><p>{project.purpose || 'Un espacio para convertir una intención en acciones concretas.'}</p><div className="project-foot"><span>{count} tareas vinculadas</span><span>Ver proyecto ↗</span></div></div>
                </button>
                <div className="project-card-actions">
                  <button type="button" className="project-action-button" onClick={() => openEditor(project)} disabled={busy} aria-label={`Editar proyecto: ${project.name}`}>Editar</button>
                  <button type="button" className="project-action-button" onClick={() => toggleArchive(project)} disabled={busy} aria-label={`${project.archived_at ? 'Restaurar' : 'Archivar'} proyecto: ${project.name}`}>{project.archived_at ? 'Restaurar' : 'Archivar'}</button>
                </div>
              </article>;
            })}
          </div>
        ) : projects.length ? <EmptyState title="No hay coincidencias" detail="Prueba otra búsqueda o cambia los filtros de proyectos." icon="⌕" /> : <EmptyState title="Todavía no hay proyectos" detail="Crea uno para organizar tareas alrededor de un resultado concreto." icon="▤" />}
      </div>
    </div>

    {showNewProject && (
      <div className="task-editor-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) closeNewProject(); }} onKeyDown={(event) => { if (event.key === 'Escape' && !busy) closeNewProject(); }}>
        <section className="task-editor-dialog floating-form-dialog" role="dialog" aria-modal="true" aria-labelledby="project-create-title">
          <div className="task-editor-heading">
            <div><div className="eyebrow">CONVIERTE UNA INTENCIÓN EN ACCIONES</div><h2 id="project-create-title">Nuevo proyecto</h2></div>
            <button type="button" className="task-editor-close" onClick={closeNewProject} disabled={busy} aria-label="Cerrar nuevo proyecto">×</button>
          </div>
          <form className="task-editor-form" onSubmit={addProject}>
            <Field label="Nombre" name="project" value={name} onChange={(event) => setName(event.target.value)} placeholder="Ej. Lanzar mi negocio" required autoFocus />
            <TextAreaField label="Propósito (opcional)" name="purpose" value={purpose} onChange={(event) => setPurpose(event.target.value)} placeholder="¿Qué quieres conseguir?" rows={3} />
            <Field label="Fecha de inicio (opcional)" name="start" type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} />
            <Field label="Fecha objetivo (opcional)" name="target" type="date" value={targetDate} onChange={(event) => setTargetDate(event.target.value)} />
            <p className="project-form-note">La fecha objetivo debe ser igual o posterior al inicio.</p>
            <div className="task-editor-actions">
              <button type="button" className="button task-editor-cancel" onClick={closeNewProject} disabled={busy}>Cancelar</button>
              <button type="submit" className="button button-primary" disabled={busy || !name.trim()}>{busy ? 'Guardando…' : 'Crear proyecto'} <span>→</span></button>
            </div>
          </form>
        </section>
      </div>
    )}

    {editingProject && (
      <div className="task-editor-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setEditingProject(null); }}>
        <section className="task-editor-dialog" role="dialog" aria-modal="true" aria-labelledby="project-editor-title">
          <div className="task-editor-heading">
            <div><div className="eyebrow">ACTUALIZA TU PLAN</div><h2 id="project-editor-title">Editar proyecto</h2></div>
            <button type="button" className="task-editor-close" onClick={() => setEditingProject(null)} disabled={busy} aria-label="Cerrar edición del proyecto">×</button>
          </div>
          <form className="task-editor-form" onSubmit={saveProject}>
            <Field label="Nombre del proyecto" name="editProjectName" value={editName} onChange={(event) => setEditName(event.target.value)} required />
            <TextAreaField label="Propósito (opcional)" name="editProjectPurpose" value={editPurpose} onChange={(event) => setEditPurpose(event.target.value)} rows={3} />
            <Field label="Fecha de inicio (opcional)" name="editProjectStart" type="date" value={editStartDate} onChange={(event) => setEditStartDate(event.target.value)} />
            <Field label="Fecha objetivo (opcional)" name="editProjectTarget" type="date" value={editTargetDate} onChange={(event) => setEditTargetDate(event.target.value)} />
            {!editingProject.archived_at
              ? <label className="field"><span>Estado de trabajo</span><select aria-label="Estado de trabajo" value={editStatus} onChange={(event) => setEditStatus(event.target.value)}>
                  <option value="planning">En planificación</option><option value="active">En marcha</option><option value="paused">En pausa</option><option value="completed">Completado</option><option value="cancelled">Cancelado</option>
                </select></label>
              : <p className="task-editor-note">Este proyecto está archivado. Su estado de trabajo se conserva y volverá a estar disponible al restaurarlo.</p>}
            <p className="task-editor-note">Editar el proyecto no cambia sus tareas vinculadas ni elimina relaciones.</p>
            <div className="task-editor-actions"><button type="button" className="button task-editor-cancel" onClick={() => setEditingProject(null)} disabled={busy}>Cancelar</button><button type="submit" className="button button-primary" disabled={busy || !editName.trim()}>{busy ? 'Guardando…' : 'Guardar cambios'} <span>→</span></button></div>
          </form>
        </section>
      </div>
    )}

    {selectedProject && (
      <div className="task-editor-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedProject(null); }}>
        <section className="task-editor-dialog project-detail-dialog" role="dialog" aria-modal="true" aria-labelledby="project-detail-title">
          <div className="task-editor-heading">
            <div><div className="eyebrow">DETALLE DEL PROYECTO</div><h2 id="project-detail-title">{selectedProject.name}</h2></div>
            <button type="button" className="task-editor-close" onClick={() => setSelectedProject(null)} aria-label="Cerrar detalle del proyecto">×</button>
          </div>
          <div className="project-detail-meta"><ProjectStatusTag status={selectedProject.status} archived={Boolean(selectedProject.archived_at)} /><span>{selectedProject.start_date ? `Inicio: ${formatDate(selectedProject.start_date)}` : 'Sin fecha de inicio'}</span><span>{selectedProject.target_date ? `Objetivo: ${formatDate(selectedProject.target_date)}` : 'Sin fecha objetivo'}</span></div>
          {selectedProject.purpose && <p className="project-detail-purpose">{selectedProject.purpose}</p>}
          <div className="project-task-summary"><div><strong>{taskCounts.total}</strong><small>Tareas vinculadas</small></div><div><strong>{taskCounts.active}</strong><small>Abiertas</small></div><div><strong>{taskCounts.completed}</strong><small>Completadas</small></div><div><strong>{taskCounts.blocked}</strong><small>Bloqueadas</small></div></div>
          <div className="project-detail-section project-goal-link-section">
            <div className="project-relation-heading"><strong>Metas y submetas vinculadas</strong><button type="button" className="text-button" disabled={Boolean(selectedProject.archived_at) || busy} onClick={() => setShowRelationForm((visible) => !visible)}>{showRelationForm ? 'Cancelar' : 'Vincular meta o submeta'}</button></div>
            {projectRelations.length ? <div className="project-relation-list">{projectRelations.map((relation) => {
              const goal = relation.goal_id ? goals.find((row) => row.id === relation.goal_id) : null;
              const subgoal = relation.subgoal_id ? subgoals.find((row) => row.id === relation.subgoal_id) : null;
              const parentGoal = subgoal ? goals.find((row) => row.id === subgoal.goal_id) : null;
              const label = goal ? 'Meta' : 'Submeta';
              const title = goal?.title || subgoal?.title || 'Objetivo no disponible';
              return <div className="project-relation-row" key={relation.id}>
                <div><span>{label}</span><strong>{title}</strong>{parentGoal && <small>Meta: {parentGoal.title}</small>}</div>
                <button type="button" className="text-button" disabled={busy || Boolean(selectedProject.archived_at)} onClick={() => removeProjectRelation(relation)} aria-label={'Desvincular ' + label.toLowerCase() + ': ' + title}>Desvincular</button>
              </div>;
            })}</div> : <p className="muted">Este proyecto todavía no está vinculado a ninguna meta o submeta.</p>}
            {showRelationForm && <form className="project-relation-form" onSubmit={saveProjectRelation}>
              <label className="field"><span>Meta o submeta</span><select aria-label="Seleccionar meta o submeta" required value={relationTarget} onChange={(event) => setRelationTarget(event.target.value)}>
                <option value="">Selecciona un objetivo</option>
                <optgroup label="Metas">{goals.map((goal) => <option key={goal.id} value={'goal:' + goal.id}>{goal.title}</option>)}</optgroup>
                <optgroup label="Submetas">{subgoals.map((subgoal) => {
                  const parentGoal = goals.find((goal) => goal.id === subgoal.goal_id);
                  return <option key={subgoal.id} value={'subgoal:' + subgoal.id}>{subgoal.title} — {parentGoal?.title || 'Meta'}</option>;
                })}</optgroup>
              </select></label>
              {relationTargetIsLinked && <p className="task-editor-note">Este objetivo ya está vinculado a este proyecto.</p>}
              <button type="submit" className="button button-primary" disabled={busy || !relationTarget || relationTargetIsLinked}>Vincular relación <span>→</span></button>
            </form>}
          </div>
          <div className="project-detail-section"><strong>Tareas del proyecto</strong>
            {projectTaskRows.length ? <div className="project-detail-task-list">{projectTaskRows.map((task) => {
              const taskLink = links.find((link) => link.task_id === task.id && link.project_id === selectedProject.id);
              return <div className="project-detail-task" key={task.id}><div><b>{task.action}</b><small>{task.due_date ? `Fecha: ${formatDate(task.due_date)}` : 'Sin fecha'}</small><small className="project-task-role">{taskLink?.relation_role === 'primary' ? 'Proyecto principal de esta tarea' : 'Proyecto adicional de esta tarea'}</small></div><StatusTag status={task.status} /></div>;
            })}</div> : <p className="muted">Todavía no hay tareas vinculadas a este proyecto.</p>}
          </div>
          <div className="task-editor-actions"><button type="button" className="button task-editor-cancel" onClick={() => setSelectedProject(null)}>Cerrar</button><button type="button" className="button button-primary" onClick={() => { setSelectedProject(null); setActivePage('more'); setMorePage('tasks'); }}>Ir a Tareas <span>→</span></button></div>
        </section>
      </div>
    )}
  </>;
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
