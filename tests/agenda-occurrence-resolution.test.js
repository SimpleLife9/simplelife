import test from 'node:test';
import assert from 'node:assert/strict';
import {
  IANA_RANGE_BATCH_LIMIT,
  joinOccurrenceResolutionBatch,
  planOccurrenceResolutionBatches,
} from '../src/features/agenda/domain/occurrence-resolution.js';

function timedOccurrence(index, extra = {}) {
  const date = new Date(Date.UTC(2026, 9, 1 + index)).toISOString().slice(0, 10);
  return {
    occurrenceKey: `v1:series-${index}:${date}:09:00:00.000`,
    originalLocalDate: date,
    actualLocalDate: date,
    actualLocalTime: '09:00:00.000',
    temporalKind: 'zoned_civil',
    timeZone: 'America/Havana',
    durationMinutes: 60,
    disambiguation: 'earlier',
    gapStrategy: 'next-valid',
    status: 'scheduled',
    ...extra,
  };
}

function resolverResponse(batch) {
  const results = batch.payload.ranges.map((range) => ({
    requestedTimeZone: range.timeZone,
    timeZone: range.timeZone,
    startsAt: '2026-10-30T13:00:00.000Z',
    endsAt: '2026-10-30T14:00:00.000Z',
    start: {
      requestedLocalDateTime: range.start.localDateTime,
      resolvedLocalDateTime: range.start.localDateTime,
      timeZone: range.timeZone,
      instant: '2026-10-30T13:00:00.000Z',
      rulesSource: 'iana-tzdb',
      rulesVersion: '2026f',
      resolverVersion: 'agenda-iana-resolver-v1',
      resolution: 'exact',
    },
    end: {
      requestedLocalDateTime: range.end.localDateTime,
      resolvedLocalDateTime: range.end.localDateTime,
      timeZone: range.timeZone,
      instant: '2026-10-30T14:00:00.000Z',
      rulesSource: 'iana-tzdb',
      rulesVersion: '2026f',
      resolverVersion: 'agenda-iana-resolver-v1',
      resolution: 'exact',
    },
    rulesSource: 'iana-tzdb',
    rulesVersion: '2026f',
    resolverVersion: 'agenda-iana-resolver-v1',
    authoritative: true,
  }));
  return {
    count: results.length,
    results,
    rulesSource: 'iana-tzdb',
    rulesVersion: '2026f',
    resolverVersion: 'agenda-iana-resolver-v1',
    authoritative: true,
  };
}

test('the resolver adapter splits timed occurrences into ordered batches of at most 25', () => {
  const occurrences = Array.from({ length: 53 }, (_, index) => timedOccurrence(index));
  const endByOccurrenceKey = Object.fromEntries(occurrences.map((item) => [
    item.occurrenceKey,
    `${item.actualLocalDate}T10:00`,
  ]));
  const plan = planOccurrenceResolutionBatches({ occurrences, endByOccurrenceKey });

  assert.equal(IANA_RANGE_BATCH_LIMIT, 25);
  assert.equal(plan.totalOccurrences, 53);
  assert.equal(plan.timedOccurrenceCount, 53);
  assert.equal(plan.allDayOccurrenceCount, 0);
  assert.deepEqual(plan.batches.map((batch) => batch.occurrenceKeys.length), [25, 25, 3]);
  assert.deepEqual(
    plan.batches.flatMap((batch) => batch.occurrenceKeys),
    occurrences.map((item) => item.occurrenceKey),
  );
  assert.equal(plan.batches.every((batch) => batch.payload.ranges.length <= 25), true);
});

test('all-day occurrences remain date-only and never enter a resolver batch', () => {
  const allDay = {
    occurrenceKey: 'v1:all-day:2026-10-30:ALL_DAY',
    originalLocalDate: '2026-10-30',
    actualLocalDate: '2026-10-31',
    temporalKind: 'all_day',
    status: 'scheduled',
  };
  const timed = timedOccurrence(0);
  const plan = planOccurrenceResolutionBatches({
    occurrences: [allDay, timed],
    endByOccurrenceKey: { [timed.occurrenceKey]: `${timed.actualLocalDate}T10:00` },
  });

  assert.equal(plan.allDayOccurrences.length, 1);
  assert.deepEqual(plan.allDayOccurrences[0], {
    occurrenceKey: allDay.occurrenceKey,
    originalLocalDate: '2026-10-30',
    actualLocalDate: '2026-10-31',
    temporalKind: 'all_day',
    status: 'scheduled',
  });
  assert.equal(plan.batches.length, 1);
  assert.equal(plan.batches[0].occurrenceKeys.includes(allDay.occurrenceKey), false);
  assert.equal('timeZone' in plan.allDayOccurrences[0], false);
  assert.equal('startsAt' in plan.allDayOccurrences[0], false);
});

test('moved occurrence keeps its original key and resolves its effective local slot', () => {
  const moved = timedOccurrence(0, {
    actualLocalDate: '2026-11-02',
    actualLocalTime: '10:30:00.000',
    disambiguation: 'later',
  });
  const plan = planOccurrenceResolutionBatches({
    occurrences: [moved],
    endByOccurrenceKey: {
      [moved.occurrenceKey]: {
        localDateTime: '2026-11-02T11:15',
        disambiguation: 'earlier',
      },
    },
  });
  const range = plan.batches[0].payload.ranges[0];

  assert.equal(plan.batches[0].occurrenceKeys[0], moved.occurrenceKey);
  assert.equal(range.start.localDateTime, '2026-11-02T10:30:00.000');
  assert.equal(range.start.disambiguation, 'later');
  assert.equal(range.end.localDateTime, '2026-11-02T11:15:00.000');
  assert.equal(range.end.disambiguation, 'earlier');
  assert.equal(range.timeZone, 'America/Havana');
});

