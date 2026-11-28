import { useEffect, useRef, useState } from 'react';
import { ensureUserProfile } from '../lib/profile.js';
import { cacheProfileIdForAuthUser, getCachedProfileIdForAuthUser } from '../lib/offline-profile-cache.js';
import { supabase } from '../lib/supabase.js';

function isOfflineNetworkFailure(error) {
  if (globalThis.navigator?.onLine === false) return true;
  return /Failed to fetch|NetworkError|Load failed|ERR_INTERNET_DISCONNECTED/i.test(
    String(error?.message || error || ''),
  );
}

function getOfflineOnlyProfile(authUser) {
  const cachedProfileId = getCachedProfileIdForAuthUser(authUser.id);
  if (!cachedProfileId) {
    throw new Error('Esta cuenta aún no tiene una identidad offline vinculada. Conecta SimpleLife una vez para preparar la bóveda en este dispositivo.');
  }

  // This local identity can open only the matching encrypted IndexedDB
  // namespace. Server-backed operations remain unavailable until online
  // profile resolution succeeds and replaces this temporary profile.
  return {
    id: cachedProfileId,
    auth_user_id: authUser.id,
    display_name: authUser.user_metadata?.full_name
      || authUser.user_metadata?.name
      || authUser.email?.split('@')[0]
      || 'Mi cuenta',
    offlineOnly: true,
  };
}

async function resolveProfileForUser(authUser) {
  // When the browser already knows it is offline, do not spend several
  // network retry windows before opening the owner-bound local vault.
  if (globalThis.navigator?.onLine === false) {
    return getOfflineOnlyProfile(authUser);
  }

  try {
    const profile = await ensureUserProfile(authUser);
    cacheProfileIdForAuthUser(authUser.id, profile);
    return profile;
  } catch (error) {
    if (!isOfflineNetworkFailure(error)) throw error;
    return getOfflineOnlyProfile(authUser);
  }
}

export function useAppAuth({ setAppError }) {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const [profileReady, setProfileReady] = useState(false);
  const [authMode, setAuthMode] = useState('signin');
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState('');
  const [authMessage, setAuthMessage] = useState('');
  const offlineProfileRef = useRef(false);

  useEffect(() => {
    if (!supabase) {
      setAuthReady(true);
      return undefined;
    }

    let alive = true;
    const loadProfile = async (authUser) => {
      try {
        const ownProfile = await resolveProfileForUser(authUser);
        if (alive) {
          offlineProfileRef.current = ownProfile.offlineOnly === true;
          setProfile(ownProfile);
        }
      } catch (profileError) {
        if (alive) {
          offlineProfileRef.current = false;
          setProfile(null);
          setAppError(`No se pudo preparar tu perfil: ${profileError.message}`);
        }
      } finally {
        if (alive) setProfileReady(true);
      }
    };

    const loadSession = async () => {
      const { data, error: sessionError } = await supabase.auth.getSession();
      if (!alive) return;
      if (sessionError) setAuthError(sessionError.message);
      setSession(data.session);
      setAuthReady(true);
      if (data.session?.user) {
        setProfileReady(false);
        await loadProfile(data.session.user);
      } else {
        offlineProfileRef.current = false;
        setProfile(null);
        setProfileReady(true);
      }
    };

    void loadSession();
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      if (!nextSession?.user) {
        offlineProfileRef.current = false;
        setProfile(null);
        setProfileReady(true);
        return;
      }
      setProfileReady(false);
      // Defer Supabase calls until the auth callback has returned.
      window.setTimeout(() => {
        if (alive) void loadProfile(nextSession.user);
      }, 0);
    });

    const refreshOfflineProfileWhenOnline = async () => {
      if (!alive || !offlineProfileRef.current) return;
      try {
        const { data, error } = await supabase.auth.getSession();
        if (!alive || error || !data.session?.user) return;
        // The temporary owner-bound profile is already ready. Keep Inbox mounted
        // while revalidating so its unlocked local vault is not discarded.
        await loadProfile(data.session.user);
      } catch {
        // Keep the locally bound profile and encrypted vault available.
      }
    };
    globalThis.window?.addEventListener('online', refreshOfflineProfileWhenOnline);

    return () => {
      alive = false;
      listener.subscription.unsubscribe();
      globalThis.window?.removeEventListener('online', refreshOfflineProfileWhenOnline);
    };
  }, [setAppError]);

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
      if (!supabase) throw new Error('Supabase no está configurado.');
      if (authMode === 'signup') {
        const { data, error: signupError } = await supabase.auth.signUp({
          email,
          password,
          options: { data: { full_name: fullName } },
        });
        if (signupError) throw signupError;
        if (data.session?.user) {
          const ownProfile = await resolveProfileForUser(data.session.user);
          offlineProfileRef.current = ownProfile.offlineOnly === true;
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
          const ownProfile = await resolveProfileForUser(data.session.user);
          offlineProfileRef.current = ownProfile.offlineOnly === true;
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

  const signOut = async () => {
    if (!supabase) return { error: new Error('Supabase no está configurado.') };
    return supabase.auth.signOut();
  };

  return {
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
  };
}
