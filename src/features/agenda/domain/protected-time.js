import {
  createAllDayRange,
  intervalsOverlap,
  parseCalendarDate,
  validateTimedRange,
} from './temporal.js';

const PROTECTION_MODES = Object.freeze(['hard', 'flexible']);
const OFFSET_INSTANT_PATTERN = /^(\d{4}-\d{2}-\d{2})T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/i;

function assert(condition, message) {
  if (!condition) throw new RangeError(message);
}

function normalizeInstant(value, label) {
  assert(typeof value === 'string', label + ' must include an explicit UTC offset or Z.');
  const match = OFFSET_INSTANT_PATTERN.exec(value);
  assert(match, label + ' must include an explicit UTC offset or Z.');
  parseCalendarDate(match[1]);
  const epoch = Date.parse(value);
  assert(Number.isFinite(epoch), label + ' must be a valid instant.');
  return new Date(epoch).toISOString();
}

function normalizeRange(value, label) {
  assert(value && typeof value === 'object' && !Array.isArray(value),
    label + ' must be an object.');

  assert(value.temporalKind === 'timed' || value.temporalKind === 'all_day',
    label + ' temporalKind must be timed or all_day.');

  if (value.temporalKind === 'timed') {
    const startsAt = normalizeInstant(value.startsAt, label + '.startsAt');
    const endsAt = normalizeInstant(value.endsAt, label + '.endsAt');
    const range = validateTimedRange(startsAt, endsAt);
    return Object.freeze({
      temporalKind: 'timed',
      startsAt: range.startsAt,
      endsAt: range.endsAt,
    });
  }

  const range = createAllDayRange(value.startDate, value.endDateExclusive);
  return Object.freeze({
    temporalKind: 'all_day',
    startDate: range.startDate,
    endDateExclusive: range.endDateExclusive,
  });
}

function rangesOverlap(first, second) {
  assert(first.temporalKind === second.temporalKind,
    'Timed and all-day ranges require an explicit common calendar basis before comparison.');

  if (first.temporalKind === 'timed') {
    return intervalsOverlap(first, second);
  }

  return first.startDate < second.endDateExclusive
    && second.startDate < first.endDateExclusive;
}

/**
 * Assesses a candidate commitment against one protected-time block.
 *
 * Both hard and flexible blocks prevent an implicit/automatic overlap. A
 * caller may set userAcceptedOverlap only after the user explicitly chooses
 * to keep the overlap. This function does not persist that decision.
 *
 * Timed ranges compare UTC instants. All-day ranges compare date-only keys.
 * Mixed temporal kinds fail closed because comparing them needs an explicit
 * calendar timezone and a trusted conversion to that calendar's date domain.
 */
export function assessProtectedTimeConflict({
  candidate,
  protectedBlock,
  userAcceptedOverlap = false,
} = {}) {
  assert(typeof userAcceptedOverlap === 'boolean',
    'userAcceptedOverlap must be a boolean.');

  assert(protectedBlock && typeof protectedBlock === 'object'
    && !Array.isArray(protectedBlock), 'protectedBlock must be an object.');

  const protectionMode = protectedBlock.protectionMode;
  assert(PROTECTION_MODES.includes(protectionMode),
    'protectionMode must be hard or flexible.');

  const candidateRange = normalizeRange(candidate, 'candidate');
  const protectedRange = normalizeRange(protectedBlock, 'protectedBlock');

  const overlapping = rangesOverlap(candidateRange, protectedRange);

  if (!overlapping) {
    return Object.freeze({
      overlapping: false,
      protectionMode,
      temporalKind: candidateRange.temporalKind,
      outcome: 'clear',
      requiredAction: null,
      requiresUserDecision: false,
      requiresExplicitOverride: false,
      requiresFlexibleChoice: false,
      userAcceptedOverlap,
      blocksAutomaticScheduling: false,
      canProceed: true,
    });
  }

  const requiresExplicitOverride = protectionMode === 'hard' && !userAcceptedOverlap;
  const requiresFlexibleChoice = protectionMode === 'flexible' && !userAcceptedOverlap;

  return Object.freeze({
    overlapping: true,
    protectionMode,
    temporalKind: candidateRange.temporalKind,
    outcome: userAcceptedOverlap
      ? protectionMode === 'hard' ? 'overridden' : 'kept_by_user_choice'
      : protectionMode === 'hard' ? 'override_required' : 'choice_required',
    requiredAction: userAcceptedOverlap
      ? null
      : protectionMode === 'hard' ? 'explicit_override' : 'explicit_keep_or_reschedule_choice',
    requiresUserDecision: !userAcceptedOverlap,
    requiresExplicitOverride,
    requiresFlexibleChoice,
    userAcceptedOverlap,
    // The protected block remains protected for automatic scheduling even
    // when this particular overlap has explicit user authorization.
    blocksAutomaticScheduling: true,
    canProceed: userAcceptedOverlap,
  });
}


