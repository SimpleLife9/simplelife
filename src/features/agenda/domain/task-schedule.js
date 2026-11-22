// TaskSchedule intent and temporal contract. This module performs no I/O and
// never treats Task due_date/due_at as a reserved calendar interval.

export const TASK_SCHEDULE_INTENT_VERSION = 'task-schedule-mutation-v1';
export const TASK_SCHEDULE_STATUSES = Object.freeze([
  'proposed', 'confirmed', 'cancelled', 'released', 'elapsed',
]);
export const TASK_SCHEDULE_MUTATIONS = Object.freeze([
  'create', 'edit', 'confirm', 'cancel', 'release', 'elapsed',
]);

const UUID_V7_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const OFFSET_INSTANT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/i;
const LOCAL_DATE_TIME_PATTERN = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/;

function assert(condition, message) {
  if (!condition) throw new RangeError(message);
}

function normalizeUuidV7(value, label) {
  assert(typeof value === 'string' && UUID_V7_PATTERN.test(value), label + ' must be a UUIDv7.');
  return value.toLowerCase();
}

function normalizeVersion(value) {
  assert(typeof value === 'string' && OFFSET_INSTANT_PATTERN.test(value)
    && Number.isFinite(Date.parse(value)),
  'expectedUpdatedAt must be an ISO timestamp with an explicit offset.');
  // Preserve PostgreSQL microseconds and the exact wire value for compare-and-swap.
  return value;
}

function normalizeLocalDateTime(value, label) {
  assert(typeof value === 'string', label + ' must be local date-time text.');
  const match = LOCAL_DATE_TIME_PATTERN.exec(value);
  assert(match, label + ' must use YYYY-MM-DDTHH:mm[:ss[.SSS]] without an offset.');
  const [, date, hour, minute, second = '0'] = match;
  const [year, month, day] = date.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  assert(year >= 1000 && parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() + 1 === month && parsed.getUTCDate() === day,
  label + ' must contain a real calendar date.');
  assert(Number(hour) <= 23 && Number(minute) <= 59 && Number(second) <= 59,
    label + ' contains an invalid wall-clock time.');
  return value;
}

function normalizeScheduleDraft(input) {
  assert(input && typeof input === 'object' && !Array.isArray(input),
    'A TaskSchedule draft object is required.');
  const allowed = [
    'startLocalDateTime', 'endLocalDateTime', 'timeZone',
    'startDisambiguation', 'endDisambiguation',
  ];
  assert(Object.keys(input).length > 0 && Object.keys(input).every((key) => allowed.includes(key)),
    'TaskSchedule draft contains unsupported or caller-owned fields.');
  const startLocalDateTime = normalizeLocalDateTime(input.startLocalDateTime, 'startLocalDateTime');
  const endLocalDateTime = normalizeLocalDateTime(input.endLocalDateTime, 'endLocalDateTime');
  assert(typeof input.timeZone === 'string' && input.timeZone.trim().length >= 1
    && input.timeZone.trim().length <= 100,
  'timeZone must be a non-empty IANA timezone identifier.');
  const timeZone = input.timeZone.trim();
  try {
    new Intl.DateTimeFormat('en', { timeZone }).format(new Date(0));
  } catch {
    throw new RangeError('timeZone must be a supported IANA timezone identifier.');
  }
  const startDisambiguation = input.startDisambiguation ?? 'earlier';
  const endDisambiguation = input.endDisambiguation ?? 'earlier';
  assert(startDisambiguation === 'earlier' || startDisambiguation === 'later',
    'startDisambiguation must be earlier or later.');
  assert(endDisambiguation === 'earlier' || endDisambiguation === 'later',
    'endDisambiguation must be earlier or later.');
  return Object.freeze({
    startLocalDateTime,
    endLocalDateTime,
    timeZone,
    startDisambiguation,
    endDisambiguation,
  });
}

