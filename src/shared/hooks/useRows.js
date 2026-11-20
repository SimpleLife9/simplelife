import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase.js';

export function useRows(table, profile, refreshKey, configure = null) {
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