// Persisted Protected Time block contract. Identity and audit fields remain server-owned.
export const PROTECTED_TIME_PATTERNS = Object.freeze(['one_off', 'weekly']);
export const PROTECTED_TIME_MUTATIONS = Object.freeze(['create', 'edit', 'archive', 'restore', 'delete']);
export const PROTECTED_TIME_MUTATION_INTENT_VERSION = 'protected-time-mutation-v1';
export const PROTECTED_TIME_MUTATION_INTENT_VERSION_V2 = 'protected-time-mutation-v2';

const PROTECTED_TIME_UUID_V7_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PROTECTED_TIME_LOCAL_DATE_TIME_PATTERN = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/;
const PROTECTED_TIME_LOCAL_CLOCK_PATTERN = /^(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/;
const PROTECTED_TIME_OFFSET_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/i;

function assertProtectedDate(value, label) {
  assert(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value),
    label + ' must be a YYYY-MM-DD calendar date.');
  const [year, month, day] = value.split('-').map(Number);
  assert(year >= 1000 && year <= 9999, label + ' year is outside the supported range.');
  const date = new Date(Date.UTC(year, month - 1, day));
  assert(date.getUTCFullYear() === year && date.getUTCMonth() + 1 === month && date.getUTCDate() === day,
    label + ' is not a real calendar date.');
  return value;
}

function assertProtectedLocalDateTime(value, label) {
  assert(typeof value === 'string', label + ' must be local date-time text.');
  const match = PROTECTED_TIME_LOCAL_DATE_TIME_PATTERN.exec(value);
  assert(match, label + ' must use YYYY-MM-DDTHH:mm[:ss[.SSS]] without an offset.');
  assertProtectedDate(match[1], label + ' date');
  assert(Number(match[2]) <= 23 && Number(match[3]) <= 59
    && Number(match[4] ?? 0) <= 59, label + ' contains an invalid clock time.');
  return value;
}

function assertProtectedLocalTime(value, label) {
  assert(typeof value === 'string', label + ' must be local clock time text.');
  const match = PROTECTED_TIME_LOCAL_CLOCK_PATTERN.exec(value);
  assert(match, label + ' must use HH:mm[:ss[.SSS]].');
  assert(Number(match[1]) <= 23 && Number(match[2]) <= 59
    && Number(match[3] ?? 0) <= 59, label + ' contains an invalid clock time.');
  return value;
}

function protectedTimeParts(value) {
  const match = PROTECTED_TIME_LOCAL_CLOCK_PATTERN.exec(value);
  return {
    hour: Number(match[1]),
    minute: Number(match[2]),
    second: Number(match[3] ?? 0),
    millisecond: Number((match[4] ?? '').padEnd(3, '0') || 0),
  };
}

function protectedTimeDateTime(date, time) {
  const parts = protectedTimeParts(time);
  const suffix = parts.second === 0 && parts.millisecond === 0
    ? ''
    : ':' + String(parts.second).padStart(2, '0') +
      (parts.millisecond ? '.' + String(parts.millisecond).padStart(3, '0') : '');
  return date + 'T' + String(parts.hour).padStart(2, '0') + ':' +
    String(parts.minute).padStart(2, '0') + suffix;
}

function protectedTimeAddDays(date, amount) {
  const [year, month, day] = date.split('-').map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + amount));
  return [
    String(next.getUTCFullYear()).padStart(4, '0'),
    String(next.getUTCMonth() + 1).padStart(2, '0'),
    String(next.getUTCDate()).padStart(2, '0'),
  ].join('-');
}