function normalizeDecisionArrays(eventDecisions, protectedTimeDecisions) {
  assert(Array.isArray(eventDecisions) && eventDecisions.length <= 500,
    'eventDecisions must be an array with at most 500 entries.');
  const events = eventDecisions.map((item) => {
    assert(item && typeof item === 'object' && !Array.isArray(item),
      'Each Event conflict decision must be an object.');
    const keys = ['eventId', 'eventUpdatedAt', 'decision'];
    assert(Object.keys(item).length === keys.length && Object.keys(item).every((key) => keys.includes(key)),
      'Event conflict decision contains unsupported or missing fields.');
    assert(item.decision === 'keep_overlap', 'Event conflict decision must be keep_overlap.');
    assert(typeof item.eventUpdatedAt === 'string' && OFFSET_INSTANT_PATTERN.test(item.eventUpdatedAt)
      && Number.isFinite(Date.parse(item.eventUpdatedAt)),
    'Event conflict eventUpdatedAt must be an ISO timestamp with an explicit offset.');
    return Object.freeze({
      eventId: normalizeUuidV7(item.eventId, 'eventId'),
      eventUpdatedAt: item.eventUpdatedAt,
      decision: item.decision,
    });
  });
  const eventKeys = events.map((item) => item.eventId + ':' + item.eventUpdatedAt);
  assert(new Set(eventKeys).size === eventKeys.length, 'Event conflict decisions cannot contain duplicates.');

  assert(Array.isArray(protectedTimeDecisions) && protectedTimeDecisions.length <= 500,
    'protectedTimeDecisions must be an array with at most 500 entries.');
  const protectedDecisions = protectedTimeDecisions.map((item) => {
    assert(item && typeof item === 'object' && !Array.isArray(item),
      'Each Protected Time conflict decision must be an object.');
    const keys = ['blockId', 'blockUpdatedAt', 'occurrenceStartsAt', 'decision'];
    assert(Object.keys(item).length === keys.length && Object.keys(item).every((key) => keys.includes(key)),
      'Protected Time conflict decision contains unsupported or missing fields.');
    assert(item.decision === 'override_hard' || item.decision === 'keep_flexible',
      'Protected Time decision must be override_hard or keep_flexible.');
    assert(typeof item.blockUpdatedAt === 'string' && OFFSET_INSTANT_PATTERN.test(item.blockUpdatedAt)
      && Number.isFinite(Date.parse(item.blockUpdatedAt)),
    'blockUpdatedAt must be an ISO timestamp with an explicit offset.');
    assert(typeof item.occurrenceStartsAt === 'string' && OFFSET_INSTANT_PATTERN.test(item.occurrenceStartsAt)
      && Number.isFinite(Date.parse(item.occurrenceStartsAt)),
    'occurrenceStartsAt must be an ISO timestamp with an explicit offset.');
    return Object.freeze({
      blockId: normalizeUuidV7(item.blockId, 'blockId'),
      blockUpdatedAt: item.blockUpdatedAt,
      occurrenceStartsAt: new Date(Date.parse(item.occurrenceStartsAt)).toISOString(),
      decision: item.decision,
    });
  });
  const protectedKeys = protectedDecisions.map((item) =>
    item.blockId + ':' + item.occurrenceStartsAt);
  assert(new Set(protectedKeys).size === protectedKeys.length,
    'Protected Time decisions cannot contain duplicate occurrences.');

  return Object.freeze({
    eventDecisions: Object.freeze(events),
    protectedTimeDecisions: Object.freeze(protectedDecisions),
  });
}

