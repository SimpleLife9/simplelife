import { useEffect, useRef, useState } from 'react';
import { supabase } from '../../lib/supabase.js';

export function useRows(table, profile, refreshKey, configure = null) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [localError, setLocalError] = useState('');
  const [online, setOnline] = useState(() => globalThis.navigator?.onLine !== false);
  const profileIdentityRef = useRef({
    ownerId: profile?.id || null,
    offlineOnly: profile?.offlineOnly === true,
  });

  useEffect(() => {
    const updateConnection = () => setOnline(globalThis.navigator?.onLine !== false);
    globalThis.window?.addEventListener('online', updateConnection);
    globalThis.window?.addEventListener('offline', updateConnection);
    updateConnection();
    return () => {
      globalThis.window?.removeEventListener('online', updateConnection);
      globalThis.window?.removeEventListener('offline', updateConnection);
    };
  }, []);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      const ownerId = profile?.id || null;
      const offlineOnly = profile?.offlineOnly === true;
      if (profileIdentityRef.current.ownerId !== ownerId
        || profileIdentityRef.current.offlineOnly !== offlineOnly) {
        setRows([]);
        profileIdentityRef.current = { ownerId, offlineOnly };
      }
      if (!ownerId || !online || offlineOnly) {
        setLoading(false);
        setLocalError('');
        return;
      }
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
    void load();
    return () => { alive = false; };
  }, [table, profile?.id, profile?.offlineOnly, refreshKey, online]);

  return { rows, loading, localError, setRows };
}
