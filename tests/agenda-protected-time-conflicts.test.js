import test from 'node:test';
import assert from 'node:assert/strict';
import {
  findProtectedTimeConflicts,
  normalizeProtectedTimeDecisions,
} from '../src/features/agenda/domain/protected-time-conflicts.js';

function utcResolver(range) {
  const instant = (local) => {
    const value = Date.parse(local + 'Z');
    if (!Number.isFinite(value)) throw new RangeError('invalid local value');
    return new Date(value).toISOString();
  };
  const startsAt = instant(range.start.localDateTime);
  const endsAt = instant(range.end.localDateTime);
  if (Date.parse(endsAt) <= Date.parse(startsAt)) throw new RangeError('end must follow start');
  return { startsAt, endsAt, authoritative: true, rulesSource: 'iana-tzdb', rulesVersion: 'test', resolverVersion: 'test' };
}

function event(startsAt, endsAt) {
  return { temporal_kind: 'fixed_instant', starts_at: startsAt, ends_at: endsAt };
}
function oneOff(overrides = {}) {
  return {
    id: '019a0000-0000-7000-8000-000000000111',
    updated_at: '2026-11-20T10:00:00.000000+00:00',
    label: 'Sueño',
    category: 'salud',
    protection_mode: 'hard',
    pattern_kind: 'one_off',
    time_zone: 'UTC',
    starts_at: '2026-11-23T10:00:00.000Z',
    ends_at: '2026-11-23T11:00:00.000Z',
    archived_at: null,
    deleted_at: null,
    ...overrides,
  };
}
function weekly(overrides = {}) {
  return {
    id: '019a0000-0000-7000-8000-000000000112',
    updated_at: '2026-11-20T10:00:00.000000+00:00',
    label: 'Entrenamiento',
    category: null,
    protection_mode: 'flexible',
    pattern_kind: 'weekly',
    time_zone: 'UTC',
    start_date: '2026-11-23',
    end_date_exclusive: null,
    weekdays: [1, 3, 5],
    start_time_local: '22:00:00',
    end_time_local: '06:30:00',
    ends_next_day: true,
    archived_at: null,
    deleted_at: null,
    ...overrides,
  };
}

test('uses half-open ranges: touching protected and Event boundaries are not a conflict', () => {
  const result = findProtectedTimeConflicts({
    event: event('2026-11-23T11:00:00.000Z', '2026-11-23T12:00:00.000Z'),
    protectedBlocks: [oneOff()],
    calendarTimeZone: 'UTC',
    resolveRange: utcResolver,
  });
  assert.equal(result.conflicts.length, 0);
});

test('finds one-off hard overlap and returns the exact overlap and version snapshot', () => {
  const block = oneOff();
  const result = findProtectedTimeConflicts({
    event: event('2026-11-23T10:30:00.000Z', '2026-11-23T11:30:00.000Z'),
    protectedBlocks: [block],
    calendarTimeZone: 'UTC',
    resolveRange: utcResolver,
  });
  assert.equal(result.conflicts.length, 1);
  assert.equal(result.conflicts[0].requiredDecision, 'override_hard');
  assert.equal(result.conflicts[0].overlapStartsAt, '2026-11-23T10:30:00.000Z');
  assert.equal(result.conflicts[0].overlapEndsAt, '2026-11-23T11:00:00.000Z');
  assert.deepEqual(result.snapshot, [{ id: block.id, updated_at: block.updated_at }]);
});

test('expands weekly rules by ISO weekday and handles an overnight occurrence starting the previous day', () => {
  const result = findProtectedTimeConflicts({
    event: event('2026-11-24T05:45:00.000Z', '2026-11-24T07:00:00.000Z'),
    protectedBlocks: [weekly()],
    calendarTimeZone: 'UTC',
    resolveRange: utcResolver,
  });
  assert.equal(result.conflicts.length, 1);
  assert.equal(result.conflicts[0].occurrenceDate, '2026-11-23');
  assert.equal(result.conflicts[0].occurrenceStartsAt, '2026-11-23T22:00:00.000Z');
  assert.equal(result.conflicts[0].requiredDecision, 'keep_flexible');
});

