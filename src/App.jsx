import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { isSupabaseConfigured, supabase } from './lib/supabase.js';
import { ensureUserProfile } from './lib/profile.js';
import { uuidv7 } from './lib/uuidv7.js';

const NAV = [
  { id: 'today', label: 'Hoy', icon: '☀️' },
  { id: 'inbox', label: 'Inbox', icon: '↳' },
  { id: 'goals', label: 'Objetivos', icon: '◎' },
  { id: 'projects', label: 'Proyectos', icon: '▤' },
  { id: 'more', label: 'Más', icon: '•••' },
];

const todayInHavana = () => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Havana', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date());

const formatDate = (value) => {
  if (!value) return 'Sin fecha';
  const date = new Date(`${value}T12:00:00`);
  return new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short' }).format(date);
};

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
    } catch (actionError) {
      showError(actionError?.message || 'No se pudo completar la operación.');
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
        {activePage === 'more' && (
          <div className="more-links">
            <button className={morePage === 'tasks' ? 'selected' : ''} onClick={() => setMorePage('tasks')}>Tareas</button>
            <button className={morePage === 'notes' ? 'selected' : ''} onClick={() => setMorePage('notes')}>Notas e ideas</button>
            <button className={morePage === 'lists' ? 'selected' : ''} onClick={() => setMorePage('lists')}>Listas</button>
          </div>
        )}
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

          {(notice || error) && <div className={`alert ${error ? 'alert-error' : 'alert-success'}`}>{error || notice}<button onClick={() => { setError(''); setNotice(''); }}>×</button></div>}

          {activePage === 'today' && <TodayPage profile={profile} refreshKey={refreshKey} runAction={runAction} busy={busy} setActivePage={setActivePage} />}
          {activePage === 'inbox' && <InboxPage profile={profile} refreshKey={refreshKey} runAction={runAction} busy={busy} />}
          {activePage === 'goals' && <GoalsPage profile={profile} refreshKey={refreshKey} runAction={runAction} busy={busy} />}
          {activePage === 'projects' && <ProjectsPage profile={profile} refreshKey={refreshKey} runAction={runAction} busy={busy} setActivePage={setActivePage} setMorePage={setMorePage} />}
          {activePage === 'more' && morePage === 'tasks' && <TasksPage profile={profile} refreshKey={refreshKey} runAction={runAction} busy={busy} />}
          {activePage === 'more' && morePage === 'notes' && <NotesPage profile={profile} refreshKey={refreshKey} runAction={runAction} busy={busy} />}
          {activePage === 'more' && morePage === 'lists' && <ListsPage profile={profile} refreshKey={refreshKey} runAction={runAction} busy={busy} />}
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

function Field({ label, name, type = 'text', placeholder, required = false, autoComplete, minLength, value, onChange, autoFocus = false }) {
  return <label className="field"><span>{label}</span><input name={name} type={type} placeholder={placeholder} required={required} autoComplete={autoComplete} minLength={minLength} value={value} onChange={onChange} autoFocus={autoFocus} /></label>;
}
function TextAreaField({ label, name, placeholder, required = false, rows = 3, value, onChange }) {
  return <label className="field"><span>{label}</span><textarea name={name} placeholder={placeholder} required={required} rows={rows} value={value} onChange={onChange} /></label>;
}
function SectionTitle({ children, detail }) { return <div className="section-title"><h2>{children}</h2>{detail && <span>{detail}</span>}</div>; }
function EmptyState({ title, detail, icon = '✳' }) { return <div className="empty-state"><div>{icon}</div><strong>{title}</strong><p>{detail}</p></div>; }
function FormCard({ title, children, onSubmit, submitLabel = 'Guardar', busy = false, className = '' }) {
  return <form className={`form-card ${className}`} onSubmit={onSubmit}><div className="form-card-title">{title}</div>{children}<button className="button button-primary" type="submit" disabled={busy}>{busy ? 'Guardando…' : submitLabel} <span>→</span></button></form>;
}

function useRows(table, profile, refreshKey, configure = null) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [localError, setLocalError] = useState('');
  useEffect(() => {
    let alive = true;
    const load = async () => {
      setLoading(true);
      setLocalError('');
      try {
        let query = supabase.from(table).select('*');
        query = configure ? configure(query) : query;
        const { data, error: queryError } = await query;
        if (queryError) throw queryError;
        if (alive) setRows(data || []);
      } catch (queryError) {
        if (alive) setLocalError(queryError.message || 'No se pudieron cargar los datos.');
      } finally {
        if (alive) setLoading(false);
      }
    };
    if (profile?.id) void load();
    return () => { alive = false; };
  }, [table, profile?.id, refreshKey]);
  return { rows, loading, localError, setRows };
}

