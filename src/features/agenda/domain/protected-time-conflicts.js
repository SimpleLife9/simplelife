import { assessProtectedTimeConflict } from './protected-time.js';

const DAY_MS = 86_400_000;
export const MAX_PROTECTED_CONFLICT_WINDOW_DAYS = 366;
export const MAX_PROTECTED_CONFLICT_OCCURRENCES = 500;
export const PROTECTED_TIME_DECISION_VERSION = 'protected-time-decision-v1';

function assert(condition, message) {
  if (!condition) throw new RangeError(message);
}

function parseDate(value, label) {
  assert(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value), label + ' must be YYYY-MM-DD.');
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  assert(date.getUTCFullYear() === year && date.getUTCMonth() + 1 === month && date.getUTCDate() === day,
    label + ' must be a real calendar date.');
  return date;
}

function dateKey(date) {
  return [date.getUTCFullYear(), String(date.getUTCMonth() + 1).padStart(2, '0'), String(date.getUTCDate()).padStart(2, '0')].join('-');
}

function addDays(key, amount) {
  return dateKey(new Date(parseDate(key, 'date').getTime() + amount * DAY_MS));
}

function weekdayIso(key) {
  const day = parseDate(key, 'date').getUTCDay();
  return day === 0 ? 7 : day;
}

function localDateAt(instant, timeZone) {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(instant));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return values.year + '-' + values.month + '-' + values.day;
}

function normalizeInstant(value, label) {
  assert(typeof value === 'string' && Number.isFinite(Date.parse(value)), label + ' must be a valid UTC instant.');
  return new Date(Date.parse(value)).toISOString();
}

function overlap(firstStart, firstEnd, secondStart, secondEnd) {
  return firstStart < secondEnd && secondStart < firstEnd;
}

function resolveCandidateWindow(event, calendarTimeZone, resolveRange) {
  if (event.temporal_kind === 'all_day') {
    const startDate = parseDate(event.start_date, 'event.start_date');
    const endDate = parseDate(event.end_date_exclusive, 'event.end_date_exclusive');
    const days = (endDate.getTime() - startDate.getTime()) / DAY_MS;
    assert(days >= 1 && days <= MAX_PROTECTED_CONFLICT_WINDOW_DAYS,
      'Event conflict window must span 1 to 366 calendar days.');
    const resolved = resolveRange({
      timeZone: calendarTimeZone,
      start: { localDateTime: event.start_date + 'T00:00', disambiguation: 'earlier', gapStrategy: 'next-valid' },
      end: { localDateTime: event.end_date_exclusive + 'T00:00', disambiguation: 'earlier', gapStrategy: 'next-valid' },
    });
    return { startsAt: normalizeInstant(resolved.startsAt, 'resolved all-day start'), endsAt: normalizeInstant(resolved.endsAt, 'resolved all-day end') };
  }

  assert(event.temporal_kind === 'zoned_civil' || event.temporal_kind === 'fixed_instant',
    'Unsupported Event temporal kind for protected-time analysis.');
  const startsAt = normalizeInstant(event.starts_at, 'event.starts_at');
  const endsAt = normalizeInstant(event.ends_at, 'event.ends_at');
  assert(Date.parse(endsAt) > Date.parse(startsAt), 'Event end must be after start.');
  const days = (Date.parse(endsAt) - Date.parse(startsAt)) / DAY_MS;
  assert(days <= MAX_PROTECTED_CONFLICT_WINDOW_DAYS,
    'Event conflict window cannot exceed 366 days.');
  return { startsAt, endsAt };
}

function protectedWeeklyOccurrenceRange(block, startDate, resolveRange) {
  const endDate = block.ends_next_day ? addDays(startDate, 1) : startDate;
  const startLocalTime = String(block.start_time_local).slice(0, 12);
  const endLocalTime = String(block.end_time_local).slice(0, 12);
  const resolved = resolveRange({
    timeZone: block.time_zone,
    start: {
      localDateTime: startDate + 'T' + startLocalTime,
      disambiguation: 'earlier',
      gapStrategy: 'next-valid',
    },
    end: {
      localDateTime: endDate + 'T' + endLocalTime,
      disambiguation: 'earlier',
      gapStrategy: 'next-valid',
    },
  });
  return {
    startsAt: normalizeInstant(resolved.startsAt, 'weekly occurrence start'),
    endsAt: normalizeInstant(resolved.endsAt, 'weekly occurrence end'),
  };
}