/** Parse an untrusted TaskSchedule mutation into a strict, immutable intent. */
export function normalizeTaskScheduleMutation(input) {
  assert(input && typeof input === 'object' && !Array.isArray(input),
    'TaskSchedule mutation body must be an object.');
  const action = input.action;
  assert(TASK_SCHEDULE_MUTATIONS.includes(action), 'Unsupported TaskSchedule mutation action.');

  if (action === 'create') {
    const allowed = ['action', 'taskId', 'schedule', 'eventDecisions', 'protectedTimeDecisions'];
    assert(Object.keys(input).every((key) => allowed.includes(key))
      && 'taskId' in input && 'schedule' in input,
    'TaskSchedule create body contains unsupported or missing fields.');
    const decisions = normalizeDecisionArrays(input.eventDecisions ?? [], input.protectedTimeDecisions ?? []);
    return Object.freeze({
      action,
      taskId: normalizeUuidV7(input.taskId, 'taskId'),
      taskScheduleId: null,
      expectedUpdatedAt: null,
      schedule: normalizeScheduleDraft(input.schedule),
      ...decisions,
    });
  }

  const scheduleMutation = action === 'edit';
  const allowed = scheduleMutation
    ? ['action', 'taskScheduleId', 'expectedUpdatedAt', 'schedule', 'eventDecisions', 'protectedTimeDecisions']
    : ['action', 'taskScheduleId', 'expectedUpdatedAt'];
  assert(Object.keys(input).every((key) => allowed.includes(key))
    && 'taskScheduleId' in input && 'expectedUpdatedAt' in input
    && (!scheduleMutation || 'schedule' in input),
  'TaskSchedule mutation body contains unsupported or missing fields.');
  const decisions = normalizeDecisionArrays(input.eventDecisions ?? [], input.protectedTimeDecisions ?? []);
  assert(scheduleMutation || (decisions.eventDecisions.length === 0 && decisions.protectedTimeDecisions.length === 0),
    'Only TaskSchedule edit may include conflict decisions.');
  return Object.freeze({
    action,
    taskId: null,
    taskScheduleId: normalizeUuidV7(input.taskScheduleId, 'taskScheduleId'),
    expectedUpdatedAt: normalizeVersion(input.expectedUpdatedAt),
    schedule: scheduleMutation ? normalizeScheduleDraft(input.schedule) : null,
    ...decisions,
  });
}

/** Request object consumed by the pinned IANA resolver. */
export function buildTaskScheduleResolutionRequest(mutation) {
  assert(mutation?.schedule && typeof mutation.schedule === 'object',
    'A normalized TaskSchedule schedule is required.');
  const draft = mutation.schedule;
  return Object.freeze({
    timeZone: draft.timeZone,
    start: Object.freeze({
      localDateTime: draft.startLocalDateTime,
      disambiguation: draft.startDisambiguation,
      gapStrategy: 'next-valid',
    }),
    end: Object.freeze({
      localDateTime: draft.endLocalDateTime,
      disambiguation: draft.endDisambiguation,
      gapStrategy: 'next-valid',
    }),
  });
}