function TodayPage({ profile, refreshKey, runAction, busy, setActivePage }) {
  const { rows: tasks, loading, localError } = useRows('task', profile, refreshKey, (query) => query
    .is('deleted_at', null).is('archived_at', null)
    .not('status', 'in', '(completed,cancelled)')
    .order('priority', { ascending: true }).order('created_at', { ascending: false }).limit(40));
  const today = todayInHavana();
  const dueToday = tasks.filter((task) => task.due_date === today);
  const nextTasks = tasks.filter((task) => task.due_date !== today).slice(0, 6);

  const completeTask = (task) => runAction(async () => {
    const { error: updateError } = await supabase.from('task').update({ status: 'completed', completed_at: new Date().toISOString(), completion_outcome: 'complete' }).eq('id', task.id);
    if (updateError) throw updateError;
  }, 'Tarea completada.');

  return <>
    <div className="today-grid">
      <div className="today-main-card">
        <div className="card-kicker">TU FOCO DE HOY</div>
        <div className="focus-headline">Haz que hoy<br /><em>cuente.</em></div>
        <p>Elige una acción importante y avanza sin complicarte.</p>
        <button className="button button-light" onClick={() => setActivePage('inbox')}>Vaciar mi mente <span>↗</span></button>
        <div className="card-sprout">✳</div>
      </div>
      <div className="daily-summary">
        <div className="summary-card"><span>EN TU LISTA</span><strong>{tasks.length}</strong><small>tareas abiertas</small></div>
        <div className="summary-card summary-soft"><span>PARA HOY</span><strong>{dueToday.length}</strong><small>con fecha de hoy</small></div>
      </div>
    </div>

    <div className="content-grid">
      <div className="content-main">
        <SectionTitle detail={`${dueToday.length} ${dueToday.length === 1 ? 'elemento' : 'elementos'}`}>Para hoy</SectionTitle>
        {loading ? <p className="muted">Cargando tareas…</p> : localError ? <div className="form-error">{localError}</div> : dueToday.length ? <div className="task-list">{dueToday.map((task) => <TaskRow key={task.id} task={task} onComplete={() => completeTask(task)} busy={busy} />)}</div> : <EmptyState title="Tu día está despejado" detail="Las tareas que captures aparecerán aquí cuando tengan fecha de hoy." icon="☀️" />}
        <div className="section-spacer" />
        <SectionTitle detail="Pendientes activos">Siguiente</SectionTitle>
        {loading ? <p className="muted">Cargando…</p> : nextTasks.length ? <div className="task-list">{nextTasks.map((task) => <TaskRow key={task.id} task={task} onComplete={() => completeTask(task)} busy={busy} />)}</div> : <EmptyState title="Sin pendientes" detail="Has despejado tu lista. Captura una nueva acción cuando lo necesites." icon="✓" />}
      </div>
      <aside className="content-side">
        <div className="side-card"><div className="side-card-icon">↳</div><strong>Inbox universal</strong><p>Guarda cualquier idea o pendiente antes de que se te olvide.</p><button className="text-button" onClick={() => setActivePage('inbox')}>Abrir Inbox →</button></div>
        <div className="side-card side-card-tint"><div className="side-card-icon">◎</div><strong>Una vida con dirección</strong><p>Conecta tus acciones con metas que realmente importan.</p><button className="text-button" onClick={() => setActivePage('goals')}>Ver objetivos →</button></div>
      </aside>
    </div>
  </>;
}

function TaskRow({ task, onComplete, busy }) {
  return <div className="task-row"><button className="task-check" onClick={onComplete} disabled={busy} aria-label="Completar tarea"/><div className="task-row-copy"><strong>{task.action}</strong><small>{task.due_date ? `Para ${formatDate(task.due_date)}` : 'Sin fecha definida'} {task.estimated_duration_minutes ? `· ${task.estimated_duration_minutes} min` : ''}</small></div><span className={`priority priority-${task.priority}`}>{task.priority <= 2 ? 'Alta' : task.priority === 3 ? 'Normal' : 'Baja'}</span></div>;
}

