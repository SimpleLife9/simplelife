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
import { TasksPage } from './features/tasks/TasksPage.jsx';
import { NotesPage } from './features/notes/NotesPage.jsx';
import { FormCard } from './shared/components/FormCard.jsx';

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