function protectedTimeIsoWeekday(date) {
  const [year, month, day] = date.split('-').map(Number);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return weekday === 0 ? 7 : weekday;
}

function firstProtectedWeeklyOccurrence(draft) {
  let date = draft.startDate;
  for (let offset = 0; offset < 7; offset += 1) {
    if (draft.endDateExclusive && date >= draft.endDateExclusive) break;
    if (draft.weekdays.includes(protectedTimeIsoWeekday(date))) return date;
    date = protectedTimeAddDays(date, 1);
  }
  throw new RangeError('Weekly Protected Time must contain at least one occurrence in its effective date range.');
}

/** Normalize a one-off or weekly block while rejecting caller-owned identity fields. */
export function normalizeProtectedTimeBlock(input) {
  assert(input && typeof input === 'object' && !Array.isArray(input),
    'A Protected Time block object is required.');
  const patternKind = input.patternKind;
  assert(PROTECTED_TIME_PATTERNS.includes(patternKind), 'patternKind must be one_off or weekly.');
  const common = ['label', 'category', 'protectionMode', 'patternKind', 'timeZone'];
  const temporal = patternKind === 'one_off'
    ? ['startLocalDateTime', 'endLocalDateTime', 'startDisambiguation', 'endDisambiguation']
    : ['startDate', 'endDateExclusive', 'weekdays', 'startLocalTime', 'endLocalTime', 'endsNextDay'];
  const allowed = new Set([...common, ...temporal]);
  assert(Object.keys(input).every((key) => allowed.has(key)),
    'Protected Time block contains unsupported or server-owned fields.');

  assert(typeof input.label === 'string' && input.label.trim().length >= 1 && input.label.trim().length <= 120,
    'label must contain between 1 and 120 characters.');
  assert(input.category == null || typeof input.category === 'string',
    'category must be null or text.');
  const category = input.category == null ? null : input.category.trim();
  assert(category == null || (category.length >= 1 && category.length <= 50),
    'category must be null or contain between 1 and 50 characters.');
  assert(PROTECTION_MODES.includes(input.protectionMode), 'protectionMode must be hard or flexible.');
  assert(typeof input.timeZone === 'string' && input.timeZone.trim().length > 0 && input.timeZone.length <= 100,
    'timeZone must be a non-empty IANA identifier.');

  const draft = {
    label: input.label.trim(),
    category,
    protectionMode: input.protectionMode,
    patternKind,
    timeZone: input.timeZone.trim(),
    startLocalDateTime: null,
    endLocalDateTime: null,
    startDisambiguation: null,
    endDisambiguation: null,
    startDate: null,
    endDateExclusive: null,
    weekdays: null,
    startLocalTime: null,
    endLocalTime: null,
    endsNextDay: null,
  };

  if (patternKind === 'one_off') {
    draft.startLocalDateTime = assertProtectedLocalDateTime(input.startLocalDateTime, 'startLocalDateTime');
    draft.endLocalDateTime = assertProtectedLocalDateTime(input.endLocalDateTime, 'endLocalDateTime');
    // The authoritative IANA resolver decides instant ordering; equal or reversed
    // wall times can still describe a valid interval across a DST fold.
    draft.startDisambiguation = input.startDisambiguation ?? 'earlier';
    draft.endDisambiguation = input.endDisambiguation ?? 'earlier';
    assert(['earlier', 'later', 'reject'].includes(draft.startDisambiguation),
      'startDisambiguation must be earlier, later or reject.');
    assert(['earlier', 'later', 'reject'].includes(draft.endDisambiguation),
      'endDisambiguation must be earlier, later or reject.');
  } else {
    draft.startDate = assertProtectedDate(input.startDate, 'startDate');
    draft.endDateExclusive = input.endDateExclusive == null
      ? null
      : assertProtectedDate(input.endDateExclusive, 'endDateExclusive');
    assert(draft.endDateExclusive == null || draft.endDateExclusive > draft.startDate,
      'endDateExclusive must be after startDate.');
    assert(Array.isArray(input.weekdays) && input.weekdays.length >= 1 && input.weekdays.length <= 7,
      'weekdays must contain one to seven ISO weekdays.');
    assert(input.weekdays.every((day) => Number.isInteger(day) && day >= 1 && day <= 7),
      'weekdays must use ISO values 1 (Monday) through 7 (Sunday).');
    draft.weekdays = [...new Set(input.weekdays)].sort((a, b) => a - b);
    assert(draft.weekdays.length === input.weekdays.length, 'weekdays cannot contain duplicates.');
    draft.startLocalTime = assertProtectedLocalTime(input.startLocalTime, 'startLocalTime');
    draft.endLocalTime = assertProtectedLocalTime(input.endLocalTime, 'endLocalTime');
    assert(typeof input.endsNextDay === 'boolean', 'endsNextDay must be an explicit boolean.');
    draft.endsNextDay = input.endsNextDay;
    const start = protectedTimeParts(draft.startLocalTime);
    const end = protectedTimeParts(draft.endLocalTime);
    const startValue = (((start.hour * 60 + start.minute) * 60 + start.second) * 1000) + start.millisecond;
    const endValue = (((end.hour * 60 + end.minute) * 60 + end.second) * 1000) + end.millisecond;
    assert(
      draft.endsNextDay ? endValue <= startValue : endValue > startValue,
      'A weekly block must have a positive clock range; set endsNextDay for an overnight block.',
    );
    firstProtectedWeeklyOccurrence(draft);
  }
  return Object.freeze({
    ...draft,
    weekdays: draft.weekdays ? Object.freeze([...draft.weekdays]) : null,
  });
}