function InboxPage({ profile, refreshKey, runAction, busy }) {
  const { rows, loading, localError } = useRows('capture', profile, refreshKey, (query) => query
    .is('deleted_at', null).order('captured_at', { ascending: false }).limit(50));
  const [captureSearch, setCaptureSearch] = useState('');
  const [attentionFilter, setAttentionFilter] = useState('needs_review');

  const visibleCaptures = useMemo(() => {
    const term = captureSearch.trim().toLocaleLowerCase('es');
    return rows.filter((capture) => {
      const statusMatches = attentionFilter === 'all' || capture.attention_status === attentionFilter;
      const searchMatches = !term || String(capture.content_original || '').toLocaleLowerCase('es').includes(term);
      return statusMatches && searchMatches;
    });
  }, [rows, captureSearch, attentionFilter]);

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
      if (partError) throw new Error(`La captura se guardó, pero falta preparar su fragmento: ${partError.message}`);
      formElement.reset();
    }, 'Captura guardada.');
  };

  const attentionLabels = {
    needs_review: 'Pendiente de revisión',
    reviewed: 'Revisada',
    archived: 'Archivada',
  };

  return <div className="inbox-layout">
    <div className="inbox-composer"><div className="composer-top"><span className="composer-icon">↳</span><div><strong>Sácalo de tu cabeza.</strong><p>Una frase basta. No necesitas organizarla ahora.</p></div></div>
      <form onSubmit={submit}><textarea name="capture" rows="4" placeholder="Escribe aquí lo que tienes en mente…" required /><div className="composer-bottom"><span>✦ El original se conserva sin alteraciones.</span><button className="button button-primary" disabled={busy}>Guardar captura <span>→</span></button></div></form>
    </div>
    <div className="inbox-list-wrap">
      <SectionTitle detail={`${visibleCaptures.length} de ${rows.length} capturas`}>Capturado recientemente</SectionTitle>
      <div className="capture-toolbar" aria-label="Buscar y revisar capturas">
        <label className="capture-toolbar-field capture-search-field">
          <span>Buscar</span>
          <input aria-label="Buscar capturas" type="search" value={captureSearch} onChange={(event) => setCaptureSearch(event.target.value)} placeholder="Buscar en el contenido original…" />
        </label>
        <label className="capture-toolbar-field">
          <span>Revisión</span>
          <select aria-label="Filtrar capturas por revisión" value={attentionFilter} onChange={(event) => setAttentionFilter(event.target.value)}>
            <option value="needs_review">Pendientes</option>
            <option value="reviewed">Revisadas</option>
            <option value="archived">Archivadas</option>
            <option value="all">Todas</option>
          </select>
        </label>
      </div>
      {loading ? <p className="muted">Cargando…</p> : localError ? <div className="form-error">{localError}</div> : rows.length ? visibleCaptures.length ? (
        <div className="capture-list">{visibleCaptures.map((capture) => (
          <div className={`capture-row capture-row-${capture.attention_status}`} key={capture.id}>
            <span className="capture-bullet">✳</span>
            <div className="capture-row-content">
              <p>{capture.content_original}</p>
              <small>{new Intl.DateTimeFormat('es', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Havana' }).format(new Date(capture.captured_at))}</small>
              <div className="capture-row-actions">
                <span className={`capture-status capture-status-${capture.attention_status}`}>{attentionLabels[capture.attention_status] || 'Pendiente de revisión'}</span>
                {capture.attention_status === 'archived' ? (
                  <button type="button" className="capture-action-button" disabled={busy} onClick={() => updateAttention(capture, 'needs_review')} aria-label={`Restaurar captura: ${capture.content_original}`}>Restaurar</button>
                ) : (
                  <>
                    <button
                      type="button"
                      className="capture-action-button"
                      disabled={busy}
                      onClick={() => updateAttention(capture, capture.attention_status === 'reviewed' ? 'needs_review' : 'reviewed')}
                      aria-label={capture.attention_status === 'reviewed' ? `Volver a pendientes: ${capture.content_original}` : `Marcar revisada: ${capture.content_original}`}
                    >{capture.attention_status === 'reviewed' ? 'Volver a pendientes' : 'Marcar revisada'}</button>
                    <button type="button" className="capture-action-button capture-archive-button" disabled={busy} onClick={() => updateAttention(capture, 'archived')} aria-label={`Archivar captura: ${capture.content_original}`}>Archivar</button>
                  </>
                )}
              </div>
            </div>
          </div>
        ))}</div>
      ) : <EmptyState title="No hay coincidencias" detail="Cambia la búsqueda o el filtro para encontrar otras capturas." icon="⌕" />
      : <EmptyState title="El Inbox está vacío" detail="Empieza escribiendo cualquier cosa que no quieras olvidar." /> }
    </div>
    <div className="honest-note"><span>ⓘ</span><p>La clasificación automática con IA todavía no está conectada. Por ahora, SimpleLife conserva tus capturas y sus fragmentos originales sin inventar una interpretación. Revisar o archivar una captura no modifica ni elimina su contenido original.</p></div>
  </div>;
}

function GoalsPage({ profile, refreshKey, runAction, busy }) {
  const { rows: areas, loading, localError } = useRows('life_area', profile, refreshKey, (query) => query.is('deleted_at', null).order('position').order('created_at'));
  const { rows: goals } = useRows('goal', profile, refreshKey, (query) => query.is('deleted_at', null).order('created_at', { ascending: false }));
  const { rows: subgoals } = useRows('subgoal', profile, refreshKey, (query) => query.is('deleted_at', null).order('created_at'));
  const [areaTitle, setAreaTitle] = useState('');
  const [areaDescription, setAreaDescription] = useState('');
  const [editingArea, setEditingArea] = useState(null);
  const [selectedArea, setSelectedArea] = useState('');
  const [goalTitle, setGoalTitle] = useState('');
  const [goalReason, setGoalReason] = useState('');
  const [expectedResult, setExpectedResult] = useState('');
  const [targetDate, setTargetDate] = useState('');
  const [editingGoal, setEditingGoal] = useState(null);
  const [subgoalDraft, setSubgoalDraft] = useState({});
  const [editingSubgoal, setEditingSubgoal] = useState(null);
  const [subgoalTitle, setSubgoalTitle] = useState('');
  const [subgoalExpectedResult, setSubgoalExpectedResult] = useState('');
  const [subgoalTargetDate, setSubgoalTargetDate] = useState('');
  const [showAreaModal, setShowAreaModal] = useState(false);
  const [showGoalModal, setShowGoalModal] = useState(false);

  const closeAreaModal = () => { if (busy) return; setShowAreaModal(false); setEditingArea(null); setAreaTitle(''); setAreaDescription(''); };
  const closeGoalModal = () => { if (busy) return; setShowGoalModal(false); setEditingGoal(null); setSelectedArea(''); setGoalTitle(''); setGoalReason(''); setExpectedResult(''); setTargetDate(''); };
  const openAreaEditor = (area) => { setEditingArea(area); setAreaTitle(area.title || ''); setAreaDescription(area.description || ''); setShowAreaModal(true); };
  const openGoalEditor = (goal) => { setEditingGoal(goal); setSelectedArea(goal.life_area_id || ''); setGoalTitle(goal.title || ''); setGoalReason(goal.reason || ''); setExpectedResult(goal.expected_result || ''); setTargetDate(goal.target_date || ''); setShowGoalModal(true); };
  const openSubgoalEditor = (subgoal) => { setEditingSubgoal(subgoal); setSubgoalTitle(subgoal.title || ''); setSubgoalExpectedResult(subgoal.expected_result || ''); setSubgoalTargetDate(subgoal.target_date || ''); };

  const saveArea = async (event) => {
    event.preventDefault();
    const title = areaTitle.trim();
    if (!title) return;
    await runAction(async () => {
      const payload = { title, description: areaDescription.trim() || null };
      if (editingArea) {
        const { data, error } = await supabase.from('life_area').update(payload).eq('id', editingArea.id).eq('owner_user_id', profile.id).is('deleted_at', null).select('id');
        if (error) throw error;
        if (!data?.length) throw new Error('No se pudo actualizar el área. Actualiza la vista e inténtalo de nuevo.');
      } else {
        const { error } = await supabase.from('life_area').insert({ id: uuidv7(), owner_user_id: profile.id, created_by_user_id: profile.id, title, description: payload.description });
        if (error) throw error;
      }
      closeAreaModal();
    }, editingArea ? 'Área actualizada.' : 'Área creada.');
  };

  const setAreaStatus = (area) => runAction(async () => {
    const nextStatus = area.status === 'paused' ? 'active' : 'paused';
    const { data, error } = await supabase.from('life_area').update({ status: nextStatus }).eq('id', area.id).eq('owner_user_id', profile.id).is('deleted_at', null).select('id');
    if (error) throw error;
    if (!data?.length) throw new Error('No se pudo cambiar el estado del área.');
  }, area.status === 'paused' ? 'Área reactivada.' : 'Área pausada.');

  const saveGoal = async (event) => {
    event.preventDefault();
    if (!selectedArea || !goalTitle.trim()) return;
    await runAction(async () => {
      const payload = { life_area_id: selectedArea, title: goalTitle.trim(), reason: goalReason.trim() || null, expected_result: expectedResult.trim() || null, target_date: targetDate || null };
      if (editingGoal) {
        const { data, error } = await supabase.from('goal').update(payload).eq('id', editingGoal.id).eq('owner_user_id', profile.id).is('deleted_at', null).select('id');
        if (error) throw error;
        if (!data?.length) throw new Error('No se pudo actualizar la meta. Actualiza la vista e inténtalo de nuevo.');
      } else {
        const { error } = await supabase.from('goal').insert({ id: uuidv7(), owner_user_id: profile.id, created_by_user_id: profile.id, ...payload, status: 'active' });
        if (error) throw error;
      }
      closeGoalModal();
    }, editingGoal ? 'Meta actualizada.' : 'Meta creada.');
  };

  const setGoalStatus = (goal, status) => runAction(async () => {
    const { data, error } = await supabase.from('goal').update({ status }).eq('id', goal.id).eq('owner_user_id', profile.id).is('deleted_at', null).select('id');
    if (error) throw error;
    if (!data?.length) throw new Error('No se pudo actualizar el estado de la meta.');
  }, status === 'completed' ? 'Meta completada.' : status === 'paused' ? 'Meta pausada.' : status === 'active' ? 'Meta reactivada.' : 'Estado de la meta actualizado.');

  const addSubgoal = async (goalId) => {
    const title = (subgoalDraft[goalId] || '').trim();
    if (!title) return;
    await runAction(async () => {
      const { error } = await supabase.from('subgoal').insert({ id: uuidv7(), goal_id: goalId, created_by_user_id: profile.id, title, status: 'active' });
      if (error) throw error;
      setSubgoalDraft((current) => ({ ...current, [goalId]: '' }));
    }, 'Submeta creada.');
  };

  const saveSubgoal = async (event) => {
    event.preventDefault();
    if (!editingSubgoal || !subgoalTitle.trim()) return;
    await runAction(async () => {
      const payload = { title: subgoalTitle.trim(), expected_result: subgoalExpectedResult.trim() || null, target_date: subgoalTargetDate || null };
      const { data, error } = await supabase.from('subgoal').update(payload).eq('id', editingSubgoal.id).eq('goal_id', editingSubgoal.goal_id).is('deleted_at', null).select('id');
      if (error) throw error;
      if (!data?.length) throw new Error('No se pudo actualizar la submeta.');
      setEditingSubgoal(null);
    }, 'Submeta actualizada.');
  };

  const setSubgoalStatus = (subgoal, status) => runAction(async () => {
    const { data, error } = await supabase.from('subgoal').update({ status }).eq('id', subgoal.id).eq('goal_id', subgoal.goal_id).is('deleted_at', null).select('id');
    if (error) throw error;
    if (!data?.length) throw new Error('No se pudo actualizar el estado de la submeta.');
  }, status === 'completed' ? 'Submeta completada.' : status === 'active' ? 'Submeta reactivada.' : status === 'paused' ? 'Submeta pausada.' : 'Estado de la submeta actualizado.');

  return <>
    <div className="management-layout management-layout-single">
      <div className="content-main">
        <div className="section-heading-row">
          <SectionTitle detail={`${areas.length} áreas · ${goals.length} metas`}>Tus áreas de vida</SectionTitle>
          <div className="section-create-actions">
            <button type="button" className="section-create-button" onClick={() => setShowGoalModal(true)}>Nueva Meta</button>
            <button type="button" className="section-create-button" onClick={() => setShowAreaModal(true)}>Nueva Área</button>
          </div>
        </div>
        {loading ? <p className="muted">Cargando…</p> : localError ? <div className="form-error">{localError}</div> : areas.length ? <div className="area-grid">{areas.map((area) => {
          const areaGoals = goals.filter((goal) => goal.life_area_id === area.id);
          return <div className="area-card" key={area.id}>
            <div className="area-card-top"><span className="area-symbol">◎</span><span className="area-count">{areaGoals.length} metas</span></div>
            <div className="area-heading-edit"><div><h3>{area.title}</h3>{area.description && <p>{area.description}</p>}</div><button type="button" className="task-edit-button" onClick={() => openAreaEditor(area)} aria-label={`Editar área: ${area.title}`}>Editar</button></div>
            <div className="area-inline-actions"><span className={`status-tag status-${area.status || 'active'}`}>{area.status === 'paused' ? 'En pausa' : 'Activa'}</span><button type="button" className="text-button" disabled={busy} onClick={() => setAreaStatus(area)}>{area.status === 'paused' ? 'Reactivar área' : 'Pausar área'}</button></div>
            <div className="goal-mini-list">{areaGoals.map((goal) => {
              const goalSubgoals = subgoals.filter((subgoal) => subgoal.goal_id === goal.id);
              return <div className="goal-mini-wrap" key={goal.id}>
                <div className="goal-mini"><span>↳</span><div><strong>{goal.title}</strong><small>{goal.target_date ? `Objetivo: ${formatDate(goal.target_date)}` : 'Sin fecha objetivo'}</small></div><StatusTag status={goal.status} /><button type="button" className="task-edit-button" onClick={() => openGoalEditor(goal)} aria-label={`Editar meta: ${goal.title}`}>Editar</button></div>
                <div className="goal-inline-actions"><label className="goal-status-control"><span>Estado</span><select aria-label={`Estado de meta: ${goal.title}`} value={goal.status} disabled={busy} onChange={(event) => setGoalStatus(goal, event.target.value)}><option value="draft">Borrador</option><option value="active">Activa</option><option value="paused">En pausa</option><option value="completed">Completada</option><option value="cancelled">Cancelada</option></select></label><span className="goal-subgoal-count">{goalSubgoals.length} submetas</span></div>
                {goalSubgoals.map((subgoal) => <div className="subgoal-mini" key={subgoal.id}><span className={subgoal.status === 'completed' ? 'subgoal-done' : ''}>· {subgoal.title}</span><div className="subgoal-controls"><select aria-label={`Estado de submeta: ${subgoal.title}`} value={subgoal.status} disabled={busy} onChange={(event) => setSubgoalStatus(subgoal, event.target.value)}><option value="draft">Borrador</option><option value="active">Activa</option><option value="paused">En pausa</option><option value="completed">Completada</option><option value="cancelled">Cancelada</option></select><button type="button" className="task-edit-button" onClick={() => openSubgoalEditor(subgoal)} aria-label={`Editar submeta: ${subgoal.title}`}>Editar</button></div></div>)}
                <div className="subgoal-form"><input aria-label={`Nueva submeta para: ${goal.title}`} value={subgoalDraft[goal.id] || ''} onChange={(event) => setSubgoalDraft((current) => ({ ...current, [goal.id]: event.target.value }))} placeholder="Añadir una submeta…" onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addSubgoal(goal.id); } }} /><button type="button" aria-label={`Añadir submeta a: ${goal.title}`} onClick={() => addSubgoal(goal.id)} disabled={busy || !(subgoalDraft[goal.id] || '').trim()}>+</button></div>
              </div>;
            })}</div>
          </div>;
        })}</div> : <EmptyState title="Empieza por tus áreas" detail="Crea ámbitos para ordenar lo que importa en tu vida." />}
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
          <div className="project-detail-section"><strong>Tareas del proyecto</strong>
            {projectTaskRows.length ? <div className="project-detail-task-list">{projectTaskRows.map((task) => <div className="project-detail-task" key={task.id}><div><b>{task.action}</b><small>{task.due_date ? `Fecha: ${formatDate(task.due_date)}` : 'Sin fecha'}</small></div><StatusTag status={task.status} /></div>)}</div> : <p className="muted">Todavía no hay tareas vinculadas a este proyecto.</p>}
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
  const [action, setAction] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState('3');
  const [dueDate, setDueDate] = useState('');
  const [projectId, setProjectId] = useState('');
  const [editingTask, setEditingTask] = useState(null);
  const [editAction, setEditAction] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editPriority, setEditPriority] = useState('3');
  const [editDueDate, setEditDueDate] = useState('');
  const [taskSearch, setTaskSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('open');
  const [priorityFilter, setPriorityFilter] = useState('all');
  const [taskSort, setTaskSort] = useState('priority');
  const [showNewTask, setShowNewTask] = useState(false);
  const closeNewTask = () => {
    if (busy) return;
    setShowNewTask(false);
    setAction(''); setDescription(''); setPriority('3'); setDueDate(''); setProjectId('');
  };

  const visibleTasks = useMemo(() => {
    const term = taskSearch.trim().toLocaleLowerCase('es');
    const filtered = tasks.filter((task) => {
      const statusMatches = statusFilter === 'all'
        || (statusFilter === 'open' && !['completed', 'cancelled'].includes(task.status))
        || (statusFilter === 'completed' && task.status === 'completed');
      const priorityMatches = priorityFilter === 'all' || String(task.priority) === priorityFilter;
      const searchMatches = !term || `${task.action || ''} ${task.description || ''}`.toLocaleLowerCase('es').includes(term);
      return statusMatches && priorityMatches && searchMatches;
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
  }, [tasks, taskSearch, statusFilter, priorityFilter, taskSort]);

  const openEditor = (task) => {
    setEditingTask(task);
    setEditAction(task.action || '');
    setEditDescription(task.description || '');
    setEditPriority(String(task.priority ?? 3));
    setEditDueDate(task.due_date || '');
  };

  const addTask = async (event) => {
    event.preventDefault();
    if (!action.trim()) return;
    await runAction(async () => {
      const taskId = uuidv7();
      const { error: insertError } = await supabase.from('task').insert({
        id: taskId, owner_user_id: profile.id, created_by_user_id: profile.id,
        action: action.trim(), description: description.trim() || null,
        priority: Number(priority), due_date: dueDate || null, status: 'todo',
        time_zone: 'America/Havana',
      });
      if (insertError) throw insertError;
      if (projectId) {
        const { error: linkError } = await supabase.from('task_project_link').insert({ id: uuidv7(), task_id: taskId, project_id: projectId, created_by_user_id: profile.id, relation_role: 'primary' });
        if (linkError) throw new Error(`La tarea se creó, pero no se pudo vincular al proyecto: ${linkError.message}`);
      }
      setAction(''); setDescription(''); setPriority('3'); setDueDate(''); setProjectId('');
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
            <input aria-label="Buscar tareas" type="search" value={taskSearch} onChange={(event) => setTaskSearch(event.target.value)} placeholder="Nombre o detalles…" />
          </label>
          <label className="task-toolbar-field">
            <span>Estado</span>
            <select aria-label="Filtrar por estado" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
              <option value="open">Activas</option>
              <option value="completed">Completadas</option>
              <option value="all">Todas</option>
            </select>
          </label>
          <label className="task-toolbar-field">
            <span>Prioridad</span>
            <select aria-label="Filtrar por prioridad" value={priorityFilter} onChange={(event) => setPriorityFilter(event.target.value)}>
              <option value="all">Todas</option>
              <option value="1">1 · Muy alta</option>
              <option value="2">2 · Alta</option>
              <option value="3">3 · Normal</option>
              <option value="4">4 · Baja</option>
              <option value="5">5 · Flexible</option>
            </select>
          </label>
          <label className="task-toolbar-field">
            <span>Ordenar</span>
            <select aria-label="Ordenar tareas" value={taskSort} onChange={(event) => setTaskSort(event.target.value)}>
              <option value="priority">Por prioridad</option>
              <option value="due">Por fecha</option>
              <option value="recent">Más recientes</option>
            </select>
          </label>
        </div>
        {loading ? <p className="muted">Cargando…</p> : localError ? <div className="form-error">{localError}</div> : tasks.length ? visibleTasks.length ? (
          <div className="task-list">
            {visibleTasks.map((task) => (
              <div className={`task-row ${task.status === 'completed' ? 'task-done' : ''}`} key={task.id}>
                {task.status === 'completed'
                  ? <span className="task-check checked" aria-label="Tarea completada">✓</span>
                  : <button className="task-check" onClick={() => completeTask(task)} disabled={busy} aria-label={`Completar tarea: ${task.action}`} />}
                <div className="task-row-copy">
                  <strong>{task.action}</strong>
                  <small>{task.due_date ? `Fecha: ${formatDate(task.due_date)}` : 'Sin fecha'} · Prioridad {task.priority}</small>
                </div>
                <StatusTag status={task.status} />
                {task.status === 'completed' && (
                  <button
                    type="button"
                    className="task-edit-button task-reopen-button"
                    onClick={() => reopenTask(task)}
                    disabled={busy}
                    aria-label={`Reabrir tarea: ${task.action}`}
                  >Reabrir</button>
                )}
                <button
                  type="button"
                  className="task-edit-button"
                  onClick={() => openEditor(task)}
                  disabled={busy}
                  aria-label={`Editar tarea: ${task.action}`}
                >Editar</button>
              </div>
            ))}
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
            <p className="task-editor-note">El estado de la tarea y su asociación a proyectos se mantienen sin cambios.</p>
            <div className="task-editor-actions">
              <button type="button" className="button task-editor-cancel" onClick={() => setEditingTask(null)} disabled={busy}>Cancelar</button>
              <button type="submit" className="button button-primary" disabled={busy || !editAction.trim()}>{busy ? 'Guardando…' : 'Guardar cambios'} <span>→</span></button>
            </div>
          </form>
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
  return <div className="management-layout"><div className="content-main"><SectionTitle detail={`${rows.length} registros`}>Tu biblioteca</SectionTitle>{loading ? <p className="muted">Cargando…</p> : localError ? <div className="form-error">{localError}</div> : rows.length ? <div className="notes-grid">{rows.map((note) => <article className="note-card" key={note.id}><span className="note-kind">{note.kind === 'idea' ? '✦ IDEA' : '✎ NOTA'}</span><h3>{note.title || (note.kind === 'idea' ? 'Idea sin título' : 'Nota sin título')}</h3><p>{note.content}</p><small>{new Intl.DateTimeFormat('es', { dateStyle: 'medium', timeZone: 'America/Havana' }).format(new Date(note.created_at))}</small></article>)}</div> : <EmptyState title="Tu biblioteca está vacía" detail="Guarda pensamientos e ideas para volver a ellos cuando quieras." icon="✎" />}</div><aside className="content-side"><FormCard title="Nueva nota o idea" onSubmit={addNote} submitLabel="Guardar" busy={busy}><label className="field"><span>Tipo</span><select value={kind} onChange={(event) => setKind(event.target.value)}><option value="note">Nota</option><option value="idea">Idea</option></select></label><Field label="Título (opcional)" name="title" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Dale un nombre" /><TextAreaField label="Contenido" name="content" value={content} onChange={(event) => setContent(event.target.value)} placeholder="Escribe lo que quieras conservar…" rows={5} required /></FormCard></aside></div>;
}

function ListsPage({ profile, refreshKey, runAction, busy }) {
  const { rows: lists, loading, localError } = useRows('user_list', profile, refreshKey, (query) => query.is('deleted_at', null).order('created_at', { ascending: false }));
  const { rows: allItems } = useRows('list_item', profile, refreshKey, (query) => query.order('position').order('created_at'));
  const [name, setName] = useState('');
  const [draftItems, setDraftItems] = useState({});
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
      const { error: insertError } = await supabase.from('list_item').insert({ id: uuidv7(), list_id: listId, content, position, is_checked: false });
      if (insertError) throw insertError;
      setDraftItems((current) => ({ ...current, [listId]: '' }));
    }, 'Elemento añadido.');
  };
  const toggleItem = (item) => runAction(async () => {
    const { error: updateError } = await supabase.from('list_item').update({ is_checked: !item.is_checked }).eq('id', item.id);
    if (updateError) throw updateError;
  });
  return <div className="management-layout"><div className="content-main"><SectionTitle detail={`${lists.length} listas`}>Tus listas</SectionTitle>{loading ? <p className="muted">Cargando…</p> : localError ? <div className="form-error">{localError}</div> : lists.length ? <div className="lists-grid">{lists.map((list) => {
    const items = allItems.filter((item) => item.list_id === list.id);
    return <div className="list-card" key={list.id}><div className="list-card-head"><span>☷</span><div><h3>{list.name}</h3><small>{items.filter((item) => item.is_checked).length} de {items.length} marcados</small></div></div><div className="list-items">{items.map((item) => <label className={`list-item ${item.is_checked ? 'checked' : ''}`} key={item.id}><input type="checkbox" checked={item.is_checked} onChange={() => toggleItem(item)} /><span>{item.content}</span></label>)}</div><div className="list-add"><input value={draftItems[list.id] || ''} onChange={(event) => setDraftItems((current) => ({ ...current, [list.id]: event.target.value }))} placeholder="Añadir elemento…" onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addItem(list.id); } }} /><button onClick={() => addItem(list.id)} disabled={busy || !(draftItems[list.id] || '').trim()}>+</button></div></div>;
  })}</div> : <EmptyState title="Sin listas por ahora" detail="Compras, preparativos o cualquier conjunto de elementos que quieras ordenar." icon="☷" />}</div><aside className="content-side"><FormCard title="Crear una lista" onSubmit={createList} submitLabel="Crear lista" busy={busy}><Field label="Nombre de la lista" name="list" value={name} onChange={(event) => setName(event.target.value)} placeholder="Ej. Compras de la semana" required /></FormCard><div className="side-tip"><strong>Una lista no es una tarea.</strong><p>Sus elementos permanecen simples. Solo se convierten en tareas cuando tú lo decides.</p></div></aside></div>;
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
