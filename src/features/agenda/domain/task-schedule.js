import { parseCalendarDate, validateTimedRange } from './temporal.js';

export const TASK_SCHEDULE_STATUSES = Object.freeze([
  'proposed', 'confirmed', 'cancelled', 'released', 'elapsed',
]);
export const TASK_SCHEDULE_MUTATIONS = Object.freeze([
  'create', 'edit', 'confirm', 'cancel', 'release', 'mark_elapsed',
]);
export const TASK_SCHEDULE_INTENT_VERSION = 'task-schedule-mutation-v1';

const UUID_V7_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LOCAL_DATE_TIME_PATTERN = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/;
const OFFSET_INSTANT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/i;

function assert(condition, message) {
  if (!condition) throw new RangeError(message);
}

function normalizeLocalDateTime(value, label) {
  assert(typeof value === 'string', label + ' must be a local date-time.');
  const match = LOCAL_DATE_TIME_PATTERN.exec(value);
  assert(match, label + ' must use YYYY-MM-DDTHH:mm[:ss[.SSS]] without an offset.');
  parseCalendarDate(match[1]);
  assert(Number(match[2]) <= 23 && Number(match[3]) <= 59
    && Number(match[4] ?? 0) <= 59, label + ' contains an invalid clock time.');
  return value;
}

function normalizeInstant(value, label) {
  assert(typeof value === 'string' && OFFSET_INSTANT_PATTERN.test(value)
    && Number.isFinite(Date.parse(value)), label + ' must be an ISO instant with an explicit offset.');
  return new Date(Date.parse(value)).toISOString();
}

export function normalizeTaskScheduleId(value) {
  assert(typeof value === 'string' && UUID_V7_PATTERN.test(value),
    'taskScheduleId must be a valid UUIDv7.');
  return value.toLowerCase();
}

export function normalizeTaskId(value) {
  assert(typeof value === 'string' && UUID_V7_PATTERN.test(value),
    'taskId must be a valid UUIDv7.');
  return value.toLowerCase();
}

export function normalizeTaskScheduleExpectedVersion(value) {
  assert(typeof value === 'string' && OFFSET_INSTANT_PATTERN.test(value)
    && Number.isFinite(Date.parse(value)),
  'expectedUpdatedAt must be an ISO timestamp with an explicit offset.');
  return value;
}

/** Normalize a timed reservation. Task identity is allowed; owner/actor and state are server-owned. */
export function normalizeTaskScheduleDraft(input) {
  assert(input && typeof input === 'object' && !Array.isArray(input),
    'A TaskSchedule draft is required.');
  const allowed = new Set([
    'taskId', 'timeZone', 'startLocalDateTime', 'endLocalDateTime',
    'startDisambiguation', 'endDisambiguation',
  ]);
  assert(Object.keys(input).every((key) => allowed.has(key)),
    'TaskSchedule contains unsupported or server-owned fields.');
  const taskId = normalizeTaskId(input.taskId);
  assert(typeof input.timeZone === 'string' && input.timeZone.trim().length > 0
    && input.timeZone.trim().length <= 100, 'timeZone must be an IANA timezone identifier.');
  const draft = {
    taskId,
    timeZone: input.timeZone.trim(),
    startLocalDateTime: normalizeLocalDateTime(input.startLocalDateTime, 'startLocalDateTime'),
    endLocalDateTime: normalizeLocalDateTime(input.endLocalDateTime, 'endLocalDateTime'),
    startDisambiguation: input.startDisambiguation ?? 'earlier',
    endDisambiguation: input.endDisambiguation ?? 'earlier',
  };
  assert(['earlier', 'later', 'reject'].includes(draft.startDisambiguation),
    'startDisambiguation must be earlier, later or reject.');
  assert(['earlier', 'later', 'reject'].includes(draft.endDisambiguation),
    'endDisambiguation must be earlier, later or reject.');
  // Wall-clock order is not enough around a DST fold; the pinned IANA resolver
  // determines whether the resulting interval is positive.
  return Object.freeze(draft);
}

