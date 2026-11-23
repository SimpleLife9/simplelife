import assert from 'node:assert/strict';
import test from 'node:test';
import {
  planOccurrenceMaterializationReconciliation,
} from '../src/features/agenda/domain/recurrence-materialization.js';

const TODAY = '2026-11-23';

const timedCandidate = (extra = {}) => ({
  occurrenceKey: 'v1:series:2026-11-23:09:00',
  temporalKind: 'zoned_civil',
  originalLocalDate: TODAY,
  originalLocalTime: '09:00',
  effectiveLocalDate: TODAY,
  effectiveLocalTime: '09:00',
  timeZone: 'America/Havana',
  startsAt: '2026-11-23T13:00:00.000Z',
  endsAt: '2026-11-23T14:00:00.000Z',
  rulesSource: 'iana-tzdb',
  rulesVersion: '2026f',
  resolverVersion: 'agenda-iana-resolver-v1',
  authoritative: true,
  status: 'scheduled',
  ...extra,
});

const existingTimed = (extra = {}) => ({
  ...timedCandidate(),
  updatedAt: '2026-11-01T12:00:00.000Z',
  status: 'scheduled',
  ...extra,
});

test('first materialization inserts unique all-day and authoritatively resolved timed occurrences', () => {
  const allDay = {
    occurrenceKey: 'v1:series:2026-11-24:ALL_DAY',
    originalLocalDate: '2026-11-24',
    temporalKind: 'all_day',
    startDate: '2026-11-24',
    endDateExclusive: '2026-11-25',
  };
  const result = planOccurrenceMaterializationReconciliation({
    candidates: [timedCandidate(), allDay],
    materializationDate: TODAY,
  });
  assert.equal(result.insertCount, 2);
  assert.equal(result.reviewCount, 0);
  assert.equal(result.horizonEndDate, '2027-02-20');
  assert.equal(result.actions[0].action, 'insert');
  assert.equal(result.actions[1].occurrence.startsAt, null);
});

test('re-running the same batch is unchanged and does not duplicate occurrences', () => {
  const candidate = timedCandidate();
  const result = planOccurrenceMaterializationReconciliation({
    candidates: [candidate],
    existingOccurrences: [existingTimed()],
    materializationDate: TODAY,
  });
  assert.equal(result.insertCount, 0);
  assert.equal(result.unchangedCount, 1);
  assert.equal(result.actions[0].action, 'unchanged');
});

test('past historical rows are preserved even when they remain scheduled', () => {
  const existing = existingTimed({
    originalLocalDate: '2026-11-20',
    startsAt: '2026-11-20T13:00:00.000Z',
    endsAt: '2026-11-20T14:00:00.000Z',
  });
  const candidate = timedCandidate({
    originalLocalDate: '2026-11-20',
    startsAt: '2026-11-20T15:00:00.000Z',
    endsAt: '2026-11-20T16:00:00.000Z',
  });
  const result = planOccurrenceMaterializationReconciliation({
    candidates: [candidate],
    existingOccurrences: [existing],
    materializationDate: TODAY,
  });
  assert.equal(result.preserveCount, 1);
  assert.equal(result.actions[0].reason, 'historical');
  assert.equal(result.actions[0].occurrence.startsAt, existing.startsAt);
  assert.throws(() => planOccurrenceMaterializationReconciliation({
    candidates: [candidate],
    materializationDate: TODAY,
  }), /Historical occurrences cannot be newly materialized/);
});

test('completed, cancelled, skipped, superseded and needs_review rows are never overwritten', () => {
  const states = ['completed', 'cancelled', 'skipped', 'superseded', 'needs_review'];
  const existing = states.map((status, index) => existingTimed({
    occurrenceKey: 'key-' + index,
    status,
    startsAt: '2026-11-23T15:00:00.000Z',
    endsAt: '2026-11-23T16:00:00.000Z',
  }));
  const candidates = states.map((_, index) => timedCandidate({
    occurrenceKey: 'key-' + index,
    startsAt: '2026-11-23T13:00:00.000Z',
    endsAt: '2026-11-23T14:00:00.000Z',
  }));
  const result = planOccurrenceMaterializationReconciliation({
    candidates, existingOccurrences: existing, materializationDate: TODAY,
  });
  assert.equal(result.preserveCount, 5);
  assert.equal(result.reviewCount, 0);
  assert.deepEqual(result.actions.map((action) => action.action), Array(5).fill('preserve'));
});

