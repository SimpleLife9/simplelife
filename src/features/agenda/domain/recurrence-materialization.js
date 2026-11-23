const TERMINAL_STATES = new Set(['completed', 'cancelled', 'skipped', 'superseded']);
const PRESERVED_STATES = new Set(['needs_review']);

function assert(condition, message) {
  if (!condition) throw new RangeError(message);
}

function object(value, label) {
  assert(value && typeof value === 'object' && !Array.isArray(value), label + ' must be an object.');
}

function validInterval(startsAt, endsAt, label) {
  const start = Date.parse(startsAt);
  const end = Date.parse(endsAt);
  assert(Number.isFinite(start) && Number.isFinite(end) && end > start,
    label + ' requires a positive authoritative UTC interval.');
  return [new Date(start).toISOString(), new Date(end).toISOString()];
}

function validateCandidate(candidate) {
  object(candidate, 'Candidate occurrence');
  assert(typeof candidate.occurrenceKey === 'string' && candidate.occurrenceKey.length > 0,
    'Candidate occurrence requires occurrenceKey.');
  assert(candidate.status == null || candidate.status === 'scheduled',
    'Only scheduled candidates may be materialized.');
  if (candidate.temporalKind === 'all_day') {
    assert(typeof candidate.startDate === 'string' && typeof candidate.endDateExclusive === 'string',
      'All-day candidate requires startDate and endDateExclusive.');
    assert(candidate.endDateExclusive > candidate.startDate,
      'All-day candidate endDateExclusive must follow startDate.');
    assert(candidate.startsAt == null && candidate.endsAt == null,
      'All-day candidate cannot contain UTC instants.');
    return Object.freeze({
      ...candidate,
      status: 'scheduled',
      startDate: candidate.startDate,
      endDateExclusive: candidate.endDateExclusive,
      startsAt: null,
      endsAt: null,
    });
  }
  assert(candidate.temporalKind === 'zoned_civil',
    'Candidate temporalKind must be all_day or zoned_civil.');
  assert(candidate.rulesSource === 'iana-tzdb' && candidate.authoritative === true,
    'Timed occurrence must be resolved authoritatively by the pinned IANA TZDB.');
  assert(typeof candidate.timeZone === 'string' && candidate.timeZone.length > 0,
    'Timed occurrence requires an IANA timeZone.');
  assert(typeof candidate.rulesVersion === 'string' && candidate.rulesVersion.length > 0,
    'Timed occurrence requires rulesVersion.');
  assert(typeof candidate.resolverVersion === 'string' && candidate.resolverVersion.length > 0,
    'Timed occurrence requires resolverVersion.');
  const [startsAt, endsAt] = validInterval(candidate.startsAt, candidate.endsAt, 'Timed candidate');
  return Object.freeze({ ...candidate, status: 'scheduled', startsAt, endsAt });
}

function validateExisting(existing) {
  object(existing, 'Existing occurrence');
  assert(typeof existing.occurrenceKey === 'string' && existing.occurrenceKey.length > 0,
    'Existing occurrence requires occurrenceKey.');
  const status = existing.status ?? 'scheduled';
  assert([
    'scheduled', 'completed', 'cancelled', 'skipped',
    'needs_review', 'superseded',
  ].includes(status), 'Existing occurrence has an unsupported lifecycle status.');
  return Object.freeze({ ...existing, status });
}

function sameTemporalCommitment(existing, candidate) {
  if (existing.temporalKind !== candidate.temporalKind) return false;
  if (candidate.temporalKind === 'all_day') {
    return existing.startDate === candidate.startDate
      && existing.endDateExclusive === candidate.endDateExclusive;
  }
  return Date.parse(existing.startsAt) === Date.parse(candidate.startsAt)
    && Date.parse(existing.endsAt) === Date.parse(candidate.endsAt);
}

function preserveReason(existing) {
  if (TERMINAL_STATES.has(existing.status)) return 'terminal';
  if (PRESERVED_STATES.has(existing.status)) return 'needs_review';
  if (existing.overrideKind != null || existing.hasOverride === true) return 'override';
  if (existing.reviewState != null && existing.reviewState !== 'accepted') return 'review';
  return null;
}

