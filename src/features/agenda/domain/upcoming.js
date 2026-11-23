import { formatInstantInTimeZone, parseCalendarDate } from './temporal.js';

const DAY_MS = 86_400_000;

function assert(condition, message) {
  if (!condition) throw new RangeError(message);
}

function epochDay(dateKey) {
  const { year, month, day } = parseCalendarDate(dateKey);
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(0, 0, 0, 0);
  return Math.floor(date.getTime() / DAY_MS);
}

function isValidRange(startsAt, endsAt) {
  const start = Date.parse(startsAt);
  const end = Date.parse(endsAt);
  return Number.isFinite(start) && Number.isFinite(end) && end > start
    ? { start, end }
    : null;
}

/**
 * Produces a small, read-only list for the active Agenda screen.
 * It is an in-app indicator only; it does not schedule notifications or alarms.
 */
export function getUpcomingAgendaItems({
  events = [],
  taskSchedules = [],
  tasks = [],
  now = Date.now(),
  viewerTimeZone = 'America/Havana',
  maxItems = 4,
}) {
  assert(Array.isArray(events) && Array.isArray(taskSchedules) && Array.isArray(tasks),
    'Agenda collections must be arrays.');
  assert(Number.isFinite(now), 'now must be a finite epoch-millisecond value.');
  assert(typeof viewerTimeZone === 'string' && viewerTimeZone.length > 0, 'viewerTimeZone is required.');
  assert(Number.isInteger(maxItems) && maxItems >= 1 && maxItems <= 10, 'maxItems must be from 1 to 10.');

  const today = formatInstantInTimeZone(new Date(now).toISOString(), viewerTimeZone).slice(0, 10);
  const taskById = new Map(tasks.map((task) => [task.id, task]));
  const items = [];

  for (const event of events) {
    if (!event || ['cancelled', 'finished'].includes(event.event_status)) continue;
    if (event.archived_at || event.deleted_at) continue;

    if (event.temporal_kind === 'all_day') {
      const startDate = parseCalendarDate(event.start_date).key;
      const endDateExclusive = parseCalendarDate(event.end_date_exclusive).key;
      if (endDateExclusive <= today) continue;
      const activeToday = startDate <= today && today < endDateExclusive;
      items.push({
        id: event.id,
        kind: 'event',
        title: event.title || 'Evento',
        source: event,
        allDay: true,
        startDate,
        startsAt: null,
        endsAt: null,
        timeZone: viewerTimeZone,
        sortAt: activeToday ? now - 1 : epochDay(startDate) * DAY_MS,
        state: activeToday ? 'ongoing' : 'upcoming',
      });
      continue;
    }

    const range = isValidRange(event.starts_at, event.ends_at);
    if (!range || range.end <= now) continue;
    items.push({
      id: event.id,
      kind: 'event',
      title: event.title || 'Evento',
      source: event,
      allDay: false,
      startsAt: event.starts_at,
      endsAt: event.ends_at,
      timeZone: event.temporal_kind === 'zoned_civil' && event.time_zone
        ? event.time_zone
        : viewerTimeZone,
      sortAt: Math.max(range.start, now),
      state: range.start <= now ? 'ongoing' : 'upcoming',
    });
  }

  for (const schedule of taskSchedules) {
    if (!schedule || !['proposed', 'confirmed'].includes(schedule.schedule_status)) continue;
    const range = isValidRange(schedule.starts_at, schedule.ends_at);
    if (!range || range.end <= now) continue;
    const task = taskById.get(schedule.task_id);
    items.push({
      id: schedule.id,
      kind: 'task_schedule',
      title: task?.action || 'Tarea reservada',
      source: schedule,
      allDay: false,
      startsAt: schedule.starts_at,
      endsAt: schedule.ends_at,
      timeZone: schedule.time_zone || viewerTimeZone,
      sortAt: Math.max(range.start, now),
      state: range.start <= now ? 'ongoing' : 'upcoming',
    });
  }

  return Object.freeze(items
    .sort((left, right) => left.sortAt - right.sortAt || left.title.localeCompare(right.title))
    .slice(0, maxItems)
    .map((item) => Object.freeze(item)));
}

export function formatUpcomingStart(item, viewerTimeZone = 'America/Havana') {
  assert(item && typeof item === 'object', 'An upcoming Agenda item is required.');
  if (item.allDay) return 'Todo el día · ' + item.startDate;
  return formatInstantInTimeZone(item.startsAt, item.timeZone || viewerTimeZone);
}

export function formatUpcomingCountdown(item, now = Date.now()) {
  assert(item && typeof item === 'object', 'An upcoming Agenda item is required.');
  assert(Number.isFinite(now), 'now must be a finite epoch-millisecond value.');
  if (item.allDay) return item.state === 'ongoing' ? 'Hoy · todo el día' : 'Todo el día';
  const start = Date.parse(item.startsAt);
  const end = Date.parse(item.endsAt);
  assert(Number.isFinite(start) && Number.isFinite(end) && end > start,
    'Upcoming item must have a valid positive time interval.');
  if (start <= now) return 'En curso';
  const minutes = Math.ceil((start - now) / 60_000);
  if (minutes < 1) return 'Comienza en menos de 1 min';
  if (minutes < 60) return 'Comienza en ' + minutes + ' min';
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (hours < 24) return remainder
    ? 'Comienza en ' + hours + ' h ' + remainder + ' min'
    : 'Comienza en ' + hours + ' h';
  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  return remainingHours
    ? 'Comienza en ' + days + ' d ' + remainingHours + ' h'
    : 'Comienza en ' + days + ' d';
}