test('occurrence overrides and non-accepted review markers are preserved during regeneration', () => {
  const existing = [
    existingTimed({ occurrenceKey: 'moved', overrideKind: 'moved' }),
    existingTimed({ occurrenceKey: 'modified', hasOverride: true }),
    existingTimed({ occurrenceKey: 'review', reviewState: 'pending' }),
  ];
  const candidates = existing.map((row) => timedCandidate({
    occurrenceKey: row.occurrenceKey,
    startsAt: '2026-11-23T15:00:00.000Z',
    endsAt: '2026-11-23T16:00:00.000Z',
  }));
  const result = planOccurrenceMaterializationReconciliation({
    candidates, existingOccurrences: existing, materializationDate: TODAY,
  });
  assert.equal(result.preserveCount, 3);
  assert.deepEqual(result.actions.map((action) => action.reason), ['override', 'override', 'review']);
});

test('changed materialized future commitments become needs_review without changing confirmed UTC', () => {
  const existing = existingTimed();
  const candidate = timedCandidate({
    startsAt: '2026-11-23T14:00:00.000Z',
    endsAt: '2026-11-23T15:00:00.000Z',
    rulesVersion: '2026g',
  });
  const result = planOccurrenceMaterializationReconciliation({
    candidates: [candidate], existingOccurrences: [existing], materializationDate: TODAY,
  });
  assert.equal(result.reviewCount, 1);
  assert.equal(result.actions[0].action, 'needs_review');
  assert.equal(result.actions[0].expectedUpdatedAt, existing.updatedAt);
  assert.equal(result.actions[0].previous.startsAt, existing.startsAt);
  assert.equal(result.actions[0].proposed.startsAt, candidate.startsAt);
  assert.equal(result.actions[0].occurrence.status, 'needs_review');
  assert.equal(existing.startsAt, '2026-11-23T13:00:00.000Z');
});

test('all-day date changes also become needs_review without inventing UTC instants', () => {
  const previous = {
    occurrenceKey: 'all-day',
    originalLocalDate: TODAY,
    temporalKind: 'all_day',
    startDate: TODAY,
    endDateExclusive: '2026-11-24',
    status: 'scheduled',
  };
  const candidate = {
    ...previous,
    startDate: '2026-11-24',
    originalLocalDate: '2026-11-24',
    endDateExclusive: '2026-11-25',
  };
  const result = planOccurrenceMaterializationReconciliation({
    candidates: [candidate], existingOccurrences: [previous], materializationDate: TODAY,
  });
  assert.equal(result.reviewCount, 1);
  assert.equal(result.actions[0].previous.startsAt, null);
  assert.equal(result.actions[0].proposed.startsAt, null);
});

test('batch rejects non-authoritative intervals, duplicate keys, invalid dates and more than 500 candidates', () => {
  assert.throws(() => planOccurrenceMaterializationReconciliation({
    candidates: [timedCandidate({ authoritative: false })], materializationDate: TODAY,
  }), /authoritatively/);
  assert.throws(() => planOccurrenceMaterializationReconciliation({
    candidates: [timedCandidate(), timedCandidate()], materializationDate: TODAY,
  }), /duplicate occurrenceKey/);
  assert.throws(() => planOccurrenceMaterializationReconciliation({
    candidates: [timedCandidate({ originalLocalDate: '2026-02-30' })], materializationDate: TODAY,
  }), /calendar date/);
  assert.throws(() => planOccurrenceMaterializationReconciliation({
    candidates: Array.from({ length: 501 }, (_, index) => timedCandidate({
      occurrenceKey: 'key-' + index,
    })),
    materializationDate: TODAY,
  }), /cannot exceed 500/);
});

test('candidate rows beyond the 90-day horizon are rejected for a separate next batch', () => {
  assert.throws(() => planOccurrenceMaterializationReconciliation({
    candidates: [timedCandidate({ originalLocalDate: '2027-02-21' })],
    materializationDate: TODAY,
  }), /90-calendar-day materialization horizon/);
});
