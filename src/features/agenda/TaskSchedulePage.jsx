import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase.js';
import { uuidv7 } from '../../lib/uuidv7.js';
import { EmptyState } from '../../shared/components/EmptyState.jsx';
import './TaskSchedulePage.css';

const DEFAULT_TIME_ZONE = 'America/Havana';
const ACTIVE_STATUSES = ['proposed', 'confirmed'];
const STATUS_LABELS = {
  proposed: 'Propuesta',
  confirmed: 'Confirmada',
  cancelled: 'Cancelada',
  released: 'Liberada',
  elapsed: 'Transcurrida',
};

function formatLocalInput(instant, timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(instant));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}T${values.hour}:${values.minute}`;
}

function formatRange(schedule, timeZone) {
  const formatter = new Intl.DateTimeFormat('es', {
    timeZone,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
  return formatter.format(new Date(schedule.starts_at)) + ' — ' + formatter.format(new Date(schedule.ends_at));
}

function toConflictKey(item, kind) {
  if (kind === 'event') return 'event:' + item.eventId;
  if (kind === 'schedule') return 'schedule:' + item.taskScheduleId;
  return 'protected:' + item.blockId + ':' + item.occurrenceStartsAt;
}

function ConflictDialog({ conflict, choices, setChoices, onSave, onClose, busy }) {
  const events = conflict.eventConflicts || [];
  const protectedBlocks = conflict.protectedTimeConflicts || [];
  const schedules = conflict.taskScheduleConflicts || [];
  const allChoicesReady = events.every((item) => choices[toConflictKey(item, 'event')] === 'keep_overlap')
    && protectedBlocks.every((item) => choices[toConflictKey(item, 'protected')] === item.requiredDecision)
    && schedules.every((item) => choices[toConflictKey(item, 'schedule')] === item.requiredDecision);
  const hasConflicts = events.length + protectedBlocks.length + schedules.length > 0;

  return (
    <div className="agenda-dialog-backdrop task-schedule-conflict-backdrop" role="presentation">
      <section className="agenda-dialog task-schedule-conflict-dialog" role="alertdialog" aria-modal="true" aria-labelledby="task-schedule-conflict-title">
        <header className="agenda-dialog-header">
          <div>
            <span className="agenda-section-kicker">DECISIÓN REQUERIDA</span>
            <h2 id="task-schedule-conflict-title">Esta franja se cruza con otros compromisos</h2>
          </div>
          <button type="button" className="agenda-close-button" aria-label="Cerrar" onClick={onClose} disabled={busy}>×</button>
        </header>
        {conflict.error === 'TASK_SCHEDULE_CONFLICTS_CHANGED' && !hasConflicts ? (
          <p className="agenda-confirm-copy">
            Los compromisos cambiaron mientras guardabas. Ninguna reserva fue creada.
            Revisa el horario y vuelve a intentarlo.
          </p>
        ) : (
          <>
            <p className="agenda-confirm-copy">
              No se moverá ningún compromiso automáticamente. Decide explícitamente qué cruces aceptas.
            </p>
            {events.map((item) => (
              <article className="task-schedule-conflict-item" key={item.eventId}>
                <div>
                  <strong>{item.title || 'Evento'}</strong>
                  <small>{formatRange({ starts_at: item.startsAt, ends_at: item.endsAt }, DEFAULT_TIME_ZONE)}</small>
                  <span>Evento existente</span>
                </div>
                <label className="agenda-field">
                  <span>Tu decisión</span>
                  <select
                    value={choices[toConflictKey(item, 'event')] || ''}
                    onChange={(event) => setChoices((current) => ({ ...current, [toConflictKey(item, 'event')]: event.target.value }))}
                    disabled={busy}
                  >
                    <option value="">Selecciona una decisión</option>
                    <option value="keep_overlap">Mantener ambos compromisos</option>
                  </select>
                </label>
              </article>
            ))}
            {schedules.map((item) => (
              <article className="task-schedule-conflict-item" key={toConflictKey(item, 'schedule')}>
                <div>
                  <strong>Otra reserva de tarea</strong>
                  <small>{formatRange({ starts_at: item.startsAt, ends_at: item.endsAt }, item.timeZone || DEFAULT_TIME_ZONE)}</small>
                  <span>Reserva activa · se conservará sin moverla</span>
                </div>
                <label className="agenda-field">
                  <span>Tu decisión</span>
                  <select
                    value={choices[toConflictKey(item, 'schedule')] || ''}
                    onChange={(event) => setChoices((current) => ({ ...current, [toConflictKey(item, 'schedule')]: event.target.value }))}
                    disabled={busy}
                  >
                    <option value="">Selecciona una decisión</option>
                    <option value="keep_overlap">Mantener ambas reservas</option>
                  </select>
                </label>
              </article>
            ))}
            {protectedBlocks.map((item) => (
              <article className="task-schedule-conflict-item" key={toConflictKey(item, 'protected')}>
                <div>
                  <strong>{item.label || 'Tiempo protegido'}</strong>
                  <small>{formatRange({ starts_at: item.occurrenceStartsAt, ends_at: item.occurrenceEndsAt }, item.timeZone || DEFAULT_TIME_ZONE)}</small>
                  <span>{item.protectionMode === 'hard' ? 'Protección rígida' : 'Protección flexible'}</span>
                </div>
                <label className="agenda-field">
                  <span>Tu decisión</span>
                  <select
                    value={choices[toConflictKey(item, 'protected')] || ''}
                    onChange={(event) => setChoices((current) => ({ ...current, [toConflictKey(item, 'protected')]: event.target.value }))}
                    disabled={busy}
                  >
                    <option value="">Selecciona una decisión</option>
                    <option value={item.requiredDecision}>
                      {item.requiredDecision === 'override_hard' ? 'Autorizar este cruce rígido' : 'Mantener ambos compromisos'}
                    </option>
                  </select>
                </label>
              </article>
            ))}
          </>
        )}
        <footer className="agenda-dialog-actions">
          <button type="button" className="agenda-secondary-button" onClick={onClose} disabled={busy}>Volver al horario</button>
          <button type="button" className="button button-primary" onClick={onSave} disabled={busy || !hasConflicts || !allChoicesReady}>
            {busy ? 'Guardando…' : 'Guardar con mis decisiones'}
          </button>
        </footer>
      </section>
    </div>
  );
}

export function TaskSchedulePage({ profile, refreshKey, runAction, busy }) {
  const [tasks, setTasks] = useState([]);
  const [schedules, setSchedules] = useState([]);
  const [loading, setLoading] = useState(true);
  const [localError, setLocalError] = useState('');
  const [timeZone, setTimeZone] = useState(DEFAULT_TIME_ZONE);
  const [selectedTaskId, setSelectedTaskId] = useState('');
  const [startLocalDateTime, setStartLocalDateTime] = useState('');
  const [endLocalDateTime, setEndLocalDateTime] = useState('');
  const [editingSchedule, setEditingSchedule] = useState(null);
  const [pendingKey, setPendingKey] = useState(null);
  const [conflictPrompt, setConflictPrompt] = useState(null);
  const [conflictChoices, setConflictChoices] = useState({});

  const loadData = async () => {
    if (!profile?.id) return;
    setLoading(true);
    setLocalError('');
    try {
      const [taskResult, scheduleResult, preferenceResult] = await Promise.all([
        supabase.from('task')
          .select('id,action,description,status,due_date,archived_at,deleted_at')
          .is('archived_at', null)
          .is('deleted_at', null)
          .order('priority', { ascending: true })
          .order('created_at', { ascending: false }),
        supabase.from('task_schedule')
          .select('*')
          .eq('owner_user_id', profile.id)
          .order('starts_at', { ascending: true }),
        supabase.from('user_preference')
          .select('time_zone')
          .eq('user_id', profile.id)
          .maybeSingle(),
      ]);
      if (taskResult.error) throw taskResult.error;
      if (scheduleResult.error) throw scheduleResult.error;
      if (preferenceResult.error) throw preferenceResult.error;
      setTasks((taskResult.data || []).filter((task) => !['completed', 'cancelled'].includes(task.status)));
      setSchedules(scheduleResult.data || []);
      const zone = preferenceResult.data?.time_zone || DEFAULT_TIME_ZONE;
      try { new Intl.DateTimeFormat('en', { timeZone: zone }).format(new Date()); setTimeZone(zone); }
      catch { setTimeZone(DEFAULT_TIME_ZONE); }
    } catch (error) {
      setLocalError(error?.message || 'No se pudieron cargar las reservas de tareas.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let alive = true;
    const load = async () => {
      if (!profile?.id) return;
      setLoading(true);
      setLocalError('');
      try {
        const [taskResult, scheduleResult, preferenceResult] = await Promise.all([
          supabase.from('task')
            .select('id,action,description,status,due_date,archived_at,deleted_at')
            .is('archived_at', null)
            .is('deleted_at', null)
            .order('priority', { ascending: true })
            .order('created_at', { ascending: false }),
          supabase.from('task_schedule')
            .select('*')
            .eq('owner_user_id', profile.id)
            .order('starts_at', { ascending: true }),
          supabase.from('user_preference')
            .select('time_zone')
            .eq('user_id', profile.id)
            .maybeSingle(),
        ]);
        if (taskResult.error) throw taskResult.error;
        if (scheduleResult.error) throw scheduleResult.error;
        if (preferenceResult.error) throw preferenceResult.error;
        if (!alive) return;
        const availableTasks = (taskResult.data || []).filter((task) => !['completed', 'cancelled'].includes(task.status));
        setTasks(availableTasks);
        setSchedules(scheduleResult.data || []);
        const zone = preferenceResult.data?.time_zone || DEFAULT_TIME_ZONE;
        try { new Intl.DateTimeFormat('en', { timeZone: zone }).format(new Date()); setTimeZone(zone); }
        catch { setTimeZone(DEFAULT_TIME_ZONE); }
        setSelectedTaskId((current) => current && availableTasks.some((task) => task.id === current)
          ? current : (availableTasks[0]?.id || ''));
      } catch (error) {
        if (alive) setLocalError(error?.message || 'No se pudieron cargar las reservas de tareas.');
      } finally {
        if (alive) setLoading(false);
      }
    };
    void load();
    return () => { alive = false; };
  }, [profile?.id, refreshKey]);

  const taskById = useMemo(() => new Map(tasks.map((task) => [task.id, task])), [tasks]);
  const activeSchedules = schedules.filter((item) => ACTIVE_STATUSES.includes(item.schedule_status));
  const historicalSchedules = schedules.filter((item) => !ACTIVE_STATUSES.includes(item.schedule_status));

  const startNewSchedule = () => {
    setEditingSchedule(null);
    const now = Date.now();
    setStartLocalDateTime(formatLocalInput(new Date(now + 60 * 60 * 1000), timeZone));
    setEndLocalDateTime(formatLocalInput(new Date(now + 2 * 60 * 60 * 1000), timeZone));
  };

  const startEditSchedule = (schedule) => {
    setEditingSchedule(schedule);
    setSelectedTaskId(schedule.task_id);
    setStartLocalDateTime(formatLocalInput(schedule.starts_at, schedule.time_zone || timeZone));
    setEndLocalDateTime(formatLocalInput(schedule.ends_at, schedule.time_zone || timeZone));
  };

  const sendMutation = async (action, schedule = null, decisions = null) => {
    const key = pendingKey || uuidv7();
    setPendingKey(key);
    const body = action === 'create'
      ? {
        action,
        taskId: selectedTaskId,
        schedule: { startLocalDateTime, endLocalDateTime, timeZone, startDisambiguation: 'earlier', endDisambiguation: 'earlier' },
        ...(decisions || {}),
      }
      : action === 'edit'
        ? {
          action,
          taskScheduleId: schedule.id,
          expectedUpdatedAt: schedule.updated_at,
          schedule: { startLocalDateTime, endLocalDateTime, timeZone: schedule.time_zone || timeZone, startDisambiguation: schedule.start_disambiguation, endDisambiguation: schedule.end_disambiguation },
          ...(decisions || {}),
        }
        : {
          action,
          taskScheduleId: schedule.id,
          expectedUpdatedAt: schedule.updated_at,
        };

    const success = await runAction(async () => {
      const { data, error } = await supabase.functions.invoke('agenda-task-schedule-mutate', {
        body,
        headers: { 'Idempotency-Key': key },
      });
      if (error) {
        let response = null;
        try { response = error.context instanceof Response ? await error.context.clone().json() : null; } catch { /* keep SDK message */ }
        if (response && (
          response.error === 'TASK_SCHEDULE_CONFLICTS'
          || response.error === 'PROTECTED_TIME_CONFLICTS'
          || response.error === 'TASK_SCHEDULE_OVERLAPS'
          || response.error === 'TASK_SCHEDULE_CONFLICTS_CHANGED'
        )) {
          if (response.error === 'TASK_SCHEDULE_CONFLICTS_CHANGED') {
            // The SQL writer commits this 409 receipt; the next retry needs a new key.
            setPendingKey(null);
          }
          setConflictPrompt(response);
          setConflictChoices({});
          throw new Error(response.error === 'TASK_SCHEDULE_CONFLICTS_CHANGED'
            ? 'Los compromisos cambiaron durante el guardado. Revisa el horario y vuelve a intentarlo.'
            : 'La franja se cruza con otros compromisos. Debes decidir cómo continuar.');
        }
        if (response?.error) throw new Error(response.error);
        throw new Error(error.message || 'No se pudo guardar la reserva.');
      }
      if (!data?.taskScheduleId && ['create', 'edit'].includes(action)) {
        throw new Error('El servidor no devolvió el identificador de la reserva.');
      }
    }, action === 'create' ? 'Reserva de tarea creada.' : action === 'edit' ? 'Reserva actualizada.' : 'Estado de la reserva actualizado.');

    if (success) {
      setPendingKey(null);
      setConflictPrompt(null);
      setConflictChoices({});
      if (action === 'create' || action === 'edit') {
        setEditingSchedule(null);
        setStartLocalDateTime('');
        setEndLocalDateTime('');
      }
      await loadData();
    }
  };

  const saveSchedule = (event) => {
    event.preventDefault();
    if (busy || !selectedTaskId || !startLocalDateTime || !endLocalDateTime) return;
    return sendMutation(editingSchedule ? 'edit' : 'create', editingSchedule);
  };

  const transitionSchedule = (action, schedule) => sendMutation(action, schedule);

  const saveWithConflictDecisions = () => {
    if (!conflictPrompt || busy) return;
    const eventDecisions = (conflictPrompt.eventConflicts || []).map((item) => ({
      eventId: item.eventId,
      eventUpdatedAt: item.eventUpdatedAt,
      decision: conflictChoices['event:' + item.eventId],
    }));
    const protectedTimeDecisions = (conflictPrompt.protectedTimeConflicts || []).map((item) => ({
      blockId: item.blockId,
      blockUpdatedAt: item.blockUpdatedAt,
      occurrenceStartsAt: item.occurrenceStartsAt,
      decision: conflictChoices['protected:' + item.blockId + ':' + item.occurrenceStartsAt],
    }));
    const taskScheduleDecisions = (conflictPrompt.taskScheduleConflicts || []).map((item) => ({
      taskScheduleId: item.taskScheduleId,
      taskScheduleUpdatedAt: item.taskScheduleUpdatedAt,
      decision: conflictChoices['schedule:' + item.taskScheduleId],
    }));
    const decisions = { eventDecisions, protectedTimeDecisions, taskScheduleDecisions };
    setConflictPrompt(null);
    void sendMutation(editingSchedule ? 'edit' : 'create', editingSchedule, decisions);
  };

  const scheduleFormVisible = Boolean(startLocalDateTime && endLocalDateTime);

  return (
    <section className="task-schedule-page" aria-label="Reservas de tareas">
      <header className="task-schedule-heading">
        <div>
          <span className="agenda-section-kicker">AGENDA · TAREAS</span>
          <h2>Tiempo reservado para tus tareas</h2>
          <p>Programa una tarea existente en una franja concreta. Su fecha límite y su estado no se modifican.</p>
        </div>
        <button type="button" className="button button-primary" onClick={startNewSchedule} disabled={busy || tasks.length === 0}>
          ＋ Programar tarea
        </button>
      </header>

      {loading && <p className="muted">Cargando tareas y reservas…</p>}
      {!loading && localError && <div className="form-error">{localError}</div>}
      {!loading && !localError && tasks.length === 0 && (
        <EmptyState title="No hay tareas disponibles" description="Crea o reactiva una tarea antes de reservarle tiempo." />
      )}

      {scheduleFormVisible && (
        <form className="task-schedule-form" onSubmit={saveSchedule}>
          <div className="task-schedule-form-heading">
            <div><span className="agenda-section-kicker">{editingSchedule ? 'EDITAR RESERVA' : 'NUEVA RESERVA'}</span><h3>{editingSchedule ? 'Ajustar horario' : 'Elige una tarea y su franja'}</h3></div>
            <button type="button" className="agenda-close-button" aria-label="Cerrar formulario" onClick={() => { setStartLocalDateTime(''); setEndLocalDateTime(''); setEditingSchedule(null); setPendingKey(null); }}>×</button>
          </div>
          <label className="agenda-field">
            <span>Tarea</span>
            <select value={selectedTaskId} onChange={(event) => setSelectedTaskId(event.target.value)} disabled={busy || Boolean(editingSchedule)} required>
              {tasks.map((task) => <option key={task.id} value={task.id}>{task.action}</option>)}
            </select>
          </label>
          {selectedTaskId && taskById.get(selectedTaskId)?.due_date && (
            <p className="task-schedule-deadline">Fecha límite de la tarea: <strong>{taskById.get(selectedTaskId).due_date}</strong>. No se usa como hora reservada.</p>
          )}
          <div className="agenda-form-row">
            <label className="agenda-field"><span>Comienza</span><input type="datetime-local" value={startLocalDateTime} onChange={(event) => setStartLocalDateTime(event.target.value)} required disabled={busy} /></label>
            <label className="agenda-field"><span>Termina</span><input type="datetime-local" value={endLocalDateTime} onChange={(event) => setEndLocalDateTime(event.target.value)} required disabled={busy} /></label>
          </div>
          <p className="task-schedule-timezone">Zona horaria: <strong>{editingSchedule?.time_zone || timeZone}</strong></p>
          <footer className="agenda-dialog-actions">
            <button type="button" className="agenda-secondary-button" onClick={() => { setStartLocalDateTime(''); setEndLocalDateTime(''); setEditingSchedule(null); setPendingKey(null); }} disabled={busy}>Cancelar</button>
            <button type="submit" className="button button-primary" disabled={busy || !selectedTaskId || !startLocalDateTime || !endLocalDateTime}>
              {busy ? 'Guardando…' : editingSchedule ? 'Guardar horario' : 'Crear reserva'}
            </button>
          </footer>
        </form>
      )}

      {!loading && !localError && (
        <>
          <div className="task-schedule-section-heading">
            <h3>Reservas activas</h3><span>{activeSchedules.length}</span>
          </div>
          {activeSchedules.length === 0 ? (
            <EmptyState title="Todavía no hay reservas" description="Las tareas sin una franja reservada siguen siendo flexibles." />
          ) : (
            <div className="task-schedule-list">
              {activeSchedules.map((schedule) => {
                const task = taskById.get(schedule.task_id);
                return (
                  <article className="task-schedule-card" key={schedule.id}>
                    <div className="task-schedule-card-main">
                      <div className="task-schedule-card-title">
                        <strong>{task?.action || 'Tarea no disponible'}</strong>
                        <span className={'task-schedule-status is-' + schedule.schedule_status}>{STATUS_LABELS[schedule.schedule_status]}</span>
                      </div>
                      <p>{formatRange(schedule, schedule.time_zone || timeZone)}</p>
                      <small>{task?.due_date ? 'Fecha límite: ' + task.due_date : 'Sin fecha límite'} · La tarea conserva su estado propio</small>
                    </div>
                    <div className="task-schedule-actions">
                      <button type="button" className="agenda-secondary-button" onClick={() => startEditSchedule(schedule)} disabled={busy || !task}>Editar</button>
                      {schedule.schedule_status === 'proposed' && <button type="button" className="agenda-secondary-button" onClick={() => transitionSchedule('confirm', schedule)} disabled={busy}>Confirmar</button>}
                      {schedule.schedule_status === 'confirmed' && <button type="button" className="agenda-secondary-button" onClick={() => transitionSchedule('release', schedule)} disabled={busy}>Liberar</button>}
                      <button type="button" className="agenda-secondary-button agenda-action-warning" onClick={() => transitionSchedule('cancel', schedule)} disabled={busy}>Cancelar</button>
                    </div>
                  </article>
                );
              })}
            </div>
          )}

          {historicalSchedules.length > 0 && (
            <>
              <div className="task-schedule-section-heading"><h3>Historial</h3><span>{historicalSchedules.length}</span></div>
              <div className="task-schedule-list is-history">
                {historicalSchedules.map((schedule) => (
                  <article className="task-schedule-card" key={schedule.id}>
                    <div className="task-schedule-card-main">
                      <div className="task-schedule-card-title">
                        <strong>{taskById.get(schedule.task_id)?.action || 'Tarea no disponible'}</strong>
                        <span className={'task-schedule-status is-' + schedule.schedule_status}>{STATUS_LABELS[schedule.schedule_status]}</span>
                      </div>
                      <p>{formatRange(schedule, schedule.time_zone || timeZone)}</p>
                    </div>
                  </article>
                ))}
              </div>
            </>
          )}
        </>
      )}

      {conflictPrompt && (
        <ConflictDialog
          conflict={conflictPrompt}
          choices={conflictChoices}
          setChoices={setConflictChoices}
          onSave={saveWithConflictDecisions}
          onClose={() => { setConflictPrompt(null); setConflictChoices({}); }}
          busy={busy}
        />
      )}
    </section>
  );
}
