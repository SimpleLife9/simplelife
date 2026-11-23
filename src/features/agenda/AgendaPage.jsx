import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase.js';
import { uuidv7 } from '../../lib/uuidv7.js';
import { EmptyState } from '../../shared/components/EmptyState.jsx';
import {
  addCalendarDays,
  eventOccursOnDate,
  formatEventTime,
  getCalendarEventRange,
  getCalendarTaskScheduleRange,
  getCalendarWindow,
  getRecurringOccurrenceQueryWindow,
  monthGridDays,
  shiftCalendarPeriod,
  sortEventsForCalendar,
  sortTaskSchedulesForCalendar,
  taskScheduleOccursOnDate,
  startOfWeekMonday,
} from './domain/calendar-view.js';
import { createEventDraft } from './domain/event.js';
import { buildRecurringEventCreatePayload } from './domain/recurring-event-form.js';
import { formatInstantInTimeZone, isSupportedTimeZone } from './domain/temporal.js';
import './AgendaPage.css';
import { ProtectedTimePage } from './ProtectedTimePage.jsx';
import { TaskSchedulePage } from './TaskSchedulePage.jsx';
import './AgendaMutations.css';
import { formatUpcomingCountdown, formatUpcomingStart, getUpcomingAgendaItems } from './domain/upcoming.js';

const DEFAULT_TIME_ZONE = 'America/Havana';
const RECURRENCE_OCCURRENCE_PAGE_SIZE = 500;
const MAX_CALENDAR_RECURRENCE_OCCURRENCES = 10_000;
const VIEW_OPTIONS = [
  { id: 'day', label: 'Día' },
  { id: 'week', label: 'Semana' },
  { id: 'month', label: 'Mes' },
];
const WEEKDAY_LABELS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
const ISO_WEEKDAY_OPTIONS = [
  { code: 'MO', label: 'L' }, { code: 'TU', label: 'M' }, { code: 'WE', label: 'X' },
  { code: 'TH', label: 'J' }, { code: 'FR', label: 'V' }, { code: 'SA', label: 'S' }, { code: 'SU', label: 'D' },
];
function isoWeekdayForDate(value) {
  const weekday = new Date(value + 'T12:00:00.000Z').getUTCDay();
  return ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'][weekday];
}

function todayInZone(timeZone) {
  return formatInstantInTimeZone(new Date().toISOString(), timeZone).slice(0, 10);
}

function dateAtUtcNoon(dateKey) {
  return new Date(dateKey + 'T12:00:00.000Z');
}

function formatDate(dateKey, options = {}) {
  return new Intl.DateTimeFormat('es', {
    timeZone: 'UTC',
    day: 'numeric',
    month: 'long',
    ...options,
  }).format(dateAtUtcNoon(dateKey));
}

function getPeriodTitle(view, dateKey) {
  if (view === 'day') {
    return formatDate(dateKey, { weekday: 'long', year: 'numeric' });
  }
  if (view === 'week') {
    const first = startOfWeekMonday(dateKey);
    const last = addCalendarDays(first, 6);
    return formatDate(first, { day: 'numeric', month: 'short' })
      + ' — ' + formatDate(last, { day: 'numeric', month: 'short', year: 'numeric' });
  }
  return new Intl.DateTimeFormat('es', { month: 'long', year: 'numeric', timeZone: 'UTC' })
    .format(dateAtUtcNoon(dateKey.slice(0, 7) + '-01'));
}

function statusLabel(status) {
  return ({
    preparing: 'En preparación',
    proposed: 'Propuesto',
    confirmed: 'Confirmado',
    cancelled: 'Cancelado',
    finished: 'Finalizado',
  })[status] || status;
}

function getEventDateLabel(event, timeZone) {
  const range = getCalendarEventRange(event, timeZone);
  if (range.temporalKind === 'all_day') {
    const last = addCalendarDays(range.endDateExclusive, -1);
    return range.startDate === last
      ? formatDate(range.startDate, { day: 'numeric', month: 'long', year: 'numeric' })
      : formatDate(range.startDate, { day: 'numeric', month: 'short' })
        + ' — ' + formatDate(last, { day: 'numeric', month: 'short', year: 'numeric' });
  }
  if (range.startDate === range.endDate) {
    return formatDate(range.startDate, { day: 'numeric', month: 'long', year: 'numeric' });
  }
  return formatDate(range.startDate, { day: 'numeric', month: 'short' })
    + ' — ' + formatDate(range.endDate, { day: 'numeric', month: 'short', year: 'numeric' });
}

function buildEventRequest(draft) {
  const common = {
    title: draft.title,
    description: draft.description,
    locationLabel: draft.locationLabel,
    locationKind: draft.locationKind,
    eventStatus: draft.eventStatus,
    temporalKind: draft.temporal.kind,
  };
  if (draft.temporal.kind === 'all_day') {
    return {
      ...common,
      startDate: draft.temporal.startDate,
      endDateExclusive: draft.temporal.endDateExclusive,
    };
  }
  if (draft.temporal.kind === 'zoned_civil') {
    return {
      ...common,
      timeZone: draft.temporal.timeZone,
      startLocalDateTime: draft.temporal.startLocalDateTime,
      endLocalDateTime: draft.temporal.endLocalDateTime,
      startDisambiguation: draft.temporal.startDisambiguation,
      endDisambiguation: draft.temporal.endDisambiguation,
      startGapStrategy: draft.temporal.startGapStrategy,
      endGapStrategy: draft.temporal.endGapStrategy,
    };
  }
  return {
    ...common,
    startsAt: draft.temporal.startsAt,
    endsAt: draft.temporal.endsAt,
    sourceTimeZone: draft.temporal.sourceTimeZone,
  };
}

function EventChip({ event, timeZone, onClick, compact = false }) {
  return (
    <button
      type="button"
      className={'agenda-event-chip' + (event.event_status === 'proposed' ? ' is-proposed' : '') + (compact ? ' is-compact' : '')}
      onClick={() => onClick(event)}
      title={event.title + ' · ' + formatEventTime(event, timeZone)}
    >
      {event.temporal_kind !== 'all_day' && <span className="agenda-event-chip-time">{formatEventTime(event, timeZone).split(' ')[0]}</span>}
      <span className="agenda-event-chip-title">{event.title}</span>
    </button>
  );
}

function TaskScheduleChip({ schedule, task, compact = false }) {
  const range = getCalendarTaskScheduleRange(schedule);
  const timeLabel = range.startDate === range.endDate
    ? range.startTime + ' – ' + range.endTime
    : range.startTime + ' · hasta ' + range.endDate + ' ' + range.endTime;
  const title = task?.action || 'Tarea programada';
  return (
    <div
      className={'agenda-task-schedule-chip' + (compact ? ' is-compact' : '')}
      role="group"
      aria-label={'Tarea reservada: ' + title}
      title={title + ' · ' + timeLabel + ' · ' + (schedule.time_zone || '')}
    >
      <span className="agenda-task-schedule-chip-time">{range.startTime}</span>
      <span className="agenda-task-schedule-chip-title">{title}</span>
    </div>
  );
}

