import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase.js';
import { uuidv7 } from '../../lib/uuidv7.js';
import { EmptyState } from '../../shared/components/EmptyState.jsx';
import { normalizeProtectedTimeBlock } from './domain/protected-time.js';
import './ProtectedTimePage.css';

const DEFAULT_TIME_ZONE = 'America/Havana';
const WEEKDAYS = [
  { value: 1, label: 'Lunes' },
  { value: 2, label: 'Martes' },
  { value: 3, label: 'Miércoles' },
  { value: 4, label: 'Jueves' },
  { value: 5, label: 'Viernes' },
  { value: 6, label: 'Sábado' },
  { value: 7, label: 'Domingo' },
];

function dateInZone(timeZone) {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return values.year + '-' + values.month + '-' + values.day;
}

function defaultDraft(timeZone) {
  const today = dateInZone(timeZone);
  return {
    label: '',
    category: '',
    protectionMode: 'hard',
    patternKind: 'one_off',
    timeZone,
    startLocalDateTime: today + 'T09:00',
    endLocalDateTime: today + 'T10:00',
    startDisambiguation: 'earlier',
    endDisambiguation: 'earlier',
    startDate: today,
    endDateExclusive: '',
    weekdays: [1, 2, 3, 4, 5],
    startLocalTime: '22:00',
    endLocalTime: '06:30',
    endsNextDay: true,
  };
}

function localDateTime(value) {
  return String(value || '').replace(' ', 'T').slice(0, 23);
}