function blockOccurrences(block, candidate, resolveRange) {
  if (block.pattern_kind === 'one_off') {
    return [{
      startsAt: normalizeInstant(block.starts_at, 'protected block starts_at'),
      endsAt: normalizeInstant(block.ends_at, 'protected block ends_at'),
      occurrenceDate: null,
    }];
  }
  assert(block.pattern_kind === 'weekly', 'Unsupported Protected Time pattern.');
  assert(typeof block.time_zone === 'string' && block.time_zone.length > 0,
    'Weekly Protected Time must include its IANA timezone.');

  const firstLocalDate = localDateAt(candidate.startsAt, block.time_zone);
  const lastLocalDate = localDateAt(new Date(Date.parse(candidate.endsAt) - 1).toISOString(), block.time_zone);
  let current = addDays(firstLocalDate, -1);
  const stop = addDays(lastLocalDate, 1);
  const occurrences = [];

  while (current <= stop) {
    if ((!block.start_date || current >= block.start_date)
      && (!block.end_date_exclusive || current < block.end_date_exclusive)
      && Array.isArray(block.weekdays)
      && block.weekdays.includes(weekdayIso(current))) {
      const range = protectedWeeklyOccurrenceRange(block, current, resolveRange);
      if (overlap(Date.parse(candidate.startsAt), Date.parse(candidate.endsAt),
        Date.parse(range.startsAt), Date.parse(range.endsAt))) {
        occurrences.push({ ...range, occurrenceDate: current });
      }
      if (occurrences.length > MAX_PROTECTED_CONFLICT_OCCURRENCES) {
        throw new RangeError('Protected Time produced more than 500 overlapping weekly occurrences.');
      }
    }
    current = addDays(current, 1);
  }
  return occurrences;
}

/**
 * Expands active one-off/weekly blocks into only the occurrences intersecting
 * an Event. Every timed comparison uses canonical UTC half-open intervals.
 * An all-day Event is mapped through the owner's saved calendar timezone solely
 * to establish a common instant basis for comparison with timed protection.
 */
export function findProtectedTimeConflicts({
  event,
  protectedBlocks,
  calendarTimeZone,
  resolveRange,
} = {}) {
  assert(event && typeof event === 'object' && !Array.isArray(event), 'An Event record is required.');
  assert(Array.isArray(protectedBlocks), 'protectedBlocks must be an array.');
  assert(protectedBlocks.length <= 500, 'Owner has more than 500 active Protected Time blocks.');
  assert(typeof calendarTimeZone === 'string' && calendarTimeZone.length > 0,
    'An owner calendar timezone is required.');
  assert(typeof resolveRange === 'function', 'The authoritative IANA range resolver is required.');

  // Validate the owner's calendar timezone before any all-day conversion.
  new Intl.DateTimeFormat('en', { timeZone: calendarTimeZone }).format(new Date());
  const candidate = resolveCandidateWindow(event, calendarTimeZone, resolveRange);
  const conflicts = [];
  let totalOverlappingOccurrences = 0;

  for (const block of protectedBlocks) {
    if (block.archived_at != null || block.deleted_at != null) continue;
    if (block.protection_mode !== 'hard' && block.protection_mode !== 'flexible') {
      throw new RangeError('Protected Time mode is invalid.');
    }
    const occurrences = blockOccurrences(block, candidate, resolveRange);
    for (const occurrence of occurrences) {
      const assessment = assessProtectedTimeConflict({
        candidate: { temporalKind: 'timed', startsAt: candidate.startsAt, endsAt: candidate.endsAt },
        protectedBlock: {
          temporalKind: 'timed',
          startsAt: occurrence.startsAt,
          endsAt: occurrence.endsAt,
          protectionMode: block.protection_mode,
        },
      });
      if (!assessment.overlapping) continue;
      totalOverlappingOccurrences += 1;
      if (totalOverlappingOccurrences > MAX_PROTECTED_CONFLICT_OCCURRENCES) {
        throw new RangeError('Protected Time produced more than 500 overlapping occurrences across the owner set.');
      }
      const overlapStart = new Date(Math.max(Date.parse(candidate.startsAt), Date.parse(occurrence.startsAt))).toISOString();
      const overlapEnd = new Date(Math.min(Date.parse(candidate.endsAt), Date.parse(occurrence.endsAt))).toISOString();
      conflicts.push(Object.freeze({
        conflictKey: block.id + ':' + occurrence.startsAt,
        blockId: block.id,
        blockUpdatedAt: block.updated_at,
        label: block.label,
        category: block.category ?? null,
        protectionMode: block.protection_mode,
        patternKind: block.pattern_kind,
        occurrenceDate: occurrence.occurrenceDate,
        occurrenceStartsAt: occurrence.startsAt,
        occurrenceEndsAt: occurrence.endsAt,
        overlapStartsAt: overlapStart,
        overlapEndsAt: overlapEnd,
        timeZone: block.time_zone,
        requiredDecision: block.protection_mode === 'hard' ? 'override_hard' : 'keep_flexible',
      }));
    }
  }

  conflicts.sort((a, b) => a.occurrenceStartsAt.localeCompare(b.occurrenceStartsAt)
    || a.blockId.localeCompare(b.blockId));
  return Object.freeze({
    candidate: Object.freeze(candidate),
    conflicts: Object.freeze(conflicts),
    snapshot: Object.freeze(protectedBlocks
      .filter((block) => block.archived_at == null && block.deleted_at == null)
      .map((block) => Object.freeze({ id: block.id, updated_at: block.updated_at }))
      .sort((a, b) => a.id.localeCompare(b.id))),
  });
}