test('ignores weekly occurrences outside the inclusive start and exclusive end bounds', () => {
  const result = findProtectedTimeConflicts({
    event: event('2026-11-30T22:15:00.000Z', '2026-11-30T23:00:00.000Z'),
    protectedBlocks: [weekly({ end_date_exclusive: '2026-11-30' })],
    calendarTimeZone: 'UTC',
    resolveRange: utcResolver,
  });
  assert.equal(result.conflicts.length, 0);
});

test('maps an all-day Event through the owner calendar timezone before comparing timed protection', () => {
  const result = findProtectedTimeConflicts({
    event: { temporal_kind: 'all_day', start_date: '2026-11-23', end_date_exclusive: '2026-11-24' },
    protectedBlocks: [oneOff()],
    calendarTimeZone: 'UTC',
    resolveRange: utcResolver,
  });
  assert.equal(result.conflicts.length, 1);
  assert.equal(result.candidate.startsAt, '2026-11-23T00:00:00.000Z');
  assert.equal(result.candidate.endsAt, '2026-11-24T00:00:00.000Z');
});

test('returns one separate user decision per overlapping occurrence', () => {
  const blocks = [
    oneOff({ id: '019a0000-0000-7000-8000-000000000111', protection_mode: 'hard' }),
    oneOff({ id: '019a0000-0000-7000-8000-000000000112', protection_mode: 'flexible' }),
  ];
  const assessed = findProtectedTimeConflicts({
    event: event('2026-11-23T10:15:00.000Z', '2026-11-23T10:45:00.000Z'),
    protectedBlocks: blocks,
    calendarTimeZone: 'UTC',
    resolveRange: utcResolver,
  });
  const choices = assessed.conflicts.map((conflict) => ({
    blockId: conflict.blockId,
    blockUpdatedAt: conflict.blockUpdatedAt,
    occurrenceStartsAt: conflict.occurrenceStartsAt,
    decision: conflict.requiredDecision,
  }));
  const result = normalizeProtectedTimeDecisions(assessed.conflicts, choices, '2026-11-22T19:00:00.000Z');
  assert.equal(result.ok, true);
  assert.equal(result.decisions.length, 2);
  assert.deepEqual(result.decisions.map((item) => item.decision), ['override_hard', 'keep_flexible']);
  assert.equal(result.decisions[0].policyVersion, 'protected-time-decision-v1');
  assert.equal(result.decisions[0].consentedAt, '2026-11-22T19:00:00.000Z');
});

test('missing, stale or wrong-mode decisions never authorize an overlap', () => {
  const block = oneOff();
  const assessed = findProtectedTimeConflicts({
    event: event('2026-11-23T10:15:00.000Z', '2026-11-23T10:45:00.000Z'),
    protectedBlocks: [block],
    calendarTimeZone: 'UTC',
    resolveRange: utcResolver,
  });
  assert.equal(normalizeProtectedTimeDecisions(assessed.conflicts, []).ok, false);
  const conflict = assessed.conflicts[0];
  const base = {
    blockId: conflict.blockId,
    blockUpdatedAt: conflict.blockUpdatedAt,
    occurrenceStartsAt: conflict.occurrenceStartsAt,
  };
  assert.equal(normalizeProtectedTimeDecisions(assessed.conflicts, [{ ...base, blockUpdatedAt: 'stale', decision: 'override_hard' }]).ok, false);
  assert.equal(normalizeProtectedTimeDecisions(assessed.conflicts, [{ ...base, decision: 'keep_flexible' }]).ok, false);
});

test('rejects excessive Event windows and unbounded owner block sets instead of truncating analysis', () => {
  assert.throws(() => findProtectedTimeConflicts({
    event: event('2026-01-01T00:00:00.000Z', '2028-01-01T00:00:00.000Z'),
    protectedBlocks: [],
    calendarTimeZone: 'UTC',
    resolveRange: utcResolver,
  }), /366 days/);
  assert.throws(() => findProtectedTimeConflicts({
    event: event('2026-11-23T10:00:00.000Z', '2026-11-23T11:00:00.000Z'),
    protectedBlocks: Array.from({ length: 501 }, (_, i) => oneOff({ id: String(i) })),
    calendarTimeZone: 'UTC',
    resolveRange: utcResolver,
  }), /500 active/);
});