test('end local date-time is required explicitly; duration is not silently converted', () => {
  const occurrence = timedOccurrence(0);
  assert.throws(() => planOccurrenceResolutionBatches({
    occurrences: [occurrence],
    endByOccurrenceKey: {},
  }), /Missing explicit end endpoint/);
  assert.throws(() => planOccurrenceResolutionBatches({
    occurrences: [occurrence],
    endByOccurrenceKey: { [occurrence.occurrenceKey]: '2026-10-01T10:00-04:00' },
  }), /without an offset/);
  assert.throws(() => planOccurrenceResolutionBatches({
    occurrences: [occurrence],
    endByOccurrenceKey: { [occurrence.occurrenceKey]: '2026-02-30T10:00' },
  }), /Invalid calendar date/);
});

test('terminal occurrences are not sent through the new time resolver', () => {
  const completed = timedOccurrence(0, { status: 'completed' });
  assert.throws(() => planOccurrenceResolutionBatches({
    occurrences: [completed],
    endByOccurrenceKey: { [completed.occurrenceKey]: '2026-10-01T10:00' },
  }), /Only scheduled future occurrences/);
});

test('planner rejects duplicate keys, unused end endpoints and batch limits above 25', () => {
  const occurrence = timedOccurrence(0);
  const end = { [occurrence.occurrenceKey]: `${occurrence.actualLocalDate}T10:00` };
  assert.throws(() => planOccurrenceResolutionBatches({
    occurrences: [occurrence, occurrence],
    endByOccurrenceKey: end,
  }), /Duplicate occurrenceKey/);
  assert.throws(() => planOccurrenceResolutionBatches({
    occurrences: [],
    endByOccurrenceKey: { unused: '2026-10-30T10:00' },
  }), /unknown or all-day/);
  assert.throws(() => planOccurrenceResolutionBatches({
    occurrences: [occurrence],
    endByOccurrenceKey: end,
    maxRangesPerBatch: 26,
  }), /maxRangesPerBatch/);
});

test('joining attaches authoritative UTC and TZDB metadata to stable occurrence keys', () => {
  const occurrences = [timedOccurrence(0), timedOccurrence(1)];
  const plan = planOccurrenceResolutionBatches({
    occurrences,
    endByOccurrenceKey: Object.fromEntries(occurrences.map((item) => [item.occurrenceKey, `${item.actualLocalDate}T10:00`])),
  });
  const joined = joinOccurrenceResolutionBatch(plan.batches[0], resolverResponse(plan.batches[0]));

  assert.deepEqual(joined.map((item) => item.occurrenceKey), occurrences.map((item) => item.occurrenceKey));
  assert.equal(joined[0].startsAt, '2026-10-30T13:00:00.000Z');
  assert.equal(joined[0].endsAt, '2026-10-30T14:00:00.000Z');
  assert.equal(joined[0].rulesVersion, '2026f');
  assert.equal(joined[0].resolverVersion, 'agenda-iana-resolver-v1');
  assert.equal(joined[0].authoritative, true);
});

test('join rejects reordered, stale, incomplete and non-authoritative results', () => {
  const occurrences = [timedOccurrence(0), timedOccurrence(1)];
  const plan = planOccurrenceResolutionBatches({
    occurrences,
    endByOccurrenceKey: Object.fromEntries(occurrences.map((item) => [item.occurrenceKey, '2026-10-30T10:00'])),
  });
  const response = resolverResponse(plan.batches[0]);
  const reversed = { ...response, results: [...response.results].reverse() };
  assert.throws(() => joinOccurrenceResolutionBatch(plan.batches[0], reversed), /order/);
  assert.throws(() => joinOccurrenceResolutionBatch(plan.batches[0], {
    ...response,
    rulesVersion: '2026g',
  }), /TZDB version/);
  const staleEndpoint = {
    ...response,
    results: response.results.map((item, index) => index === 0
      ? { ...item, end: { ...item.end, rulesVersion: '2026g' } }
      : item),
  };
  assert.throws(() => joinOccurrenceResolutionBatch(plan.batches[0], staleEndpoint), /endpoint TZDB versions/);
  const missingEndpoints = {
    ...response,
    results: response.results.map((item, index) => index === 0
      ? { ...item, start: null }
      : item),
  };
  assert.throws(() => joinOccurrenceResolutionBatch(plan.batches[0], missingEndpoints), /include endpoint resolution/);
  assert.throws(() => joinOccurrenceResolutionBatch(plan.batches[0], {
    ...response,
    count: 1,
  }), /count/);
  assert.throws(() => joinOccurrenceResolutionBatch(plan.batches[0], {
    ...response,
    authoritative: false,
  }), /must be authoritative/);
  assert.throws(() => joinOccurrenceResolutionBatch(plan.batches[0], {
    ...response,
    results: response.results.map((item) => ({ ...item, endsAt: item.startsAt })),
  }), /positive, valid UTC interval/);
});