export function normalizeProtectedTimeBlockId(value) {
  assert(typeof value === 'string' && PROTECTED_TIME_UUID_V7_PATTERN.test(value),
    'blockId must be a valid UUIDv7.');
  return value.toLowerCase();
}

export function normalizeProtectedTimeExpectedVersion(value) {
  assert(typeof value === 'string' && PROTECTED_TIME_OFFSET_TIMESTAMP_PATTERN.test(value)
    && Number.isFinite(Date.parse(value)),
    'expectedUpdatedAt must be an ISO timestamp with an explicit offset.');
  return value;
}

/** Build the authoritative wall-time range to be passed to the pinned IANA resolver. */
export function buildProtectedTimeResolutionRequest(draft) {
  assert(draft && typeof draft === 'object', 'A normalized Protected Time draft is required.');
  let startLocalDateTime;
  let endLocalDateTime;
  if (draft.patternKind === 'one_off') {
    startLocalDateTime = draft.startLocalDateTime;
    endLocalDateTime = draft.endLocalDateTime;
  } else if (draft.patternKind === 'weekly') {
    const firstDate = firstProtectedWeeklyOccurrence(draft);
    const endDate = draft.endsNextDay ? protectedTimeAddDays(firstDate, 1) : firstDate;
    startLocalDateTime = protectedTimeDateTime(firstDate, draft.startLocalTime);
    endLocalDateTime = protectedTimeDateTime(endDate, draft.endLocalTime);
  } else {
    throw new RangeError('Unsupported Protected Time pattern.');
  }
  return Object.freeze({
    timeZone: draft.timeZone,
    start: Object.freeze({
      localDateTime: startLocalDateTime,
      disambiguation: draft.startDisambiguation ?? 'earlier',
      gapStrategy: 'next-valid',
    }),
    end: Object.freeze({
      localDateTime: endLocalDateTime,
      disambiguation: draft.endDisambiguation ?? 'earlier',
      gapStrategy: 'next-valid',
    }),
  });
}

/**
 * Build the exact 20-field database patch only after a matching authoritative
 * IANA resolution. Weekly rows keep civil recurrence fields and resolver policy.
 */