/**
 * Pure, deterministic reconciliation for one bounded materialization batch.
 *
 * It never performs I/O. Re-running with the same candidates produces the same
 * actions; unique occurrence keys are the database idempotency boundary.
 * Existing terminal, override and TZDB review rows are immutable to generation.
 */
export function planOccurrenceMaterializationReconciliation({
  candidates,
  existingOccurrences = [],
}) {
  assert(Array.isArray(candidates), 'candidates must be an array.');
  assert(Array.isArray(existingOccurrences), 'existingOccurrences must be an array.');
  assert(candidates.length <= 500, 'A materialization batch cannot exceed 500 candidates.');

  const candidateMap = new Map();
  for (const raw of candidates) {
    const candidate = validateCandidate(raw);
    assert(!candidateMap.has(candidate.occurrenceKey),
      'Candidate batch contains a duplicate occurrenceKey: ' + candidate.occurrenceKey);
    candidateMap.set(candidate.occurrenceKey, candidate);
  }

  const existingMap = new Map();
  for (const raw of existingOccurrences) {
    const existing = validateExisting(raw);
    assert(!existingMap.has(existing.occurrenceKey),
      'Existing materialized rows contain a duplicate occurrenceKey: ' + existing.occurrenceKey);
    existingMap.set(existing.occurrenceKey, existing);
  }

  const actions = [];
  let insertCount = 0;
  let preserveCount = 0;
  let reviewCount = 0;
  let unchangedCount = 0;

  for (const [occurrenceKey, candidate] of candidateMap) {
    const existing = existingMap.get(occurrenceKey);
    if (!existing) {
      actions.push(Object.freeze({ action: 'insert', occurrenceKey, occurrence: candidate }));
      insertCount += 1;
      continue;
    }

    const reason = preserveReason(existing);
    if (reason) {
      actions.push(Object.freeze({ action: 'preserve', reason, occurrenceKey, occurrence: existing }));
      preserveCount += 1;
      continue;
    }

    if (sameTemporalCommitment(existing, candidate)) {
      actions.push(Object.freeze({ action: 'unchanged', occurrenceKey, occurrence: existing }));
      unchangedCount += 1;
      continue;
    }

    const proposed = Object.freeze({
      temporalKind: candidate.temporalKind,
      startDate: candidate.startDate ?? null,
      endDateExclusive: candidate.endDateExclusive ?? null,
      startsAt: candidate.startsAt ?? null,
      endsAt: candidate.endsAt ?? null,
      timeZone: candidate.timeZone ?? null,
      rulesSource: candidate.rulesSource ?? null,
      rulesVersion: candidate.rulesVersion ?? null,
      resolverVersion: candidate.resolverVersion ?? null,
    });
    const previous = Object.freeze({
      temporalKind: existing.temporalKind,
      startDate: existing.startDate ?? null,
      endDateExclusive: existing.endDateExclusive ?? null,
      startsAt: existing.startsAt ?? null,
      endsAt: existing.endsAt ?? null,
      timeZone: existing.timeZone ?? null,
      rulesSource: existing.rulesSource ?? null,
      rulesVersion: existing.rulesVersion ?? null,
      resolverVersion: existing.resolverVersion ?? null,
    });
    actions.push(Object.freeze({
      action: 'needs_review',
      reason: 'materialized_commitment_changed',
      occurrenceKey,
      expectedUpdatedAt: existing.updatedAt ?? existing.updated_at ?? null,
      previous,
      proposed,
      occurrence: Object.freeze({ ...existing, status: 'needs_review' }),
    }));
    reviewCount += 1;
  }

  return Object.freeze({
    candidateCount: candidateMap.size,
    existingCount: existingMap.size,
    insertCount,
    preserveCount,
    unchangedCount,
    reviewCount,
    actions: Object.freeze(actions),
  });
}
