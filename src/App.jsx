import React, { useMemo, useState } from 'react';
import { isSupabaseConfigured } from './lib/supabase.js';
import { AuthScreen } from './features/auth/AuthScreen.jsx';
import { ConfigurationScreen } from './shared/components/ConfigurationScreen.jsx';
import { LoadingScreen } from './shared/components/LoadingScreen.jsx';
import { AppShell } from './app/AppShell.jsx';
import { getPageTitle, getPageDescription } from './app/navigation.js';
import { createAppActions } from './app/createAppActions.js';
import { AppPages } from './app/AppPages.jsx';
import { useAppAuth } from './app/useAppAuth.js';



function App() {
  const [activePage, setActivePage] = useState('today');
  const [morePage, setMorePage] = useState('tasks');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);


  const { showNotice, showError, runAction } = useMemo(() => createAppActions({
    setBusy,
    setError,
    setNotice,
    setRefreshKey,
  }), []);

  const {
    session,
    profile,
    authReady,
    profileReady,
    authMode,
    setAuthMode,
    authBusy,
    authError,
    authMessage,
    handleAuth,
    signOut,
  } = useAppAuth({ setAppError: setError });

  const handleSignOut = async () => {
    const { error: signoutError } = await signOut();
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
      <AppPages
        activePage={activePage}
        morePage={morePage}
        profile={profile}
        refreshKey={refreshKey}
        runAction={runAction}
        busy={busy}
        setActivePage={setActivePage}
        setMorePage={setMorePage}
      />
    </AppShell>
  );
}



export default App;
