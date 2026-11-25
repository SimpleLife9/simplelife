import React, { useEffect, useMemo, useState } from 'react';
import { isSupabaseConfigured } from './lib/supabase.js';
import { AuthScreen } from './features/auth/AuthScreen.jsx';
import { ConfigurationScreen } from './shared/components/ConfigurationScreen.jsx';
import { LoadingScreen } from './shared/components/LoadingScreen.jsx';
import { AppShell } from './app/AppShell.jsx';
import { getPageTitle, getPageDescription } from './app/navigation.js';
import { createAppActions } from './app/createAppActions.js';
import { AppPages } from './app/AppPages.jsx';
import { useAppAuth } from './app/useAppAuth.js';

function OfflinePreparationStatus() {
  const [state, setState] = useState(import.meta.env.PROD ? 'preparing' : 'hidden');

  useEffect(() => {
    if (!import.meta.env.PROD || !('serviceWorker' in navigator) || !('caches' in window)) {
      setState('hidden');
      return undefined;
    }

    const registrationPromise = window.__SIMPLELIFE_SW_REGISTRATION__;
    if (!registrationPromise) {
      setState('unavailable');
      return undefined;
    }

    let stopped = false;
    let checking = false;

    const verifyOfflineShell = async () => {
      if (checking || stopped) return;
      checking = true;
      try {
        const registration = await registrationPromise;
        if (!registration) throw new Error('Service worker registration failed.');
        if (!registration.active) await navigator.serviceWorker.ready;
        if (!navigator.serviceWorker.controller) {
          if (!stopped) setState('preparing');
          return;
        }

        const cache = await caches.open('simplelife-shell-v2');
        const manifestResponse = await cache.match(
          new URL('/precache-manifest.json', window.location.origin).href,
          { ignoreVary: true },
        );
        if (!manifestResponse) {
          if (!stopped) setState('preparing');
          return;
        }

        const manifest = await manifestResponse.json();
        if (manifest?.version !== 1 || !Array.isArray(manifest.assets)) {
          throw new Error('Offline asset manifest is invalid.');
        }

        const cachedAssets = await Promise.all(manifest.assets.map((asset) => (
          cache.match(new URL(asset, window.location.origin).href, { ignoreVary: true })
        )));
        const cachedDocument = await cache.match(
          new URL('/index.html', window.location.origin).href,
          { ignoreVary: true },
        );

        if (!stopped) {
          setState(cachedDocument && cachedAssets.every(Boolean) ? 'ready' : 'preparing');
        }
      } catch {
        if (!stopped) setState('unavailable');
      } finally {
        checking = false;
      }
    };

    const handleReadinessChange = () => { void verifyOfflineShell(); };
    navigator.serviceWorker.addEventListener('controllerchange', handleReadinessChange);
    window.addEventListener('online', handleReadinessChange);

    const timeout = window.setTimeout(() => {
      if (!stopped) setState((current) => (current === 'ready' ? current : 'unavailable'));
    }, 25_000);

    void verifyOfflineShell();

    return () => {
      stopped = true;
      window.clearTimeout(timeout);
      navigator.serviceWorker.removeEventListener('controllerchange', handleReadinessChange);
      window.removeEventListener('online', handleReadinessChange);
    };
  }, []);

  if (state === 'hidden') return null;

  const message = state === 'ready'
    ? 'Modo sin conexión preparado'
    : state === 'unavailable'
      ? 'Mantén Internet conectado para preparar el modo sin conexión'
      : 'Preparando modo sin conexión…';

  return (
    <div className={`offline-shell-status is-${state}`} role="status" aria-live="polite">
      <span className="offline-shell-status-dot" aria-hidden="true" />
      <span>{message}</span>
    </div>
  );
}

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

  if (!isSupabaseConfigured) {
    return (
      <>
        <OfflinePreparationStatus />
        <ConfigurationScreen />
      </>
    );
  }

  if (!authReady || (session && !profileReady)) {
    return (
      <>
        <OfflinePreparationStatus />
        <LoadingScreen label="Preparando tu espacio…" />
      </>
    );
  }

  if (!session) {
    return (
      <>
        <OfflinePreparationStatus />
        <AuthScreen
          mode={authMode}
          setMode={setAuthMode}
          onSubmit={handleAuth}
          busy={authBusy}
          error={authError}
          message={authMessage}
        />
      </>
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
    <>
      <OfflinePreparationStatus />
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
    </>
  );
}

export default App;
