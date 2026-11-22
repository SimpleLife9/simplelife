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