/** Build the exact 14-field DB patch from a matching authoritative IANA resolution. */
export function buildTaskSchedulePatch({
  mutation, resolution, scheduleStatus = 'proposed',
  conflictDecisions = [], conflictSnapshot = [],
}) {
  assert(mutation?.schedule && mutation.action === 'create' || mutation?.schedule && mutation.action === 'edit',
    'TaskSchedule create or edit intent is required.');
  assert(TASK_SCHEDULE_STATUSES.includes(scheduleStatus),
    'scheduleStatus is invalid.');
  assert(Array.isArray(conflictDecisions) && conflictDecisions.length <= 1000,
    'conflictDecisions must be an array.');
  assert(Array.isArray(conflictSnapshot) && conflictSnapshot.length <= 1500,
    'conflictSnapshot must be an array.');
  const request = buildTaskScheduleResolutionRequest(mutation);
  assert(resolution && resolution.authoritative === true && resolution.rulesSource === 'iana-tzdb',
    'TaskSchedule requires authoritative IANA TZDB resolution.');
  assert(resolution.requestedTimeZone === request.timeZone && resolution.timeZone === request.timeZone,
    'Resolver timezone does not match the TaskSchedule draft.');
  assert(resolution.start?.requestedLocalDateTime === request.start.localDateTime
    && resolution.end?.requestedLocalDateTime === request.end.localDateTime,
  'Resolver endpoints do not match the requested TaskSchedule wall times.');
  assert(resolution.start?.disambiguation === request.start.disambiguation
    && resolution.end?.disambiguation === request.end.disambiguation,
  'Resolver disambiguation does not match the TaskSchedule draft.');
  assert(resolution.start?.gapStrategy === 'next-valid' && resolution.end?.gapStrategy === 'next-valid',
    'Resolver gap strategy must be next-valid.');
  assert(typeof resolution.startsAt === 'string' && Number.isFinite(Date.parse(resolution.startsAt))
    && typeof resolution.endsAt === 'string' && Number.isFinite(Date.parse(resolution.endsAt))
    && Date.parse(resolution.endsAt) > Date.parse(resolution.startsAt),
  'Resolved TaskSchedule interval must have a positive UTC duration.');
  assert(resolution.start.instant === resolution.startsAt && resolution.end.instant === resolution.endsAt,
    'Resolver endpoint instants do not match the interval.');
  assert(typeof resolution.rulesVersion === 'string' && resolution.rulesVersion.length > 0
    && typeof resolution.resolverVersion === 'string' && resolution.resolverVersion.length > 0,
  'Resolver metadata must include TZDB and resolver versions.');
  const draft = mutation.schedule;
  return Object.freeze({
    task_id: mutation.taskId,
    schedule_status: scheduleStatus,
    start_local: draft.startLocalDateTime,
    end_local: draft.endLocalDateTime,
    time_zone: resolution.timeZone,
    starts_at: resolution.startsAt,
    ends_at: resolution.endsAt,
    start_disambiguation: draft.startDisambiguation,
    end_disambiguation: draft.endDisambiguation,
    start_gap_strategy: 'next-valid',
    end_gap_strategy: 'next-valid',
    resolver_metadata: Object.freeze({
      rulesSource: resolution.rulesSource,
      rulesVersion: resolution.rulesVersion,
      resolverVersion: resolution.resolverVersion,
      authoritative: true,
      start: resolution.start,
      end: resolution.end,
    }),
    conflict_decisions: Object.freeze(conflictDecisions.map((item) => ({ ...item }))),
    conflict_snapshot: Object.freeze(conflictSnapshot.map((item) => ({ ...item }))),
  });
}

export function normalizeTaskScheduleIdempotencyKey(value) {
  return normalizeUuidV7(value, 'Idempotency-Key');
}

function eventDecisionTuple(values) {
  return values.map((item) => [item.eventId, item.eventUpdatedAt, item.decision])
    .sort((a, b) => String(a[0]).localeCompare(String(b[0])));
}

function protectedDecisionTuple(values) {
  return values.map((item) => [
    item.blockId, item.blockUpdatedAt, item.occurrenceStartsAt, item.decision,
  ]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))
    || String(a[2]).localeCompare(String(b[2])));
}

function scheduleTuple(draft) {
  return draft ? [
    draft.startLocalDateTime,
    draft.endLocalDateTime,
    draft.timeZone,
    draft.startDisambiguation,
    draft.endDisambiguation,
  ] : null;
}

export function buildTaskScheduleMutationIntent(mutation) {
  assert(mutation && typeof mutation === 'object', 'A normalized TaskSchedule mutation is required.');
  return Object.freeze({
    version: TASK_SCHEDULE_INTENT_VERSION,
    canonicalPayload: JSON.stringify([
      TASK_SCHEDULE_INTENT_VERSION,
      mutation.action,
      mutation.action === 'create' ? null : mutation.taskScheduleId,
      mutation.action === 'create' ? mutation.taskId : null,
      mutation.expectedUpdatedAt,
      scheduleTuple(mutation.schedule),
      eventDecisionTuple(mutation.eventDecisions),
      protectedDecisionTuple(mutation.protectedTimeDecisions),
    ]),
  });
}

export async function hashTaskScheduleMutationIntent(mutation, cryptoProvider = globalThis.crypto) {
  assert(cryptoProvider?.subtle?.digest, 'Web Crypto SHA-256 is unavailable.');
  const intent = buildTaskScheduleMutationIntent(mutation);
  const digest = await cryptoProvider.subtle.digest(
    'SHA-256', new TextEncoder().encode(intent.canonicalPayload),
  );
  const payloadHash = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return Object.freeze({ ...intent, hashAlgorithm: 'sha-256', payloadHash });
}