function AgendaCalendarPage({ profile, refreshKey, runAction, busy }) {
  const [events, setEvents] = useState([]);
  const [taskSchedules, setTaskSchedules] = useState([]);
  const [scheduledTasks, setScheduledTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [clockNow, setClockNow] = useState(() => Date.now());
  const [localError, setLocalError] = useState('');
  const [timeZone, setTimeZone] = useState(DEFAULT_TIME_ZONE);
  const [timeZoneNotice, setTimeZoneNotice] = useState('');
  const [view, setView] = useState('week');
  const [lifecycleView, setLifecycleView] = useState('active');
  const [selectedDate, setSelectedDate] = useState(null);
  const [showComposer, setShowComposer] = useState(false);
  const [editingEvent, setEditingEvent] = useState(null);
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [confirmAction, setConfirmAction] = useState(null);
  const [pendingKey, setPendingKey] = useState(null);
  const [protectedConflictPrompt, setProtectedConflictPrompt] = useState(null);
  const [protectedConflictChoices, setProtectedConflictChoices] = useState({});
  const [taskScheduleConflictPrompt, setTaskScheduleConflictPrompt] = useState(null);
  const [taskScheduleConflictChoices, setTaskScheduleConflictChoices] = useState({});
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [locationLabel, setLocationLabel] = useState('');
  const [locationKind, setLocationKind] = useState('');
  const [temporalKind, setTemporalKind] = useState('all_day');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [startLocalDateTime, setStartLocalDateTime] = useState('');
  const [endLocalDateTime, setEndLocalDateTime] = useState('');
  const [eventTimeZone, setEventTimeZone] = useState(DEFAULT_TIME_ZONE);
  const [fixedStartsAt, setFixedStartsAt] = useState('');
  const [fixedEndsAt, setFixedEndsAt] = useState('');
  const [recurrenceFrequency, setRecurrenceFrequency] = useState('none');
  const [recurrenceInterval, setRecurrenceInterval] = useState('1');
  const [recurrenceCount, setRecurrenceCount] = useState('12');
  const [recurrenceWeekdays, setRecurrenceWeekdays] = useState([]);
  const [recurrenceWeekdaysTouched, setRecurrenceWeekdaysTouched] = useState(false);

  useEffect(() => {
    const timer = window.setInterval(() => setClockNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

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
      if (error) {
        setTimeZoneNotice('No se pudo leer tu zona horaria guardada; se usa America/Havana.');
        return;
      }
      if (data?.time_zone) {
        if (!isSupportedTimeZone(data.time_zone)) {
          setTimeZoneNotice('Tu preferencia de zona horaria no es válida; se usa America/Havana.');
          return;
        }
        setTimeZone(data.time_zone);
        setEventTimeZone(data.time_zone);
      }
    }
    void loadPreference();
    return () => { alive = false; };
  }, [profile?.id]);

  useEffect(() => {
    let alive = true;
    async function loadEvents() {
      if (!profile?.id) return;
      setLoading(true);
      setLocalError('');
      try {
        // RLS restricts this SELECT to the profile associated with auth.uid().
        // There is intentionally no browser write path for calendar_event.
        let query = supabase.from('calendar_event').select('*');
        if (lifecycleView === 'active') {
          query = query.is('archived_at', null).is('deleted_at', null);
        } else if (lifecycleView === 'archived') {
          query = query.not('archived_at', 'is', null).is('deleted_at', null);
        } else {
          query = query.not('deleted_at', 'is', null);
        }
        const scheduleQuery = lifecycleView === 'active'
          ? supabase.from('task_schedule')
            .select('id,task_id,schedule_status,start_local,end_local,time_zone,starts_at,ends_at')
            .eq('owner_user_id', profile.id)
            .in('schedule_status', ['proposed', 'confirmed'])
            .order('starts_at', { ascending: true })
          : Promise.resolve({ data: [], error: null });
        const [eventResult, scheduleResult] = await Promise.all([
          query.order('created_at', { ascending: false }),
          scheduleQuery,
        ]);
        if (eventResult.error) throw eventResult.error;
        if (scheduleResult.error) throw scheduleResult.error;
        const loadedEvents = eventResult.data || [];
        const activeSeries = lifecycleView === 'active'
          ? loadedEvents.filter((item) => item.recurrence_rule
            && !['cancelled', 'finished'].includes(item.event_status))
          : [];
        let recurringOccurrences = [];
        if (activeSeries.length > 0) {
          const occurrenceWindow = getRecurringOccurrenceQueryWindow(view, activeDate);
          // This excludes the rest of the 90-day materialized horizon while
          // retaining occurrences whose maximum 30-day end offset overlaps the view.
          const rows = [];
          for (let offset = 0; offset <= MAX_CALENDAR_RECURRENCE_OCCURRENCES; offset += RECURRENCE_OCCURRENCE_PAGE_SIZE) {
            const occurrenceResult = await supabase.from('calendar_event_occurrence')
              .select('*')
              .in('calendar_event_id', activeSeries.map((item) => item.id))
              .in('occurrence_status', ['scheduled', 'needs_review'])
              .gte('original_local_date', occurrenceWindow.startDate)
              .lt('original_local_date', occurrenceWindow.endDateExclusive)
              .order('original_local_date', { ascending: true })
              .order('occurrence_key', { ascending: true })
              .range(offset, offset + RECURRENCE_OCCURRENCE_PAGE_SIZE - 1);
            if (occurrenceResult.error) throw occurrenceResult.error;
            const pageRows = occurrenceResult.data || [];
            if (offset === MAX_CALENDAR_RECURRENCE_OCCURRENCES && pageRows.length > 0) {
              throw new Error('La vista actual contiene más de 10.000 ocurrencias recurrentes. Reduce el período o separa las series.');
            }
            rows.push(...pageRows);
            if (pageRows.length < RECURRENCE_OCCURRENCE_PAGE_SIZE) break;
          }
          const seriesById = new Map(activeSeries.map((item) => [item.id, item]));
          recurringOccurrences = rows.flatMap((row) => {
            const series = seriesById.get(row.calendar_event_id);
            if (!series) return [];
            return [{
              ...series,
              id: 'recurring-occurrence:' + row.id,
              series_event_id: series.id,
              occurrence_id: row.id,
              occurrence_key: row.occurrence_key,
              occurrence_status: row.occurrence_status,
              is_recurring_occurrence: true,
              temporal_kind: row.temporal_kind,
              start_date: row.start_date,
              end_date_exclusive: row.end_date_exclusive,
              start_local: row.start_local,
              end_local: row.end_local,
              time_zone: row.time_zone,
              starts_at: row.starts_at,
              ends_at: row.ends_at,
              start_disambiguation: row.start_disambiguation,
              end_disambiguation: row.end_disambiguation,
            }];
          });
        }
        const oneOffOrNonActiveEvents = loadedEvents.filter((item) =>
          !item.recurrence_rule || lifecycleView !== 'active');
        const nextEvents = [...oneOffOrNonActiveEvents, ...recurringOccurrences];
        const nextSchedules = scheduleResult.data || [];
        const taskIds = [...new Set(nextSchedules.map((item) => item.task_id))];
        let nextTasks = [];
        if (taskIds.length > 0) {
          const taskResult = await supabase.from('task')
            .select('id,action')
            .in('id', taskIds);
          if (taskResult.error) throw taskResult.error;
          nextTasks = taskResult.data || [];
        }
        if (alive) {
          setEvents(nextEvents);
          setTaskSchedules(nextSchedules);
          setScheduledTasks(nextTasks);
        }
      } catch (error) {
        if (alive) setLocalError(error?.message || 'No se pudieron cargar los eventos.');
      } finally {
        if (alive) setLoading(false);
      }
    }
    void loadEvents();
    return () => { alive = false; };
  }, [profile?.id, refreshKey, lifecycleView]);

  const today = todayInZone(timeZone);
  const activeDate = selectedDate || today;
  const orderedEvents = useMemo(() => sortEventsForCalendar(events, timeZone), [events, timeZone]);
  const orderedTaskSchedules = useMemo(
    () => sortTaskSchedulesForCalendar(taskSchedules),
    [taskSchedules],
  );
  const scheduledTaskById = useMemo(
    () => new Map(scheduledTasks.map((task) => [task.id, task])),
    [scheduledTasks],
  );
  const upcomingItems = useMemo(() => getUpcomingAgendaItems({
    events,
    taskSchedules,
    tasks: scheduledTasks,
    now: clockNow,
    viewerTimeZone: timeZone,
    maxItems: 4,
  }), [events, taskSchedules, scheduledTasks, clockNow, timeZone]);
  const openComposer = () => {
    setEditingEvent(null);
    setTitle('');
    setDescription('');
    setLocationLabel('');
    setLocationKind('');
    setTemporalKind('all_day');
    setStartDate(activeDate);
    setEndDate(activeDate);
    setStartLocalDateTime(activeDate + 'T09:00');
    setEndLocalDateTime(activeDate + 'T10:00');
    setEventTimeZone(timeZone);
    setFixedStartsAt('');
    setFixedEndsAt('');
    setRecurrenceFrequency('none');
    setRecurrenceInterval('1');
    setRecurrenceCount('12');
    setRecurrenceWeekdays([]);
    setRecurrenceWeekdaysTouched(false);
    setPendingKey(null);
    setShowComposer(true);
  };

  const openEventDetail = (event) => {
    setPendingKey(null);
    setConfirmAction(null);
    setSelectedEvent(event);
  };

  // Keep seconds and milliseconds from the persisted civil-time intent.
  // datetime-local with step=0.001 accepts millisecond precision.
  const localInputValue = (value) => String(value || '').replace(' ', 'T').slice(0, 23);

  const openEditComposer = (event) => {
    setEditingEvent(event);
    setTitle(event.title || '');
    setDescription(event.description || '');
    setLocationLabel(event.location_label || '');
    setLocationKind(event.location_kind || '');
    setTemporalKind(event.temporal_kind);
    if (event.temporal_kind === 'all_day') {
      setStartDate(event.start_date);
      setEndDate(addCalendarDays(event.end_date_exclusive, -1));
    } else if (event.temporal_kind === 'zoned_civil') {
      setStartLocalDateTime(localInputValue(event.start_local));
      setEndLocalDateTime(localInputValue(event.end_local));
    } else {
      setFixedStartsAt(event.starts_at);
      setFixedEndsAt(event.ends_at);
    }
    setEventTimeZone(event.time_zone || timeZone);
    setRecurrenceFrequency('none');
    setRecurrenceInterval('1');
    setRecurrenceCount('12');
    setRecurrenceWeekdays([]);
    setRecurrenceWeekdaysTouched(false);
    setPendingKey(null);
    setSelectedEvent(null);
    setShowComposer(true);
  };

  const closeComposer = () => {
    if (busy) return;
    setShowComposer(false);
    setEditingEvent(null);
    setRecurrenceFrequency('none');
    setRecurrenceWeekdays([]);
    setRecurrenceWeekdaysTouched(false);
    setPendingKey(null);
  };

  const submitEvent = async (
    event,
    acceptedProtectedTimeDecisions = undefined,
    acceptedTaskScheduleDecisions = undefined,
  ) => {
    event.preventDefault();
    const key = pendingKey || uuidv7();
    const creatingRecurring = !editingEvent && recurrenceFrequency !== 'none';
    setPendingKey(key);
    const success = await runAction(async () => {
      let draftInput;
      if (temporalKind === 'all_day') {
        draftInput = {
          title,
          description,
          locationLabel,
          locationKind: locationKind || null,
          eventStatus: editingEvent?.event_status || 'confirmed',
          temporalKind: 'all_day',
          startDate,
          endDateExclusive: addCalendarDays(endDate, 1),
        };
      } else if (temporalKind === 'zoned_civil') {
        draftInput = {
          title,
          description,
          locationLabel,
          locationKind: locationKind || null,
          eventStatus: editingEvent?.event_status || 'confirmed',
          temporalKind: 'zoned_civil',
          timeZone: eventTimeZone,
          startLocalDateTime,
          endLocalDateTime,
          startDisambiguation: 'earlier',
          endDisambiguation: 'earlier',
          startGapStrategy: 'next-valid',
          endGapStrategy: 'next-valid',
        };
      } else {
        if (!editingEvent || !fixedStartsAt || !fixedEndsAt) {
          throw new Error('Los eventos de instante fijo solo conservan su intervalo original al editar.');
        }
        draftInput = {
          title,
          description,
          locationLabel,
          locationKind: locationKind || null,
          eventStatus: editingEvent.event_status,
          temporalKind: 'fixed_instant',
          startsAt: fixedStartsAt,
          endsAt: fixedEndsAt,
          sourceTimeZone: editingEvent.time_zone || null,
        };
      }
      const draft = createEventDraft(draftInput);
      if (creatingRecurring) {
        const recurring = buildRecurringEventCreatePayload({
          eventDraft: draft,
          frequency: recurrenceFrequency,
          interval: Number(recurrenceInterval),
          count: Number(recurrenceCount),
          weekdays: recurrenceWeekdays,
        });
        const { data, error } = await supabase.functions.invoke('agenda-event-series-create', {
          body: {
            event: buildEventRequest(draft),
            recurrenceRule: recurring.recurrenceRule,
            endLocalTime: recurring.endLocalTime,
            endDayOffset: recurring.endDayOffset,
          },
          headers: { 'Idempotency-Key': key },
        });
        if (error) {
          let message = error.message || 'No se pudo crear la serie recurrente.';
          try {
            const response = error.context instanceof Response ? await error.context.clone().json() : null;
            if (response?.error === 'PROTECTED_TIME_CONFLICTS') {
              message = 'La ocurrencia ' + (response.occurrenceKey || '') + ' coincide con Tiempo Protegido. No se guardó la serie.';
            } else if (response?.error === 'TASK_SCHEDULE_CONFLICTS') {
              message = 'La ocurrencia ' + (response.occurrenceKey || '') + ' coincide con una tarea reservada. No se guardó la serie.';
            } else if (response?.error) {
              message = response.error;
            }
          } catch { /* keep SDK error message */ }
          throw new Error(message);
        }
        if (!data?.seriesEventId || typeof data.materializedCount !== 'number') {
          throw new Error('El servidor no devolvió la serie y sus ocurrencias materializadas.');
        }
        return;
      }
      const protectedTimeBody = acceptedProtectedTimeDecisions === undefined
        ? {}
        : { protectedTimeDecisions: acceptedProtectedTimeDecisions };
      const taskScheduleBody = acceptedTaskScheduleDecisions === undefined
        ? {}
        : { taskScheduleDecisions: acceptedTaskScheduleDecisions };
      const { data, error } = editingEvent
        ? await supabase.functions.invoke('agenda-event-mutate', {
          body: {
            eventId: editingEvent.id,
            expectedUpdatedAt: editingEvent.updated_at,
            action: 'edit',
            event: buildEventRequest(draft),
            ...protectedTimeBody,
            ...taskScheduleBody,
          },
          headers: { 'Idempotency-Key': key },
        })
        : await supabase.functions.invoke('agenda-event-create', {
          body: {
            event: buildEventRequest(draft),
            ...protectedTimeBody,
            ...taskScheduleBody,
          },
          headers: { 'Idempotency-Key': key },
        });
      if (error) {
        let message = error.message || 'No se pudo guardar el evento.';
        let response = null;
        try {
          response = error.context instanceof Response ? await error.context.clone().json() : null;
          if (response?.error) message = response.error;
        } catch { /* keep SDK error message */ }
        if (response?.error === 'TASK_SCHEDULE_CONFLICTS'
          || response?.error === 'TASK_SCHEDULE_CONFLICTS_CHANGED') {
          if (response.error === 'TASK_SCHEDULE_CONFLICTS_CHANGED') setPendingKey(null);
          setTaskScheduleConflictPrompt({
            error: response.error,
            action: 'submit',
            conflicts: Array.isArray(response.conflicts) ? response.conflicts : [],
            protectedTimeDecisions: acceptedProtectedTimeDecisions,
          });
          setTaskScheduleConflictChoices({});
          message = response.error === 'TASK_SCHEDULE_CONFLICTS_CHANGED'
            ? 'Las reservas de tareas cambiaron mientras guardabas. Revisa el horario y vuelve a guardar.'
            : 'El evento coincide con una reserva de tarea. Decide explícitamente cómo conservar ambos compromisos.';
        }
        if (response?.error === 'PROTECTED_TIME_CONFLICTS'
          || response?.error === 'PROTECTED_TIME_CONFLICTS_CHANGED') {
          setProtectedConflictPrompt({
            error: response.error,
            action: 'submit',
            conflicts: Array.isArray(response.conflicts) ? response.conflicts : [],
            taskScheduleDecisions: acceptedTaskScheduleDecisions,
          });
          setProtectedConflictChoices({});
          message = response.error === 'PROTECTED_TIME_CONFLICTS_CHANGED'
            ? 'Los bloques protegidos cambiaron mientras guardabas. Revisa el horario y vuelve a guardar.'
            : 'La Agenda detectó cruces con tu tiempo protegido. Debes decidir cómo continuar.';
        }
        throw new Error(message);
      }
      if (!data?.eventId) throw new Error('El servidor no devolvió el identificador del evento.');
    }, creatingRecurring ? 'Serie recurrente creada en Agenda.' : editingEvent ? 'Cambios guardados.' : 'Evento guardado en Agenda.');

    if (success) {
      setShowComposer(false);
      setEditingEvent(null);
      setSelectedEvent(null);
      setPendingKey(null);
      setProtectedConflictPrompt(null);
      setProtectedConflictChoices({});
      setTaskScheduleConflictPrompt(null);
      setTaskScheduleConflictChoices({});
    }
  };

  const protectedConflictItems = protectedConflictPrompt?.conflicts ?? [];
  const protectedConflictDecisionsReady = protectedConflictItems.length > 0
    && protectedConflictItems.every((conflict) =>
      protectedConflictChoices[conflict.conflictKey] === conflict.requiredDecision);
  const hasRescheduleChoice = protectedConflictItems.some((conflict) =>
    protectedConflictChoices[conflict.conflictKey] === 'reschedule');

  const closeProtectedConflictPrompt = () => {
    if (busy) return;
    setProtectedConflictPrompt(null);
    setProtectedConflictChoices({});
  };

  const saveWithProtectedTimeDecisions = () => {
    if (!protectedConflictDecisionsReady || hasRescheduleChoice || busy) return;
    const decisions = protectedConflictItems.map((conflict) => ({
      blockId: conflict.blockId,
      blockUpdatedAt: conflict.blockUpdatedAt,
      occurrenceStartsAt: conflict.occurrenceStartsAt,
      decision: protectedConflictChoices[conflict.conflictKey],
    }));
    const promptAction = protectedConflictPrompt.action;
    const taskScheduleDecisions = protectedConflictPrompt.taskScheduleDecisions;
    setProtectedConflictPrompt(null);
    if (promptAction === 'reopen' || promptAction === 'restore') {
      void mutateSelectedEvent(promptAction, taskScheduleDecisions, decisions);
    } else {
      void submitEvent({ preventDefault() {} }, decisions, taskScheduleDecisions);
    }
  };

  const taskScheduleConflictItems = taskScheduleConflictPrompt?.conflicts ?? [];
  const taskScheduleConflictDecisionsReady = taskScheduleConflictItems.length > 0
    && taskScheduleConflictItems.every((conflict) =>
      taskScheduleConflictChoices[conflict.taskScheduleId] === 'keep_overlap');

  const closeTaskScheduleConflictPrompt = () => {
    if (busy) return;
    setTaskScheduleConflictPrompt(null);
    setTaskScheduleConflictChoices({});
  };

  const saveWithTaskScheduleDecisions = () => {
    if (!taskScheduleConflictDecisionsReady || busy) return;
    const decisions = taskScheduleConflictItems.map((conflict) => ({
      taskScheduleId: conflict.taskScheduleId,
      taskScheduleUpdatedAt: conflict.taskScheduleUpdatedAt,
      decision: taskScheduleConflictChoices[conflict.taskScheduleId],
    }));
    const promptAction = taskScheduleConflictPrompt.action;
    const protectedDecisions = taskScheduleConflictPrompt.protectedTimeDecisions;
    setTaskScheduleConflictPrompt(null);
    if (promptAction === 'reopen' || promptAction === 'restore') {
      void mutateSelectedEvent(promptAction, decisions, protectedDecisions);
    } else {
      void submitEvent({ preventDefault() {} }, protectedDecisions, decisions);
    }
  };

  const mutateSelectedEvent = async (
    action,
    acceptedTaskScheduleDecisions = undefined,
    acceptedProtectedTimeDecisions = undefined,
  ) => {
    if (!selectedEvent) return;
    const key = pendingKey || uuidv7();
    setPendingKey(key);
    const target = selectedEvent;
    const messages = {
      cancel: 'Evento cancelado.',
      reopen: 'Evento reabierto.',
      finish: 'Evento finalizado.',
      archive: 'Evento archivado.',
      restore: lifecycleView === 'trash' ? 'Evento restaurado.' : 'Evento restaurado.',
      trash: 'Evento movido a la papelera.',
    };
    const success = await runAction(async () => {
      const { data, error } = await supabase.functions.invoke('agenda-event-mutate', {
        body: {
          eventId: target.id,
          expectedUpdatedAt: target.updated_at,
          action,
          ...(acceptedTaskScheduleDecisions === undefined ? {} : { taskScheduleDecisions: acceptedTaskScheduleDecisions }),
          ...(acceptedProtectedTimeDecisions === undefined ? {} : { protectedTimeDecisions: acceptedProtectedTimeDecisions }),
        },
        headers: { 'Idempotency-Key': key },
      });
      if (error) {
        let message = error.message || 'No se pudo actualizar el evento.';
        let response = null;
        try {
          response = error.context instanceof Response ? await error.context.clone().json() : null;
          if (response?.error) message = response.error;
        } catch { /* keep SDK error message */ }
        if (response?.error === 'PROTECTED_TIME_CONFLICTS'
          || response?.error === 'PROTECTED_TIME_CONFLICTS_CHANGED') {
          if (response.error === 'PROTECTED_TIME_CONFLICTS_CHANGED') setPendingKey(null);
          setProtectedConflictPrompt({
            error: response.error,
            action,
            conflicts: Array.isArray(response.conflicts) ? response.conflicts : [],
            taskScheduleDecisions: acceptedTaskScheduleDecisions,
          });
          setProtectedConflictChoices({});
          message = response.error === 'PROTECTED_TIME_CONFLICTS_CHANGED'
            ? 'Los bloques protegidos cambiaron mientras se reactivaba el evento. Revisa los cruces actuales.'
            : 'El evento no se reabrió ni restauró. Decide explícitamente cómo conservar el tiempo protegido.';
        }
        if (response?.error === 'TASK_SCHEDULE_CONFLICTS'
          || response?.error === 'TASK_SCHEDULE_CONFLICTS_CHANGED') {
          if (response.error === 'TASK_SCHEDULE_CONFLICTS_CHANGED') setPendingKey(null);
          setTaskScheduleConflictPrompt({
            error: response.error,
            action,
            conflicts: Array.isArray(response.conflicts) ? response.conflicts : [],
            protectedTimeDecisions: acceptedProtectedTimeDecisions,
          });
          setTaskScheduleConflictChoices({});
          message = response.error === 'TASK_SCHEDULE_CONFLICTS_CHANGED'
            ? 'Las reservas de tareas cambiaron mientras se reactivaba el evento. Revisa los cruces actuales.'
            : action === 'restore'
              ? 'El evento no se restauró. Decide explícitamente cómo conservar los horarios superpuestos.'
              : 'El evento no se reabrió. Decide explícitamente cómo conservar los horarios superpuestos.';
        }
        throw new Error(message);
      }
      if (!data?.eventId) throw new Error('El servidor no confirmó el cambio del evento.');
    }, messages[action] || 'Evento actualizado.');
    if (success) {
      setSelectedEvent(null);
      setConfirmAction(null);
      setPendingKey(null);
    }
  };

  const lifecycleLabel = (event) => event.deleted_at
    ? 'En papelera'
    : event.archived_at ? 'Archivado' : 'Activo';

  const canEditEvent = (event) => !event.archived_at && !event.deleted_at
    && !['cancelled', 'finished'].includes(event.event_status);
  const isActiveEvent = (event) => !event.archived_at && !event.deleted_at;
  const canRestoreEvent = (event) => {
    if (event.deleted_at) return Boolean(event.purge_after && Date.parse(event.purge_after) > Date.now());
    return Boolean(event.archived_at);
  };
  const requestEventMutation = (action) => {
    setPendingKey(null);
    setConfirmAction(action);
  };
  const confirmDetails = {
    cancel: {
      title: 'Cancelar evento',
      description: 'El evento conservará su fecha y su historial, pero quedará marcado como cancelado.',
      button: 'Confirmar cancelación',
    },
    finish: {
      title: 'Finalizar evento',
      description: 'El evento pasará al estado finalizado. No podrá cancelarse después.',
      button: 'Confirmar finalización',
    },
    archive: {
      title: 'Archivar evento',
      description: 'El evento saldrá de la agenda activa, pero podrá restaurarse más adelante.',
      button: 'Archivar',
    },
    trash: {
      title: 'Mover a papelera',
      description: 'El evento se conservará durante 30 días para permitir su restauración. No se borrará físicamente.',
      button: 'Mover a papelera',
    },
  };


  const eventsForDate = (dateKey) => orderedEvents.filter((event) => eventOccursOnDate(event, dateKey, timeZone));
  const taskSchedulesForDate = (dateKey) => orderedTaskSchedules
    .filter((schedule) => taskScheduleOccursOnDate(schedule, dateKey));
  const allDayEvents = eventsForDate(activeDate).filter((event) => event.temporal_kind === 'all_day');
  const timedEvents = eventsForDate(activeDate).filter((event) => event.temporal_kind !== 'all_day');
  const dayTaskSchedules = taskSchedulesForDate(activeDate);
  const dayTimelineItems = [
    ...timedEvents.map((item) => ({ kind: 'event', item, sortAt: Date.parse(item.starts_at) })),
    ...dayTaskSchedules.map((item) => ({ kind: 'task_schedule', item, sortAt: Date.parse(item.starts_at) })),
  ].sort((left, right) => left.sortAt - right.sortAt);
  const monthDays = view === 'month' ? monthGridDays(activeDate) : [];
  const weekDays = view === 'week'
    ? Array.from({ length: 7 }, (_, index) => addCalendarDays(startOfWeekMonday(activeDate), index))
    : [];

  return (
    <div className="agenda-page">
      <section className="agenda-toolbar" aria-label="Controles del calendario">
        <div className="agenda-period-controls">
          <button type="button" className="agenda-today-button" onClick={() => setSelectedDate(today)}>Hoy</button>
          <div className="agenda-stepper">
            <button type="button" aria-label="Período anterior" onClick={() => setSelectedDate(shiftCalendarPeriod(view, activeDate, -1))}>‹</button>
            <button type="button" aria-label="Período siguiente" onClick={() => setSelectedDate(shiftCalendarPeriod(view, activeDate, 1))}>›</button>
          </div>
          <h2 className="agenda-period-title">{getPeriodTitle(view, activeDate)}</h2>
        </div>
        <div className="agenda-toolbar-actions">
          <div className="agenda-view-switch" role="group" aria-label="Vista del calendario">
            {VIEW_OPTIONS.map((option) => (
              <button
                type="button"
                key={option.id}
                className={view === option.id ? 'active' : ''}
                aria-pressed={view === option.id}
                onClick={() => setView(option.id)}
              >
                {option.label}
              </button>
            ))}
          </div>
          <button type="button" className="button button-primary agenda-create-button" onClick={openComposer} disabled={busy}>
            <span>＋</span> Nuevo evento
          </button>
        </div>
      </section>

      <nav className="agenda-lifecycle-switch" aria-label="Estado de los eventos">
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
            onClick={() => { setLifecycleView(item.id); setSelectedEvent(null); setPendingKey(null); }}
          >
            {item.label}
          </button>
        ))}
      </nav>

      {timeZoneNotice && <div className="agenda-timezone-notice">{timeZoneNotice}</div>}
      {!loading && !localError && (
        <section className="agenda-upcoming-panel" aria-label="Próximos compromisos">
          <div className="agenda-upcoming-heading">
            <div>
              <span className="agenda-section-kicker">AGENDA ACTIVA</span>
              <h3>Próximos compromisos</h3>
            </div>
            <span>Se actualiza mientras la Agenda está abierta</span>
          </div>
          {upcomingItems.length > 0 ? (
            <div className="agenda-upcoming-list">
              {upcomingItems.map((item) => {
                const content = (
                  <>
                    <span className={'agenda-upcoming-kind' + (item.kind === 'task_schedule' ? ' is-task' : '')}>
                      {item.kind === 'task_schedule' ? 'TAREA RESERVADA' : item.allDay ? 'EVENTO · TODO EL DÍA' : 'EVENTO'}
                    </span>
                    <strong>{item.title}</strong>
                    <span className="agenda-upcoming-start">{formatUpcomingStart(item, timeZone)}</span>
                    <span className={'agenda-upcoming-countdown' + (item.state === 'ongoing' ? ' is-ongoing' : '')}>
                      {formatUpcomingCountdown(item, clockNow)}
                    </span>
                  </>
                );
                return item.kind === 'event' ? (
                  <button
                    type="button"
                    className="agenda-upcoming-card"
                    key={item.kind + ':' + item.id}
                    onClick={() => openEventDetail(item.source)}
                  >
                    {content}
                  </button>
                ) : (
                  <div className="agenda-upcoming-card is-task" role="group" key={item.kind + ':' + item.id}>
                    {content}
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="agenda-upcoming-empty">No hay compromisos próximos. Tu calendario está despejado.</p>
          )}
        </section>
      )}
      {loading && <p className="muted agenda-loading">Cargando Agenda…</p>}
      {!loading && localError && <div className="form-error agenda-error">{localError}</div>}

      {!loading && !localError && (
        <>
          {view === 'day' && (
            <section className="agenda-day-view" aria-label="Agenda diaria">
              <div className="agenda-day-summary">
                <div><span className="agenda-section-kicker">DÍA SELECCIONADO</span><strong>{formatDate(activeDate, { weekday: 'long', day: 'numeric', month: 'long' })}</strong></div>
                <span>{eventsForDate(activeDate).length} eventos · {dayTaskSchedules.length} tareas reservadas</span>
              </div>
              {allDayEvents.length > 0 && (
                <div className="agenda-all-day-lane">
                  <div className="agenda-lane-label">Todo el día</div>
                  <div className="agenda-lane-events">
                    {allDayEvents.map((item) => <EventChip key={item.id} event={item} timeZone={timeZone} onClick={openEventDetail} />)}
                  </div>
                </div>
              )}
              {dayTimelineItems.length > 0 ? (
                <div className="agenda-timeline">
                  {dayTimelineItems.map(({ kind, item }) => {
                    if (kind === 'task_schedule') {
                      const range = getCalendarTaskScheduleRange(item);
                      const continues = range.startDate < activeDate;
                      return (
                        <div className="agenda-timeline-row" key={'task-schedule:' + item.id}>
                          <div className="agenda-timeline-time">{continues ? 'Sigue' : range.startTime}</div>
                          <div className="agenda-timeline-track">
                            <span className="agenda-timeline-marker is-task-schedule" />
                            <div
                              className="agenda-timeline-card is-task-schedule"
                              role="group"
                              aria-label={'Tarea reservada: ' + (scheduledTaskById.get(item.task_id)?.action || 'Tarea programada')}
                            >
                              <strong>{scheduledTaskById.get(item.task_id)?.action || 'Tarea programada'}</strong>
                              <span>{continues ? 'Continúa · ' : ''}{range.startDate === range.endDate
                                ? range.startTime + ' – ' + range.endTime
                                : range.startTime + ' · hasta ' + range.endDate + ' ' + range.endTime}</span>
                              <small>Tiempo reservado para una tarea</small>
                            </div>
                          </div>
                        </div>
                      );
                    }
                    const range = getCalendarEventRange(item, timeZone);
                    const continues = range.startDate < activeDate;
                    return (
                      <div className="agenda-timeline-row" key={'event:' + item.id}>
                        <div className="agenda-timeline-time">{continues ? 'Sigue' : range.startTime}</div>
                        <div className="agenda-timeline-track">
                          <span className="agenda-timeline-marker" />
                          <button type="button" className="agenda-timeline-card" onClick={() => openEventDetail(item)}>
                            <strong>{item.title}</strong>
                            <span>{continues ? 'Continúa · ' : ''}{formatEventTime(item, timeZone)}</span>
                            {item.location_label && <small>{item.location_label}</small>}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : allDayEvents.length === 0 ? (
                <EmptyState title="Tu calendario está despejado" detail="Crea un evento o programa una tarea para reservar tiempo en este día." icon="◷" />
              ) : null}
            </section>
          )}

          {view === 'week' && (
            <section className="agenda-week-scroll" aria-label="Agenda semanal">
              <div className="agenda-week-grid">
                {weekDays.map((dateKey) => {
                  const dayEvents = eventsForDate(dateKey);
                  const daySchedules = taskSchedulesForDate(dateKey);
                  const dayItems = [
                    ...dayEvents.map((item) => ({
                      kind: 'event',
                      item,
                      sortAt: item.temporal_kind === 'all_day'
                        ? Date.parse(item.start_date + 'T00:00:00.000Z')
                        : Date.parse(item.starts_at),
                    })),
                    ...daySchedules.map((item) => ({ kind: 'task_schedule', item, sortAt: Date.parse(item.starts_at) })),
                  ].sort((left, right) => left.sortAt - right.sortAt);
                  return (
                    <article className={'agenda-week-day' + (dateKey === today ? ' is-today' : '') + (dateKey === activeDate ? ' is-selected' : '')} key={dateKey}>
                      <button type="button" className="agenda-week-day-heading" onClick={() => { setSelectedDate(dateKey); setView('day'); }}>
                        <span>{WEEKDAY_LABELS[(new Date(dateAtUtcNoon(dateKey)).getUTCDay() + 6) % 7]}</span>
                        <strong>{Number(dateKey.slice(8, 10))}</strong>
                      </button>
                      <div className="agenda-week-events">
                        {dayItems.slice(0, 6).map(({ kind, item }) => kind === 'event'
                          ? <EventChip key={'event:' + item.id} event={item} timeZone={timeZone} onClick={openEventDetail} compact />
                          : <TaskScheduleChip key={'task-schedule:' + item.id} schedule={item} task={scheduledTaskById.get(item.task_id)} compact />)}
                        {dayItems.length > 6 && <span className="agenda-more-events">+{dayItems.length - 6} más</span>}
                        {!dayItems.length && <span className="agenda-week-empty">—</span>}
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          )}

          {view === 'month' && (
            <section className="agenda-month-view" aria-label="Agenda mensual">
              <div className="agenda-month-weekdays">{WEEKDAY_LABELS.map((label) => <span key={label}>{label}</span>)}</div>
              <div className="agenda-month-grid">
                {monthDays.map((dateKey) => {
                  const dayEvents = eventsForDate(dateKey);
                  const daySchedules = taskSchedulesForDate(dateKey);
                  const dayItems = [
                    ...dayEvents.map((item) => ({
                      kind: 'event',
                      item,
                      sortAt: item.temporal_kind === 'all_day'
                        ? Date.parse(item.start_date + 'T00:00:00.000Z')
                        : Date.parse(item.starts_at),
                    })),
                    ...daySchedules.map((item) => ({ kind: 'task_schedule', item, sortAt: Date.parse(item.starts_at) })),
                  ].sort((left, right) => left.sortAt - right.sortAt);
                  const inMonth = dateKey.slice(0, 7) === activeDate.slice(0, 7);
                  return (
                    <article className={'agenda-month-day' + (!inMonth ? ' is-outside' : '') + (dateKey === today ? ' is-today' : '') + (dateKey === activeDate ? ' is-selected' : '')} key={dateKey}>
                      <button type="button" className="agenda-month-date" onClick={() => { setSelectedDate(dateKey); setView('day'); }}>{Number(dateKey.slice(8, 10))}</button>
                      <div className="agenda-month-events">
                        {dayItems.slice(0, 3).map(({ kind, item }) => kind === 'event'
                          ? <EventChip key={'event:' + item.id} event={item} timeZone={timeZone} onClick={openEventDetail} compact />
                          : <TaskScheduleChip key={'task-schedule:' + item.id} schedule={item} task={scheduledTaskById.get(item.task_id)} compact />)}
                        {dayItems.length > 3 && <span className="agenda-more-events">+{dayItems.length - 3}</span>}
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          )}
        </>
      )}

      {showComposer && (
        <div className="agenda-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeComposer(); }}>
          <section className="agenda-dialog" role="dialog" aria-modal="true" aria-labelledby="agenda-create-title">
            <header className="agenda-dialog-header">
              <div><span className="agenda-section-kicker">{editingEvent ? 'EDITAR COMPROMISO' : 'NUEVO COMPROMISO'}</span><h2 id="agenda-create-title">{editingEvent ? 'Editar evento' : 'Crear evento'}</h2></div>
              <button type="button" className="agenda-close-button" aria-label="Cerrar" onClick={closeComposer} disabled={busy}>×</button>
            </header>
            <form className="agenda-form" onSubmit={submitEvent}>
              <label className="agenda-field agenda-field-full">
                <span>Nombre del evento</span>
                <input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={200} required autoFocus placeholder="Ej. Entrenamiento, cita, reunión…" />
              </label>
              <div className="agenda-form-row">
                <label className="agenda-field">
                  <span>Tipo de horario</span>
                  <select
                    value={temporalKind}
                    disabled={editingEvent?.temporal_kind === 'fixed_instant'}
                    onChange={(event) => setTemporalKind(event.target.value)}
                  >
                    <option value="all_day">Día completo</option>
                    <option value="zoned_civil">Con hora</option>
                    {editingEvent?.temporal_kind === 'fixed_instant' && <option value="fixed_instant">Instante fijo</option>}
                  </select>
                </label>
                <label className="agenda-field">
                  <span>Estado</span>
                  <input value={statusLabel(editingEvent?.event_status || 'confirmed')} readOnly />
                </label>
              </div>
              {temporalKind === 'all_day' ? (
                <div className="agenda-form-row">
                  <label className="agenda-field"><span>Desde</span><input type="date" value={startDate} onChange={(event) => {
                    const nextDate = event.target.value;
                    setStartDate(nextDate);
                    if (recurrenceFrequency === 'WEEKLY' && !recurrenceWeekdaysTouched && nextDate) {
                      setRecurrenceWeekdays([isoWeekdayForDate(nextDate)]);
                    }
                  }} required /></label>
                  <label className="agenda-field"><span>Hasta (incluido)</span><input type="date" value={endDate} min={startDate} onChange={(event) => setEndDate(event.target.value)} required /></label>
                </div>
              ) : temporalKind === 'zoned_civil' ? (
                <>
                  <div className="agenda-form-row">
                    <label className="agenda-field"><span>Comienza</span><input type="datetime-local" step="0.001" value={startLocalDateTime} onChange={(event) => {
                      const nextValue = event.target.value;
                      setStartLocalDateTime(nextValue);
                      if (recurrenceFrequency === 'WEEKLY' && !recurrenceWeekdaysTouched && nextValue) {
                        setRecurrenceWeekdays([isoWeekdayForDate(nextValue.slice(0, 10))]);
                      }
                    }} required /></label>
                    <label className="agenda-field"><span>Termina</span><input type="datetime-local" step="0.001" value={endLocalDateTime} onChange={(event) => setEndLocalDateTime(event.target.value)} required /></label>
                  </div>
                  <label className="agenda-field agenda-field-full">
                    <span>Zona horaria (IANA)</span>
                    <input value={eventTimeZone} onChange={(event) => setEventTimeZone(event.target.value)} required />
                    <small>Las horas se interpretan en esta zona; el servidor resuelve los cambios DST.</small>
                  </label>
                </>
              ) : (
                <div className="agenda-fixed-range">
                  <strong>Instantes fijos</strong>
                  <span>Inicio: {formatInstantInTimeZone(fixedStartsAt, timeZone)} ({timeZone})</span>
                  <span>Fin: {formatInstantInTimeZone(fixedEndsAt, timeZone)} ({timeZone})</span>
                  <small>Al editar los detalles se conservarán estos instantes exactos. Para cambiar la hora, crea una nueva versión del evento con zona horaria.</small>
                </div>
              )}
              <div className="agenda-form-row">
                <label className="agenda-field">
                  <span>Tipo de lugar</span>
                  <select value={locationKind} onChange={(event) => setLocationKind(event.target.value)}>
                    <option value="">Sin especificar</option>
                    <option value="physical">Presencial</option>
                    <option value="online">En línea</option>
                    <option value="other">Otro</option>
                  </select>
                </label>
                <label className="agenda-field">
                  <span>Lugar</span>
                  <input value={locationLabel} onChange={(event) => setLocationLabel(event.target.value)} maxLength={500} placeholder="Dirección o enlace" />
                </label>
              </div>
              <label className="agenda-field agenda-field-full">
                <span>Descripción (opcional)</span>
                <textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={3} maxLength={5000} placeholder="Detalles útiles para este compromiso…" />
              </label>
              {!editingEvent && temporalKind !== 'fixed_instant' && (
                <section className="agenda-recurrence-form" aria-label="Repetición del evento">
                  <label className="agenda-field">
                    <span>Repetición</span>
                    <select
                      value={recurrenceFrequency}
                      onChange={(event) => {
                        const next = event.target.value;
                        setRecurrenceFrequency(next);
                        if (next === 'WEEKLY' && recurrenceWeekdays.length === 0) {
                          setRecurrenceWeekdays([isoWeekdayForDate(temporalKind === 'all_day' ? startDate : startLocalDateTime.slice(0, 10))]);
                        }
                      }}
                    >
                      <option value="none">No se repite</option>
                      <option value="DAILY">Cada día</option>
                      <option value="WEEKLY">Cada semana</option>
                      <option value="MONTHLY">Cada mes</option>
                      <option value="YEARLY">Cada año</option>
                    </select>
                  </label>
                  {recurrenceFrequency !== 'none' && (
                    <>
                      <div className="agenda-form-row">
                        <label className="agenda-field">
                          <span>Cada</span>
                          <input type="number" min="1" max="1000" value={recurrenceInterval}
                            onChange={(event) => setRecurrenceInterval(event.target.value)} required />
                        </label>
                        <label className="agenda-field">
                          <span>Ocurrencias</span>
                          <input type="number" min="1" max="100000" value={recurrenceCount}
                            onChange={(event) => setRecurrenceCount(event.target.value)} required />
                        </label>
                      </div>
                      {recurrenceFrequency === 'WEEKLY' && (
                        <fieldset className="agenda-recurrence-weekdays">
                          <legend>Días de la semana</legend>
                          <div>
                            {ISO_WEEKDAY_OPTIONS.map((day) => (
                              <label key={day.code} title={day.label}>
                                <input
                                  type="checkbox"
                                  checked={recurrenceWeekdays.includes(day.code)}
                                  onChange={(event) => {
                                    setRecurrenceWeekdaysTouched(true);
                                    setRecurrenceWeekdays((current) => event.target.checked
                                      ? [...current, day.code]
                                      : current.filter((value) => value !== day.code));
                                  }}
                                />
                                <span>{day.label}</span>
                              </label>
                            ))}
                          </div>
                        </fieldset>
                      )}
                      <p className="agenda-recurrence-note">
                        Se guardarán las ocurrencias de los próximos 90 días. La hora final y el día de finalización se conservan como horas civiles; los cruces con Tiempo Protegido o tareas reservadas detienen la creación para evitar solapamientos silenciosos.
                      </p>
                    </>
                  )}
                </section>
              )}
              <footer className="agenda-dialog-actions">
                <button type="button" className="agenda-secondary-button" onClick={closeComposer} disabled={busy}>Cancelar</button>
                <button
                  type="submit"
                  className="button button-primary"
                  disabled={busy || !title.trim() || (recurrenceFrequency === 'WEEKLY' && recurrenceWeekdays.length === 0)}
                >
                  {busy ? 'Guardando…' : editingEvent ? 'Guardar cambios' : recurrenceFrequency !== 'none' ? 'Crear serie recurrente' : 'Guardar evento'}
                </button>
              </footer>
            </form>
          </section>
        </div>
      )}

      {selectedEvent && (
        <div className="agenda-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) { setSelectedEvent(null); setConfirmAction(null); setPendingKey(null); } }}>
          <section className="agenda-dialog agenda-detail-dialog" role="dialog" aria-modal="true" aria-labelledby="agenda-detail-title">
            <header className="agenda-dialog-header">
              <div><span className="agenda-section-kicker">{statusLabel(selectedEvent.event_status)} · {lifecycleLabel(selectedEvent)}</span><h2 id="agenda-detail-title">{selectedEvent.title}</h2></div>
              <button type="button" className="agenda-close-button" aria-label="Cerrar" onClick={() => { setSelectedEvent(null); setConfirmAction(null); setPendingKey(null); }}>×</button>
            </header>
            <div className="agenda-detail-content">
              <div><span>Fecha y hora</span><strong>{getEventDateLabel(selectedEvent, timeZone)}</strong><small>{formatEventTime(selectedEvent, timeZone)}{selectedEvent.time_zone ? ' · ' + selectedEvent.time_zone : ''}</small></div>
              {selectedEvent.is_recurring_occurrence && (
                <div>
                  <span>Ocurrencia recurrente</span>
                  <strong>{selectedEvent.occurrence_status === 'needs_review' ? 'Requiere revisión de horario' : 'Parte de una serie'}</strong>
                  <small>La hora de esta ocurrencia proviene de la regla de la serie y de su resolución horaria guardada.</small>
                </div>
              )}
              {selectedEvent.location_label && <div><span>Lugar</span><strong>{selectedEvent.location_label}</strong></div>}
              {selectedEvent.description && <div><span>Descripción</span><p>{selectedEvent.description}</p></div>}
              {selectedEvent.deleted_at && selectedEvent.purge_after && (
                <div><span>Recuperación hasta</span><strong>{new Intl.DateTimeFormat('es', { dateStyle: 'medium', timeStyle: 'short', timeZone }).format(new Date(selectedEvent.purge_after))}</strong></div>
              )}
            </div>
            <div className="agenda-event-actions">
              {selectedEvent.is_recurring_occurrence ? (
                <p className="agenda-recurrence-note">
                  Esta fecha pertenece a una serie recurrente. La edición de una ocurrencia, de esta y las siguientes, y de toda la serie se gestiona en el editor de series.
                </p>
              ) : (
                <>
              {canEditEvent(selectedEvent) && (
                <button type="button" className="agenda-secondary-button" onClick={() => openEditComposer(selectedEvent)} disabled={busy}>Editar</button>
              )}
              {isActiveEvent(selectedEvent) && selectedEvent.event_status === 'cancelled' && (
                <button type="button" className="agenda-secondary-button" onClick={() => mutateSelectedEvent('reopen')} disabled={busy}>Reabrir</button>
              )}
              {isActiveEvent(selectedEvent) && !['cancelled', 'finished'].includes(selectedEvent.event_status) && (
                <button type="button" className="agenda-secondary-button agenda-action-warning" onClick={() => requestEventMutation('cancel')} disabled={busy}>Cancelar evento</button>
              )}
              {isActiveEvent(selectedEvent) && selectedEvent.event_status === 'confirmed' && (
                <button type="button" className="agenda-secondary-button" onClick={() => requestEventMutation('finish')} disabled={busy}>Finalizar</button>
              )}
              {isActiveEvent(selectedEvent) && (
                <button type="button" className="agenda-secondary-button" onClick={() => requestEventMutation('archive')} disabled={busy}>Archivar</button>
              )}
              {!selectedEvent.deleted_at && (
                <button type="button" className="agenda-secondary-button agenda-action-danger" onClick={() => requestEventMutation('trash')} disabled={busy}>Papelera</button>
              )}
              {canRestoreEvent(selectedEvent) && (
                <button type="button" className="button button-primary" onClick={() => mutateSelectedEvent('restore')} disabled={busy}>Restaurar evento</button>
              )}
              {selectedEvent.deleted_at && !canRestoreEvent(selectedEvent) && (
                <p className="agenda-expired-notice">La ventana de recuperación de 30 días ha vencido.</p>
              )}
                </>
              )}
            </div>
            <footer className="agenda-dialog-actions"><button type="button" className="agenda-secondary-button" onClick={() => { setSelectedEvent(null); setConfirmAction(null); setPendingKey(null); }}>Cerrar</button></footer>
          </section>
        </div>
      )}
      {protectedConflictPrompt && (
        <div className="agenda-dialog-backdrop agenda-conflict-backdrop" role="presentation">
          <section className="agenda-dialog agenda-conflict-dialog" role="alertdialog" aria-modal="true" aria-labelledby="agenda-protected-conflict-title">
            <header className="agenda-dialog-header">
              <div>
                <span className="agenda-section-kicker">PROTECCIÓN DEL TIEMPO</span>
                <h2 id="agenda-protected-conflict-title">Hay compromisos que se cruzan</h2>
              </div>
              <button type="button" className="agenda-close-button" aria-label="Cerrar" onClick={closeProtectedConflictPrompt} disabled={busy}>×</button>
            </header>
            {protectedConflictPrompt.error === 'PROTECTED_TIME_CONFLICTS_CHANGED' && protectedConflictItems.length === 0 ? (
              <p className="agenda-confirm-copy">
                Los bloques protegidos cambiaron durante el guardado. Ningún cambio se aplicó.
                Vuelve al evento, revisa sus horas y guarda de nuevo para calcular los cruces actuales.
              </p>
            ) : (
              <>
                <p className="agenda-confirm-copy">
                  El evento no se guardó. Decide explícitamente para cada cruce. Ningún otro evento ni tarea se moverá automáticamente.
                </p>
                <div className="agenda-conflict-list">
                  {protectedConflictItems.map((conflict) => (
                    <article className="agenda-conflict-card" key={conflict.conflictKey}>
                      <div className="agenda-conflict-card-heading">
                        <div>
                          <strong>{conflict.label}</strong>
                          <small>{conflict.category || 'Personal'} · {conflict.patternKind === 'weekly' ? 'Regla semanal' : 'Bloque puntual'}</small>
                        </div>
                        <span className={'protected-time-mode ' + (conflict.protectionMode === 'hard' ? 'is-hard' : 'is-flexible')}>
                          {conflict.protectionMode === 'hard' ? 'Rígida' : 'Flexible'}
                        </span>
                      </div>
                      <p>
                        Cruce: {formatInstantInTimeZone(conflict.overlapStartsAt, conflict.timeZone)}
                        {' — '}
                        {formatInstantInTimeZone(conflict.overlapEndsAt, conflict.timeZone)}
                        {' · '}{conflict.timeZone}
                      </p>
                      <label className="agenda-field">
                        <span>Tu decisión para este cruce</span>
                        <select
                          value={protectedConflictChoices[conflict.conflictKey] || ''}
                          onChange={(event) => setProtectedConflictChoices((current) => ({
                            ...current,
                            [conflict.conflictKey]: event.target.value,
                          }))}
                          disabled={busy}
                        >
                          <option value="">Selecciona una decisión</option>
                          <option value={conflict.requiredDecision}>
                            {conflict.protectionMode === 'hard'
                              ? 'Autorizar explícitamente este cruce'
                              : 'Mantener ambos compromisos'}
                          </option>
                          <option value="reschedule">Cambiar el horario del evento</option>
                        </select>
                      </label>
                    </article>
                  ))}
                </div>
                <p className="agenda-conflict-note">
                  {protectedConflictItems.some((item) => item.protectionMode === 'hard')
                    ? 'La protección rígida sólo se puede cruzar con tu autorización explícita.'
                    : 'Los bloques flexibles tampoco se ignoran: debes elegir conservar el cruce o cambiar el horario.'}
                </p>
              </>
            )}
            <footer className="agenda-dialog-actions">
              <button type="button" className="agenda-secondary-button" onClick={closeProtectedConflictPrompt} disabled={busy}>
                Volver al evento
              </button>
              {protectedConflictItems.length > 0 && (
                <button
                  type="button"
                  className="agenda-secondary-button"
                  onClick={closeProtectedConflictPrompt}
                  disabled={busy || !hasRescheduleChoice}
                >
                  Cambiar horario
                </button>
              )}
              <button
                type="button"
                className="button button-primary"
                onClick={saveWithProtectedTimeDecisions}
                disabled={busy || !protectedConflictDecisionsReady || hasRescheduleChoice}
              >
                {busy ? 'Guardando…' : 'Guardar con estas decisiones'}
              </button>
            </footer>
          </section>
        </div>
      )}
      {taskScheduleConflictPrompt && (
        <div className="agenda-dialog-backdrop agenda-conflict-backdrop" role="presentation">
          <section className="agenda-dialog agenda-conflict-dialog" role="alertdialog" aria-modal="true" aria-labelledby="agenda-task-schedule-conflict-title">
            <header className="agenda-dialog-header">
              <div>
                <span className="agenda-section-kicker">RESERVAS DE TAREAS</span>
                <h2 id="agenda-task-schedule-conflict-title">El evento coincide con tiempo reservado</h2>
              </div>
              <button type="button" className="agenda-close-button" aria-label="Cerrar" onClick={closeTaskScheduleConflictPrompt} disabled={busy}>×</button>
            </header>
            {taskScheduleConflictPrompt.error === 'TASK_SCHEDULE_CONFLICTS_CHANGED' && taskScheduleConflictItems.length === 0 ? (
              <p className="agenda-confirm-copy">
                Las reservas de tareas cambiaron durante el guardado. Ningún evento fue creado ni modificado.
                Vuelve al evento y guarda de nuevo para revisar el estado actual.
              </p>
            ) : (
              <>
                <p className="agenda-confirm-copy">
                  {taskScheduleConflictPrompt.action === 'restore'
                    ? <>El evento no se restauró. Para reactivarlo, confirma cada cruce; ninguna reserva existente se moverá ni modificará.</>
                    : taskScheduleConflictPrompt.action === 'reopen'
                      ? <>El evento no se reabrió. Para reactivarlo, confirma cada cruce; ninguna reserva existente se moverá ni modificará.</>
                      : <>El evento no se guardó. Para conservar el horario, confirma cada cruce. La reserva existente no se moverá ni modificará.</>}
                </p>
                <div className="agenda-conflict-list">
                  {taskScheduleConflictItems.map((conflict) => (
                    <article className="agenda-conflict-card" key={conflict.taskScheduleId}>
                      <div className="agenda-conflict-card-heading">
                        <div>
                          <strong>Reserva de tarea</strong>
                          <small>{conflict.timeZone || timeZone}</small>
                        </div>
                        <span className="protected-time-mode is-flexible">Activa</span>
                      </div>
                      <p>
                        Reserva: {formatInstantInTimeZone(conflict.startsAt, conflict.timeZone || timeZone)}
                        {' — '}
                        {formatInstantInTimeZone(conflict.endsAt, conflict.timeZone || timeZone)}
                        {' · Cruce: '}
                        {formatInstantInTimeZone(conflict.overlapStartsAt, conflict.timeZone || timeZone)}
                        {' — '}
                        {formatInstantInTimeZone(conflict.overlapEndsAt, conflict.timeZone || timeZone)}
                      </p>
                      <label className="agenda-field">
                        <span>Tu decisión</span>
                        <select
                          aria-label="Decisión para reserva de tarea"
                          value={taskScheduleConflictChoices[conflict.taskScheduleId] || ''}
                          onChange={(event) => setTaskScheduleConflictChoices((current) => ({
                            ...current,
                            [conflict.taskScheduleId]: event.target.value,
                          }))}
                          disabled={busy}
                        >
                          <option value="">Selecciona una decisión</option>
                          <option value="keep_overlap">Mantener ambos compromisos</option>
                        </select>
                      </label>
                    </article>
                  ))}
                </div>
              </>
            )}
            <footer className="agenda-dialog-actions">
              <button type="button" className="agenda-secondary-button" onClick={closeTaskScheduleConflictPrompt} disabled={busy}>
                Volver al evento
              </button>
              <button
                type="button"
                className="button button-primary"
                onClick={saveWithTaskScheduleDecisions}
                disabled={busy || !taskScheduleConflictDecisionsReady}
              >
                {busy ? 'Guardando…' : 'Guardar y mantener ambos'}
              </button>
            </footer>
          </section>
        </div>
      )}
      {selectedEvent && confirmAction && (
        <div className="agenda-dialog-backdrop agenda-confirm-backdrop" role="presentation">
          <section className="agenda-dialog agenda-confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="agenda-confirm-title">
            <header className="agenda-dialog-header">
              <div><span className="agenda-section-kicker">CONFIRMACIÓN</span><h2 id="agenda-confirm-title">{confirmDetails[confirmAction]?.title}</h2></div>
              <button type="button" className="agenda-close-button" aria-label="Cerrar" onClick={() => setConfirmAction(null)} disabled={busy}>×</button>
            </header>
            <p className="agenda-confirm-copy">{confirmDetails[confirmAction]?.description}</p>
            <footer className="agenda-dialog-actions">
              <button type="button" className="agenda-secondary-button" onClick={() => setConfirmAction(null)} disabled={busy}>Volver</button>
              <button type="button" className="button button-primary" onClick={() => mutateSelectedEvent(confirmAction)} disabled={busy}>
                {busy ? 'Procesando…' : confirmDetails[confirmAction]?.button}
              </button>
            </footer>
          </section>
        </div>
      )}
    </div>
  );
}


export function AgendaPage(props) {
  const [panel, setPanel] = useState('calendar');
  return (
    <div className="agenda-shell">
      <nav className="agenda-panel-switch" aria-label="Secciones de Agenda">
        <button type="button" aria-pressed={panel === 'calendar'} onClick={() => setPanel('calendar')}>
          Calendario
        </button>
        <button type="button" aria-pressed={panel === 'tasks'} onClick={() => setPanel('tasks')}>
          Tareas programadas
        </button>
        <button type="button" aria-pressed={panel === 'protected'} onClick={() => setPanel('protected')}>
          Tiempo protegido
        </button>
      </nav>
      {panel === 'calendar'
        ? <AgendaCalendarPage {...props} />
        : panel === 'tasks'
          ? <TaskSchedulePage {...props} />
          : <ProtectedTimePage {...props} />}
    </div>
  );
}