/** Validate the user's per-occurrence decision and return an audit-ready immutable record. */
export function normalizeProtectedTimeDecisions(conflicts, supplied, now = new Date().toISOString()) {
  assert(Array.isArray(conflicts), 'conflicts must be an array.');
  assert(Array.isArray(supplied), 'protectedTimeDecisions must be an array.');
  assert(supplied.length <= MAX_PROTECTED_CONFLICT_OCCURRENCES,
    'protectedTimeDecisions cannot contain more than 500 entries.');
  const timestamp = normalizeInstant(now, 'decision timestamp');
  const byKey = new Map();

  for (const decision of supplied) {
    assert(decision && typeof decision === 'object' && !Array.isArray(decision),
      'Each Protected Time decision must be an object.');
    const allowed = ['blockId', 'blockUpdatedAt', 'occurrenceStartsAt', 'decision'];
    assert(Object.keys(decision).length === allowed.length
      && Object.keys(decision).every((key) => allowed.includes(key)),
    'Protected Time decision contains unsupported or missing fields.');
    assert(typeof decision.blockId === 'string' && typeof decision.blockUpdatedAt === 'string'
      && typeof decision.occurrenceStartsAt === 'string' && typeof decision.decision === 'string',
    'Protected Time decision fields must be text.');
    const key = decision.blockId + ':' + normalizeInstant(decision.occurrenceStartsAt, 'occurrenceStartsAt');
    assert(!byKey.has(key), 'A Protected Time occurrence cannot receive duplicate decisions.');
    byKey.set(key, decision);
  }

  if (byKey.size !== conflicts.length) {
    return Object.freeze({ ok: false, reason: 'PROTECTED_TIME_DECISIONS_REQUIRED' });
  }

  const normalized = [];
  for (const conflict of conflicts) {
    const suppliedDecision = byKey.get(conflict.conflictKey);
    if (!suppliedDecision || suppliedDecision.blockUpdatedAt !== conflict.blockUpdatedAt
      || suppliedDecision.decision !== conflict.requiredDecision) {
      return Object.freeze({ ok: false, reason: 'PROTECTED_TIME_DECISIONS_REQUIRED' });
    }
    normalized.push(Object.freeze({
      policyVersion: PROTECTED_TIME_DECISION_VERSION,
      blockId: conflict.blockId,
      blockUpdatedAt: conflict.blockUpdatedAt,
      protectionMode: conflict.protectionMode,
      occurrenceDate: conflict.occurrenceDate,
      occurrenceStartsAt: conflict.occurrenceStartsAt,
      occurrenceEndsAt: conflict.occurrenceEndsAt,
      overlapStartsAt: conflict.overlapStartsAt,
      overlapEndsAt: conflict.overlapEndsAt,
      timeZone: conflict.timeZone,
      decision: conflict.requiredDecision,
      consentedAt: timestamp,
    }));
  }

  return Object.freeze({ ok: true, decisions: Object.freeze(normalized) });
}
