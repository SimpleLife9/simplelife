import { useEffect, useRef, useState } from 'react';
import { supabase } from '../../lib/supabase.js';

export function useRows(table, profile, refreshKey, configure = null) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [localError, setLocalError] = useState('');
  const [online, setOnline] = useState(() => globalThis.navigator?.onLine !== false);
  const previousOwnerIdRef = useRef(profile?.id || null);

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
      if (previousOwnerIdRef.current !== ownerId) {
        setRows([]);
        previousOwnerIdRef.current = ownerId;
      }
      if (!ownerId || !online || profile?.offlineOnly === true) {
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
  }, [table, profile?.id, refreshKey, online]);

  return { rows, loading, localError, setRows };
}