export function buildProtectedTimeBlockPatch(draft, resolution, { taskScheduleDecisions = [], taskScheduleSnapshot = [] } = {}) {
  assert(draft && typeof draft === 'object', 'A normalized Protected Time draft is required.');
  assert(resolution && typeof resolution === 'object' && resolution.authoritative === true
    && resolution.rulesSource === 'iana-tzdb', 'An authoritative IANA resolution is required.');
  assert(resolution.requestedTimeZone === draft.timeZone,
    'Resolver timezone does not match the Protected Time draft.');
  const request = buildProtectedTimeResolutionRequest(draft);
  assert(resolution.start?.requestedLocalDateTime === request.start.localDateTime
    && resolution.end?.requestedLocalDateTime === request.end.localDateTime,
    'Resolver endpoints do not match the Protected Time draft.');
  assert(typeof resolution.timeZone === 'string' && resolution.timeZone.length > 0
    && typeof resolution.rulesVersion === 'string' && resolution.rulesVersion.length > 0
    && typeof resolution.resolverVersion === 'string' && resolution.resolverVersion.length > 0,
    'Resolver metadata is incomplete.');

  const oneOff = draft.patternKind === 'one_off';
  return Object.freeze({
    label: draft.label,
    category: draft.category,
    protection_mode: draft.protectionMode,
    pattern_kind: draft.patternKind,
    time_zone: resolution.timeZone,
    start_local: oneOff ? draft.startLocalDateTime : null,
    end_local: oneOff ? draft.endLocalDateTime : null,
    starts_at: oneOff ? resolution.startsAt : null,
    ends_at: oneOff ? resolution.endsAt : null,
    start_disambiguation: oneOff ? draft.startDisambiguation : null,
    end_disambiguation: oneOff ? draft.endDisambiguation : null,
    start_gap_strategy: oneOff ? 'next-valid' : null,
    end_gap_strategy: oneOff ? 'next-valid' : null,
    start_date: oneOff ? null : draft.startDate,
    end_date_exclusive: oneOff ? null : draft.endDateExclusive,
    weekdays: oneOff ? null : [...draft.weekdays],
    start_time_local: oneOff ? null : draft.startLocalTime,
    end_time_local: oneOff ? null : draft.endLocalTime,
    ends_next_day: oneOff ? null : draft.endsNextDay,
    task_schedule_conflict_decisions: [...taskScheduleDecisions],
    task_schedule_snapshot: [...taskScheduleSnapshot],
    resolver_metadata: oneOff
      ? {
        rulesSource: resolution.rulesSource,
        rulesVersion: resolution.rulesVersion,
        resolverVersion: resolution.resolverVersion,
        authoritative: true,
        start: resolution.start,
        end: resolution.end,
      }
      : {
        rulesSource: resolution.rulesSource,
        rulesVersion: resolution.rulesVersion,
        resolverVersion: resolution.resolverVersion,
        authoritative: true,
        occurrenceValidation: { start: resolution.start, end: resolution.end },
        weeklyPolicy: { fold: 'earlier', gap: 'next-valid' },
      },
  });
}

/**
 * @param {{ action: string, blockId: string, expectedUpdatedAt?: string | null, blockDraft?: object | null, taskScheduleDecisions?: object[] }} input
 * @param {Crypto} [cryptoProvider]
 */
export async function hashProtectedTimeMutationIntent({
  action,
  blockId,
  expectedUpdatedAt = null,
  blockDraft = null,
  taskScheduleDecisions = [],
}, cryptoProvider = globalThis.crypto) {
  assert(cryptoProvider?.subtle?.digest, 'Web Crypto SHA-256 is unavailable.');
  assert(PROTECTED_TIME_MUTATIONS.includes(action), 'Unsupported Protected Time mutation.');
  assert(Array.isArray(taskScheduleDecisions) && taskScheduleDecisions.length <= 500,
    'taskScheduleDecisions must be an array containing at most 500 entries.');
  const normalizedId = normalizeProtectedTimeBlockId(blockId);
  const normalizedVersion = expectedUpdatedAt == null
    ? null
    : normalizeProtectedTimeExpectedVersion(expectedUpdatedAt);
  const version = taskScheduleDecisions.length > 0
    ? PROTECTED_TIME_MUTATION_INTENT_VERSION_V2
    : PROTECTED_TIME_MUTATION_INTENT_VERSION;
  const canonical = {
    version,
    action,
    blockId: action === 'create' ? null : normalizedId,
    expectedUpdatedAt: normalizedVersion,
    blockDraft,
  };
  if (taskScheduleDecisions.length > 0) canonical.taskScheduleDecisions = taskScheduleDecisions;
  const canonicalPayload = JSON.stringify(canonical);
  const digest = await cryptoProvider.subtle.digest('SHA-256', new TextEncoder().encode(canonicalPayload));
  const payloadHash = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
  return Object.freeze({
    version,
    canonicalPayload,
    hashAlgorithm: 'sha-256',
    payloadHash,
  });
}
