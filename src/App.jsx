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
import { ListsPage } from './features/lists/ListsPage.jsx';
import { AuthScreen } from './features/auth/AuthScreen.jsx';
import { ConfigurationScreen } from './shared/components/ConfigurationScreen.jsx';
import { LoadingScreen } from './shared/components/LoadingScreen.jsx';
import { AppShell } from './app/AppShell.jsx';
import { getPageTitle, getPageDescription } from './app/navigation.js';



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

  const title = getPageTitle(activePage, morePage);
  const eyebrow = activePage === 'today'
    ? new Intl.DateTimeFormat('es', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'America/Havana' }).format(new Date())
    : 'YOUR LIFE. YOUR SYSTEM.';
  const description = activePage === 'today'
    ? 'Un paso claro. Después, el siguiente.'
    : getPageDescription(activePage, morePage);

  return (
    <AppShell
      profile={profile}
      email={session.user.email}
      onSignOut={handleSignOut}
      activePage={activePage}
      onNavigate={setActivePage}
      morePage={morePage}
      onMorePageChange={setMorePage}
      title={title}
      eyebrow={eyebrow}
      description={description}
      notice={notice}
      error={error}
      onClearAlerts={() => { setError(''); setNotice(''); }}
    >
      {activePage === 'today' && <TodayPage profile={profile} refreshKey={refreshKey} runAction={runAction} busy={busy} setActivePage={setActivePage} setMorePage={setMorePage} />}
      {activePage === 'inbox' && <InboxPage profile={profile} refreshKey={refreshKey} runAction={runAction} busy={busy} setActivePage={setActivePage} setMorePage={setMorePage} />}
      {activePage === 'goals' && <GoalsPage profile={profile} refreshKey={refreshKey} runAction={runAction} busy={busy} />}
      {activePage === 'projects' && <ProjectsPage profile={profile} refreshKey={refreshKey} runAction={runAction} busy={busy} setActivePage={setActivePage} setMorePage={setMorePage} />}
      {activePage === 'more' && morePage === 'tasks' && <TasksPage profile={profile} refreshKey={refreshKey} runAction={runAction} busy={busy} />}
      {activePage === 'more' && morePage === 'notes' && <NotesPage profile={profile} refreshKey={refreshKey} runAction={runAction} busy={busy} />}
      {activePage === 'more' && morePage === 'lists' && <ListsPage profile={profile} refreshKey={refreshKey} runAction={runAction} busy={busy} setActivePage={setActivePage} setMorePage={setMorePage} />}
    </AppShell>
  );
}



export default App;