export function buildTaskScheduleResolutionRequest(draft) {
  assert(draft && typeof draft === 'object', 'A normalized TaskSchedule draft is required.');
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

/** Build the exact persisted timed interval after authoritative IANA resolution. */
export function buildTaskSchedulePatch(draft, resolution) {
  assert(draft && typeof draft === 'object', 'A normalized TaskSchedule draft is required.');
  assert(resolution && typeof resolution === 'object'
    && resolution.authoritative === true && resolution.rulesSource === 'iana-tzdb',
  'An authoritative IANA resolution is required.');
  assert(resolution.requestedTimeZone === draft.timeZone,
    'Resolver timezone does not match the TaskSchedule draft.');
  const request = buildTaskScheduleResolutionRequest(draft);
  assert(resolution.start?.requestedLocalDateTime === request.start.localDateTime
    && resolution.end?.requestedLocalDateTime === request.end.localDateTime,
  'Resolver endpoints do not match the TaskSchedule draft.');
  assert(typeof resolution.timeZone === 'string' && resolution.timeZone.length > 0
    && typeof resolution.rulesVersion === 'string' && resolution.rulesVersion.length > 0
    && typeof resolution.resolverVersion === 'string' && resolution.resolverVersion.length > 0,
  'TaskSchedule resolver metadata is incomplete.');
  const range = validateTimedRange(
    normalizeInstant(resolution.startsAt, 'resolved startsAt'),
    normalizeInstant(resolution.endsAt, 'resolved endsAt'),
  );
  return Object.freeze({
    task_id: draft.taskId,
    time_zone: resolution.timeZone,
    start_local: draft.startLocalDateTime,
    end_local: draft.endLocalDateTime,
    starts_at: range.startsAt,
    ends_at: range.endsAt,
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
  });
}

export function canTransitionTaskSchedule(status, action) {
  if (!TASK_SCHEDULE_STATUSES.includes(status) || !TASK_SCHEDULE_MUTATIONS.includes(action)) return false;
  if (action === 'edit') return status === 'proposed' || status === 'confirmed';
  if (action === 'confirm') return status === 'proposed';
  if (action === 'cancel') return status === 'proposed' || status === 'confirmed';
  if (action === 'release') return status === 'confirmed';
  if (action === 'mark_elapsed') return status === 'confirmed';
  return false;
}

export function normalizeTaskScheduleMutation({
  action,
  taskScheduleId = null,
  expectedUpdatedAt = null,
  scheduleDraft = null,
  conflictDecisions = [],
}) {
  assert(TASK_SCHEDULE_MUTATIONS.includes(action), 'Unsupported TaskSchedule mutation.');
  const normalizedId = action === 'create' ? null : normalizeTaskScheduleId(taskScheduleId);
  const normalizedVersion = action === 'create'
    ? null
    : normalizeTaskScheduleExpectedVersion(expectedUpdatedAt);
  assert((action === 'create' || action === 'edit') === Boolean(scheduleDraft),
    'Only TaskSchedule create/edit accepts a schedule draft.');
  const normalizedDraft = scheduleDraft == null ? null : normalizeTaskScheduleDraft(scheduleDraft);
  assert(Array.isArray(conflictDecisions) && conflictDecisions.length <= 500,
    'conflictDecisions must be an array with at most 500 entries.');
  assert(action === 'confirm' || action === 'edit' || conflictDecisions.length === 0,
    'Only TaskSchedule confirmation/edit may include conflict decisions.');
  const normalizedDecisions = conflictDecisions.map((item) => {
    assert(item && typeof item === 'object' && !Array.isArray(item),
      'Every Agenda conflict decision must be an object.');
    const allowed = ['blockId','blockUpdatedAt','occurrenceStartsAt','decision'];
    assert(Object.keys(item).length === allowed.length && Object.keys(item).every((key) => allowed.includes(key)),
      'Agenda conflict decision contains unsupported or missing fields.');
    assert(typeof item.blockId === 'string' && UUID_V7_PATTERN.test(item.blockId),
      'Conflict resource id must be a UUIDv7.');
    assert(typeof item.blockUpdatedAt === 'string' && OFFSET_INSTANT_PATTERN.test(item.blockUpdatedAt)
      && Number.isFinite(Date.parse(item.blockUpdatedAt)),
      'Conflict resource version must be an explicit-offset timestamp.');
    assert(typeof item.occurrenceStartsAt === 'string' && OFFSET_INSTANT_PATTERN.test(item.occurrenceStartsAt)
      && Number.isFinite(Date.parse(item.occurrenceStartsAt)),
      'Conflict occurrence start must be an explicit-offset timestamp.');
    assert(['override_hard','keep_flexible','keep_overlap'].includes(item.decision),
      'Agenda conflict decision is unsupported.');
    return Object.freeze({
      blockId: item.blockId.toLowerCase(),
      blockUpdatedAt: item.blockUpdatedAt,
      occurrenceStartsAt: new Date(Date.parse(item.occurrenceStartsAt)).toISOString(),
      decision: item.decision,
    });
  });
  return Object.freeze({
    action,
    taskScheduleId: normalizedId,
    expectedUpdatedAt: normalizedVersion,
    scheduleDraft: normalizedDraft,
    conflictDecisions: Object.freeze(normalizedDecisions),
  });
}

export async function hashTaskScheduleMutationIntent(mutation, cryptoProvider = globalThis.crypto) {
  assert(cryptoProvider?.subtle?.digest, 'Web Crypto SHA-256 is unavailable.');
  const normalized = normalizeTaskScheduleMutation(mutation);
  const draftTuple = normalized.scheduleDraft
    ? [
      normalized.scheduleDraft.taskId,
      normalized.scheduleDraft.timeZone,
      normalized.scheduleDraft.startLocalDateTime,
      normalized.scheduleDraft.endLocalDateTime,
      normalized.scheduleDraft.startDisambiguation,
      normalized.scheduleDraft.endDisambiguation,
    ]
    : null;
  const decisions = normalized.conflictDecisions.map((item) => [
    item.resourceType ?? null,
    item.blockId,
    item.blockUpdatedAt,
    item.occurrenceStartsAt,
    item.decision,
  ]).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  const canonicalPayload = JSON.stringify([
    TASK_SCHEDULE_INTENT_VERSION,
    normalized.action,
    normalized.taskScheduleId,
    normalized.expectedUpdatedAt,
    draftTuple,
    decisions,
  ]);
  const digest = await cryptoProvider.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(canonicalPayload),
  );
  const payloadHash = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
  return Object.freeze({
    version: TASK_SCHEDULE_INTENT_VERSION,
    canonicalPayload,
    hashAlgorithm: 'sha-256',
    payloadHash,
  });
}