function formatInstant(value, timeZone) {
  if (!value) return '—';
  try {
    return new Intl.DateTimeFormat('es', {
      dateStyle: 'medium', timeStyle: 'short', timeZone,
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function formatWeekly(block) {
  const labels = (block.weekdays || [])
    .map((day) => WEEKDAYS.find((item) => item.value === day)?.label.slice(0, 3) || String(day));
  const endDate = block.end_date_exclusive
    ? ' · hasta antes del ' + block.end_date_exclusive
    : '';
  return labels.join(', ') + ' · ' + String(block.start_time_local).slice(0, 5)
    + '–' + String(block.end_time_local).slice(0, 5)
    + (block.ends_next_day ? ' (+1 día)' : '') + endDate;
}

function blockDescription(block) {
  if (block.pattern_kind === 'weekly') {
    return formatWeekly(block) + ' · desde ' + block.start_date;
  }
  return formatInstant(block.starts_at, block.time_zone)
    + ' — ' + formatInstant(block.ends_at, block.time_zone);
}

function lifecycleOf(block) {
  return block.deleted_at ? 'trash' : block.archived_at ? 'archived' : 'active';
}

function lifecycleLabel(block) {
  return lifecycleOf(block) === 'trash'
    ? 'En papelera'
    : lifecycleOf(block) === 'archived' ? 'Archivado' : 'Activo';
}

async function invokeMutation(body, key) {
  const { data, error } = await supabase.functions.invoke('agenda-protected-time-mutate', {
    body,
    headers: { 'Idempotency-Key': key },
  });
  if (error) {
    let message = error.message || 'No se pudo actualizar el tiempo protegido.';
    try {
      const response = error.context instanceof Response ? await error.context.clone().json() : null;
      if (response?.error) message = response.error;
    } catch { /* keep SDK error message */ }
    throw new Error(message);
  }
  if (!data?.blockId) throw new Error('El servidor no confirmó el bloque protegido.');
  return data;
}

export function ProtectedTimePage({ profile, refreshKey, runAction, busy }) {
  const [blocks, setBlocks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [localError, setLocalError] = useState('');
  const [timeZone, setTimeZone] = useState(DEFAULT_TIME_ZONE);
  const [lifecycleView, setLifecycleView] = useState('active');
  const [showForm, setShowForm] = useState(false);
  const [editingBlock, setEditingBlock] = useState(null);
  const [draft, setDraft] = useState(() => defaultDraft(DEFAULT_TIME_ZONE));
  const [pendingKey, setPendingKey] = useState(null);
  const [confirmTarget, setConfirmTarget] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    async function loadPreference() {
      if (!profile?.id) return;
      const { data, error } = await supabase
        .from('user_preference')
        .select('time_zone')
        .eq('user_id', profile.id)
        .maybeSingle();
      if (!alive) return;
      if (!error && data?.time_zone) {
        try {
          new Intl.DateTimeFormat('en', { timeZone: data.time_zone }).format(new Date());
          setTimeZone(data.time_zone);
          setDraft((current) => current.timeZone === DEFAULT_TIME_ZONE
            ? { ...current, timeZone: data.time_zone }
            : current);
        } catch {
          setLocalError('La zona horaria guardada no es válida; se usa America/Havana.');
        }
      }
    }
    void loadPreference();
    return () => { alive = false; };
  }, [profile?.id]);

  useEffect(() => {
    let alive = true;
    async function loadBlocks() {
      if (!profile?.id) return;
      setLoading(true);
      setLocalError('');
      try {
        let query = supabase.from('protected_time_block').select('*');
        if (lifecycleView === 'active') {
          query = query.is('archived_at', null).is('deleted_at', null);
        } else if (lifecycleView === 'archived') {
          query = query.not('archived_at', 'is', null).is('deleted_at', null);
        } else {
          query = query.not('deleted_at', 'is', null);
        }
        const { data, error } = await query.order('created_at', { ascending: false });
        if (error) throw error;
        if (alive) setBlocks(data || []);
      } catch (error) {
        if (alive) setLocalError(error?.message || 'No se pudieron cargar los bloques protegidos.');
      } finally {
        if (alive) setLoading(false);
      }
    }
    void loadBlocks();
    return () => { alive = false; };
  }, [profile?.id, refreshKey, lifecycleView]);

  const visibleBlocks = useMemo(() => blocks.filter((block) => lifecycleOf(block) === lifecycleView), [blocks, lifecycleView]);

  const setField = (name, value) => {
    setDraft((current) => ({ ...current, [name]: value }));
    setPendingKey(null);
    setLocalError('');
  };

  const openCreate = () => {
    setLocalError('');
    setEditingBlock(null);
    setDraft(defaultDraft(timeZone));
    setPendingKey(null);
    setShowForm(true);
  };

  const openEdit = (block) => {
    setLocalError('');
    setEditingBlock(block);
    setDraft({
      label: block.label || '',
      category: block.category || '',
      protectionMode: block.protection_mode,
      patternKind: block.pattern_kind,
      timeZone: block.time_zone || timeZone,
      startLocalDateTime: localDateTime(block.start_local),
      endLocalDateTime: localDateTime(block.end_local),
      startDisambiguation: block.start_disambiguation || 'earlier',
      endDisambiguation: block.end_disambiguation || 'earlier',
      startDate: block.start_date || dateInZone(timeZone),
      endDateExclusive: block.end_date_exclusive || '',
      weekdays: block.weekdays || [1, 2, 3, 4, 5],
      startLocalTime: String(block.start_time_local || '09:00').slice(0, 8),
      endLocalTime: String(block.end_time_local || '10:00').slice(0, 8),
      endsNextDay: block.ends_next_day === true,
    });
    setPendingKey(null);
    setShowForm(true);
  };

  const closeForm = () => {
    if (busy || saving) return;
    setShowForm(false);
    setEditingBlock(null);
    setPendingKey(null);
  };

  const buildDraftPayload = () => {
    const common = {
      label: draft.label,
      category: draft.category.trim() || null,
      protectionMode: draft.protectionMode,
      patternKind: draft.patternKind,
      timeZone: draft.timeZone.trim(),
    };
    return draft.patternKind === 'one_off'
      ? normalizeProtectedTimeBlock({
        ...common,
        startLocalDateTime: draft.startLocalDateTime,
        endLocalDateTime: draft.endLocalDateTime,
        startDisambiguation: draft.startDisambiguation,
        endDisambiguation: draft.endDisambiguation,
      })
      : normalizeProtectedTimeBlock({
        ...common,
        startDate: draft.startDate,
        endDateExclusive: draft.endDateExclusive || null,
        weekdays: draft.weekdays,
        startLocalTime: draft.startLocalTime,
        endLocalTime: draft.endLocalTime,
        endsNextDay: draft.endsNextDay,
      });
  };

  const submitForm = async (event) => {
    event.preventDefault();
    let block;
    try {
      block = buildDraftPayload();
    } catch (error) {
      setLocalError(error.message || 'Revisa los datos del bloque.');
      return;
    }
    const key = pendingKey || uuidv7();
    setPendingKey(key);
    setSaving(true);
    const body = editingBlock
      ? {
        action: 'edit',
        blockId: editingBlock.id,
        expectedUpdatedAt: editingBlock.updated_at,
        block,
      }
      : { action: 'create', block };
    const success = await runAction(
      () => invokeMutation(body, key),
      editingBlock ? 'Tiempo protegido actualizado.' : 'Tiempo protegido guardado.',
    );
    setSaving(false);
    if (success) {
      setShowForm(false);
      setEditingBlock(null);
      setPendingKey(null);
      setLocalError('');
    }
  };

  const mutateBlock = async (action, block) => {
    if (!block) return;
    const key = pendingKey || uuidv7();
    setPendingKey(key);
    setSaving(true);
    const success = await runAction(
      () => invokeMutation({
        action,
        blockId: block.id,
        expectedUpdatedAt: block.updated_at,
      }, key),
      action === 'archive' ? 'Bloque archivado.'
        : action === 'restore' ? 'Bloque restaurado.'
          : 'Bloque enviado a la papelera.',
    );
    setSaving(false);
    if (success) {
      setConfirmTarget(null);
      setPendingKey(null);
    }
  };

  const confirmDetails = confirmTarget?.action === 'archive'
    ? { title: 'Archivar bloque', copy: 'El bloque dejará de aparecer en la vista activa. Podrás restaurarlo después.', button: 'Archivar' }
    : { title: 'Enviar a papelera', copy: 'El bloque se conservará como registro recuperable. No se borrará físicamente.', button: 'Mover a papelera' };

  return (
    <section className="protected-time-page" aria-label="Tiempo protegido">
      <header className="protected-time-header">
        <div>
          <span className="agenda-section-kicker">PROTECCIÓN DEL TIEMPO</span>
          <h2>Tiempo protegido</h2>
          <p>Reserva espacios personales sin desplazar compromisos automáticamente.</p>
        </div>
        <button type="button" className="button button-primary" onClick={openCreate} disabled={busy || saving}>
          <span aria-hidden="true">＋</span> Nuevo bloque
        </button>
      </header>

      <nav className="agenda-lifecycle-switch" aria-label="Estado de los bloques protegidos">
        {[
          { id: 'active', label: 'Activos' },
          { id: 'archived', label: 'Archivados' },
          { id: 'trash', label: 'Papelera' },
        ].map((item) => (
          <button
            type="button"
            key={item.id}
            className={lifecycleView === item.id ? 'active' : ''}
            aria-pressed={lifecycleView === item.id}
            onClick={() => { setLifecycleView(item.id); setPendingKey(null); }}
          >
            {item.label}
          </button>
        ))}
      </nav>

      {localError && <div className="form-error protected-time-error" role="alert">{localError}</div>}
      {loading && <p className="muted agenda-loading">Cargando tiempo protegido…</p>}
      {!loading && !localError && visibleBlocks.length === 0 && (
        <EmptyState
          title={lifecycleView === 'active' ? 'Aún no has protegido ningún espacio' : 'No hay bloques en esta vista'}
          detail={lifecycleView === 'active'
            ? 'Crea una reserva puntual o una regla semanal para defender tu tiempo.'
            : 'Los bloques que archives o envíes a papelera aparecerán aquí.'}
          icon="◷"
        />
      )}
      {!loading && visibleBlocks.length > 0 && (
        <div className="protected-time-list">
          {visibleBlocks.map((block) => (
            <article className="protected-time-card" key={block.id}>
              <div className="protected-time-card-top">
                <div>
                  <span className="agenda-section-kicker">{block.category || 'PERSONAL'} · {block.pattern_kind === 'weekly' ? 'SEMANAL' : 'UNA VEZ'}</span>
                  <h3>{block.label}</h3>
                </div>
                <span className={'protected-time-mode ' + (block.protection_mode === 'hard' ? 'is-hard' : 'is-flexible')}>
                  {block.protection_mode === 'hard' ? 'Protección rígida' : 'Flexible'}
                </span>
              </div>
              <p className="protected-time-range">{blockDescription(block)}</p>
              <div className="protected-time-card-meta">
                <span>{block.time_zone}</span>
                <span>{lifecycleLabel(block)}</span>
              </div>
              <div className="protected-time-card-actions">
                {lifecycleView === 'active' && (
                  <>
                    <button type="button" className="agenda-secondary-button" onClick={() => openEdit(block)} disabled={busy || saving}>Editar</button>
                    <button type="button" className="agenda-secondary-button agenda-action-warning" onClick={() => setConfirmTarget({ action: 'archive', block })} disabled={busy || saving}>Archivar</button>
                    <button type="button" className="agenda-secondary-button agenda-action-danger" onClick={() => setConfirmTarget({ action: 'delete', block })} disabled={busy || saving}>Papelera</button>
                  </>
                )}
                {lifecycleView === 'archived' && (
                  <>
                    <button type="button" className="button button-primary" onClick={() => mutateBlock('restore', block)} disabled={busy || saving}>Restaurar</button>
                    <button type="button" className="agenda-secondary-button agenda-action-danger" onClick={() => setConfirmTarget({ action: 'delete', block })} disabled={busy || saving}>Papelera</button>
                  </>
                )}
                {lifecycleView === 'trash' && (
                  <button type="button" className="button button-primary" onClick={() => mutateBlock('restore', block)} disabled={busy || saving}>Restaurar</button>
                )}
              </div>
            </article>
          ))}
        </div>
      )}

      {showForm && (
        <div className="agenda-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeForm(); }}>
          <section className="agenda-dialog protected-time-dialog" role="dialog" aria-modal="true" aria-labelledby="protected-time-form-title">
            <header className="agenda-dialog-header">
              <div>
                <span className="agenda-section-kicker">{editingBlock ? 'EDITAR RESERVA' : 'NUEVA RESERVA'}</span>
                <h2 id="protected-time-form-title">{editingBlock ? 'Editar tiempo protegido' : 'Proteger tiempo'}</h2>
              </div>
              <button type="button" className="agenda-close-button" aria-label="Cerrar" onClick={closeForm} disabled={busy || saving}>×</button>
            </header>
            <form className="agenda-form" onSubmit={submitForm}>
              <label className="agenda-field agenda-field-full">
                <span>Nombre del bloque</span>
                <input value={draft.label} onChange={(event) => setField('label', event.target.value)} required maxLength={120} placeholder="Ej. Sueño, gimnasio, lectura…" autoFocus />
              </label>
              <div className="agenda-form-row">
                <label className="agenda-field">
                  <span>Categoría (opcional)</span>
                  <input value={draft.category} onChange={(event) => setField('category', event.target.value)} maxLength={50} placeholder="Salud, personal, enfoque…" />
                </label>
                <label className="agenda-field">
                  <span>Protección</span>
                  <select value={draft.protectionMode} onChange={(event) => setField('protectionMode', event.target.value)}>
                    <option value="hard">Rígida</option>
                    <option value="flexible">Flexible</option>
                  </select>
                </label>
              </div>
              <div className="agenda-form-row">
                <label className="agenda-field">
                  <span>Patrón</span>
                  <select value={draft.patternKind} onChange={(event) => setField('patternKind', event.target.value)}>
                    <option value="one_off">Una vez</option>
                    <option value="weekly">Cada semana</option>
                  </select>
                </label>
                <label className="agenda-field">
                  <span>Zona horaria IANA</span>
                  <input value={draft.timeZone} onChange={(event) => setField('timeZone', event.target.value)} required maxLength={100} />
                </label>
              </div>

              {draft.patternKind === 'one_off' ? (
                <>
                  <div className="agenda-form-row">
                    <label className="agenda-field">
                      <span>Comienza</span>
                      <input type="datetime-local" step="0.001" value={draft.startLocalDateTime} onChange={(event) => setField('startLocalDateTime', event.target.value)} required />
                    </label>
                    <label className="agenda-field">
                      <span>Termina</span>
                      <input type="datetime-local" step="0.001" value={draft.endLocalDateTime} onChange={(event) => setField('endLocalDateTime', event.target.value)} required />
                    </label>
                  </div>
                  <div className="agenda-form-row">
                    <label className="agenda-field">
                      <span>Hora ambigua (inicio DST)</span>
                      <select value={draft.startDisambiguation} onChange={(event) => setField('startDisambiguation', event.target.value)}>
                        <option value="earlier">Primera ocurrencia</option>
                        <option value="later">Segunda ocurrencia</option>
                        <option value="reject">Rechazar ambigüedad</option>
                      </select>
                    </label>
                    <label className="agenda-field">
                      <span>Hora ambigua (fin DST)</span>
                      <select value={draft.endDisambiguation} onChange={(event) => setField('endDisambiguation', event.target.value)}>
                        <option value="earlier">Primera ocurrencia</option>
                        <option value="later">Segunda ocurrencia</option>
                        <option value="reject">Rechazar ambigüedad</option>
                      </select>
                    </label>
                  </div>
                  <p className="protected-time-help">Las horas se interpretan en la zona IANA elegida. El servidor resuelve los cambios de horario de verano/invierno.</p>
                </>
              ) : (
                <>
                  <div className="protected-time-weekdays" role="group" aria-label="Días de repetición">
                    <span>Repetir los días</span>
                    <div>
                      {WEEKDAYS.map((day) => (
                        <label key={day.value}>
                          <input
                            type="checkbox"
                            checked={draft.weekdays.includes(day.value)}
                            onChange={(event) => setField('weekdays', event.target.checked
                              ? [...draft.weekdays, day.value].sort((a, b) => a - b)
                              : draft.weekdays.filter((value) => value !== day.value))}
                          />
                          {day.label.slice(0, 2)}
                        </label>
                      ))}
                    </div>
                  </div>
                  <div className="agenda-form-row">
                    <label className="agenda-field">
                      <span>Comienza a partir de</span>
                      <input type="date" value={draft.startDate} onChange={(event) => setField('startDate', event.target.value)} required />
                    </label>
                    <label className="agenda-field">
                      <span>Dejar de repetir antes de (opcional)</span>
                      <input type="date" value={draft.endDateExclusive} min={draft.startDate} onChange={(event) => setField('endDateExclusive', event.target.value)} />
                    </label>
                  </div>
                  <div className="agenda-form-row">
                    <label className="agenda-field">
                      <span>Hora de inicio</span>
                      <input type="time" step="1" value={draft.startLocalTime} onChange={(event) => setField('startLocalTime', event.target.value)} required />
                    </label>
                    <label className="agenda-field">
                      <span>Hora de fin</span>
                      <input type="time" step="1" value={draft.endLocalTime} onChange={(event) => setField('endLocalTime', event.target.value)} required />
                    </label>
                  </div>
                  <label className="protected-time-overnight">
                    <input type="checkbox" checked={draft.endsNextDay} onChange={(event) => setField('endsNextDay', event.target.checked)} />
                    Termina al día siguiente
                  </label>
                  <p className="protected-time-help">La regla conserva la hora civil y la zona IANA. Las ocurrencias se resolverán con las reglas horarias vigentes; no se convierten en Events automáticamente.</p>
                </>
              )}

              <footer className="agenda-dialog-actions">
                <button type="button" className="agenda-secondary-button" onClick={closeForm} disabled={busy || saving}>Cancelar</button>
                <button type="submit" className="button button-primary" disabled={busy || saving || !draft.label.trim()}>
                  {saving ? 'Guardando…' : editingBlock ? 'Guardar cambios' : 'Guardar bloque'}
                </button>
              </footer>
            </form>
          </section>
        </div>
      )}

      {confirmTarget && (
        <div className="agenda-dialog-backdrop agenda-confirm-backdrop" role="presentation">
          <section className="agenda-dialog agenda-confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="protected-time-confirm-title">
            <header className="agenda-dialog-header">
              <div><span className="agenda-section-kicker">CONFIRMACIÓN</span><h2 id="protected-time-confirm-title">{confirmDetails.title}</h2></div>
              <button type="button" className="agenda-close-button" aria-label="Cerrar" onClick={() => setConfirmTarget(null)} disabled={busy || saving}>×</button>
            </header>
            <p className="agenda-confirm-copy">{confirmDetails.copy} <strong>{confirmTarget.block.label}</strong></p>
            <footer className="agenda-dialog-actions">
              <button type="button" className="agenda-secondary-button" onClick={() => setConfirmTarget(null)} disabled={busy || saving}>Volver</button>
              <button type="button" className="button button-primary" onClick={() => mutateBlock(confirmTarget.action, confirmTarget.block)} disabled={busy || saving}>{confirmDetails.button}</button>
            </footer>
          </section>
        </div>
      )}
    </section>
  );
}
