import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addRecurrenceCalendarDays,
  applyOccurrenceOverride,
  expandRecurrenceDates,
  MATERIALIZATION_BATCH_LIMIT,
  MATERIALIZATION_HORIZON_DAYS,
  planRecurrenceMaterializationBatch,
  RECURRENCE_RULE_VERSION,
  validateRecurrenceRule,
} from '../src/features/agenda/domain/recurrence.js';

const timed = (extra = {}) => ({
  version: RECURRENCE_RULE_VERSION,
  frequency: 'DAILY',
  startDate: '2026-01-01',
  temporalKind: 'zoned_civil',
  localTime: '09:00',
  timeZone: 'America/Havana',
  durationMinutes: 60,
  ...extra,
});

const dates = (result) => result.map((item) => item.originalLocalDate);

test('DAILY interval and inclusive COUNT are deterministic', () => {
  const result = expandRecurrenceDates({
    rule: timed({ interval: 2, count: 4 }),
    seriesId: 'series-1',
    rangeStart: '2026-01-01',
    rangeEnd: '2026-01-20',
  });
  assert.deepEqual(dates(result), ['2026-01-01', '2026-01-03', '2026-01-05', '2026-01-07']);
  assert.deepEqual(result.map((item) => item.sequence), [1, 2, 3, 4]);
});

test('WEEKLY intervals use Monday-based weeks and explicit weekday sets', () => {
  const result = expandRecurrenceDates({
    rule: timed({
      frequency: 'WEEKLY',
      startDate: '2026-01-07',
      interval: 2,
      byWeekday: ['MO', 'FR'],
    }),
    seriesId: 'weekly',
    rangeStart: '2026-01-01',
    rangeEnd: '2026-01-31',
  });
  assert.deepEqual(dates(result), ['2026-01-09', '2026-01-19', '2026-01-23']);
});

test('MONTHLY numeric day skips months where that date does not exist', () => {
  const result = expandRecurrenceDates({
    rule: timed({ frequency: 'MONTHLY', startDate: '2026-01-31', byMonthDay: 31 }),
    seriesId: 'month-end',
    rangeStart: '2026-01-01',
    rangeEnd: '2026-05-31',
  });
  assert.deepEqual(dates(result), ['2026-01-31', '2026-03-31', '2026-05-31']);
});

test('MONTHLY LAST is explicit and selects each calendar month end', () => {
  const result = expandRecurrenceDates({
    rule: timed({ frequency: 'MONTHLY', startDate: '2026-01-01', byMonthDay: 'LAST' }),
    seriesId: 'last-day',
    rangeStart: '2026-01-01',
    rangeEnd: '2026-04-30',
  });
  assert.deepEqual(dates(result), ['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30']);
});

test('MONTHLY ordinal weekday supports positive ordinal and last weekday', () => {
  const secondTuesday = expandRecurrenceDates({
    rule: timed({
      frequency: 'MONTHLY',
      startDate: '2026-01-01',
      byOrdinalWeekday: { ordinal: 2, weekday: 'TU' },
    }),
    seriesId: 'second-tuesday',
    rangeStart: '2026-01-01',
    rangeEnd: '2026-03-31',
  });
  const lastFriday = expandRecurrenceDates({
    rule: timed({
      frequency: 'MONTHLY',
      startDate: '2026-01-01',
      byOrdinalWeekday: { ordinal: -1, weekday: 'FR' },
    }),
    seriesId: 'last-friday',
    rangeStart: '2026-01-01',
    rangeEnd: '2026-02-28',
  });
  assert.deepEqual(dates(secondTuesday), ['2026-01-13', '2026-02-10', '2026-03-10']);
  assert.deepEqual(dates(lastFriday), ['2026-01-30', '2026-02-27']);
});

test('YEARLY includes only the selected month and skips missing leap days', () => {
  const result = expandRecurrenceDates({
    rule: timed({
      frequency: 'YEARLY',
      startDate: '2024-02-29',
      byMonth: 2,
      byMonthDay: 29,
    }),
    seriesId: 'leap-day',
    rangeStart: '2024-01-01',
    rangeEnd: '2032-12-31',
  });
  assert.deepEqual(dates(result), ['2024-02-29', '2028-02-29', '2032-02-29']);
});

test('YEARLY ordinal selector can select the last weekday of a selected month', () => {
  const result = expandRecurrenceDates({
    rule: timed({
      frequency: 'YEARLY',
      startDate: '2026-01-01',
      byMonth: 11,
      byOrdinalWeekday: { ordinal: 4, weekday: 'TH' },
    }),
    seriesId: 'thanksgiving-day',
    rangeStart: '2026-01-01',
    rangeEnd: '2028-12-31',
  });
  assert.deepEqual(dates(result), ['2026-11-26', '2027-11-25', '2028-11-23']);
});

test('UNTIL is inclusive and COUNT cannot be combined with UNTIL', () => {
  const result = expandRecurrenceDates({
    rule: timed({ until: '2026-01-03' }),
    seriesId: 'until-inclusive',
    rangeStart: '2026-01-01',
    rangeEnd: '2026-01-05',
  });
  assert.deepEqual(dates(result), ['2026-01-01', '2026-01-02', '2026-01-03']);
  assert.throws(() => validateRecurrenceRule(timed({ count: 3, until: '2026-01-03' })), /either count or until/);
});

test('EXDATE exclusions do not extend COUNT and retain the original ordinal sequence', () => {
  const result = expandRecurrenceDates({
    rule: timed({ count: 3, excludedDates: ['2026-01-02'] }),
    seriesId: 'excluded',
    rangeStart: '2026-01-01',
    rangeEnd: '2026-01-10',
  });
  assert.deepEqual(dates(result), ['2026-01-01', '2026-01-03']);
  assert.deepEqual(result.map((item) => item.sequence), [1, 3]);
});

test('all-day rules remain date-only and do not fabricate timezone or UTC fields', () => {
  const result = expandRecurrenceDates({
    rule: {
      version: 1,
      frequency: 'DAILY',
      startDate: '2026-02-27',
      temporalKind: 'all_day',
      count: 3,
    },
    seriesId: 'all-day',
    rangeStart: '2026-02-27',
    rangeEnd: '2026-03-02',
  });
  assert.deepEqual(dates(result), ['2026-02-27', '2026-02-28', '2026-03-01']);
  assert.equal('startsAt' in result[0], false);
  assert.equal('timeZone' in result[0], false);
});

test('occurrence identity is based on original civil slot and ignores DST resolution', () => {
  const earlier = expandRecurrenceDates({
    rule: timed({ disambiguation: 'earlier' }),
    seriesId: 'same-series',
    rangeStart: '2026-01-01',
    rangeEnd: '2026-01-01',
  })[0];
  const later = expandRecurrenceDates({
    rule: timed({ disambiguation: 'later' }),
    seriesId: 'same-series',
    rangeStart: '2026-01-01',
    rangeEnd: '2026-01-01',
  })[0];
  assert.equal(earlier.occurrenceKey, later.occurrenceKey);
  assert.match(earlier.occurrenceKey, /^v1:same-series:2026-01-01:09:00:00\.000$/);
});

test('moved and duration-modified occurrences retain their original occurrence key', () => {
  const occurrence = expandRecurrenceDates({
    rule: timed(),
    seriesId: 'override-series',
    rangeStart: '2026-01-01',
    rangeEnd: '2026-01-01',
  })[0];
  const moved = applyOccurrenceOverride(occurrence, {
    occurrenceKey: occurrence.occurrenceKey,
    kind: 'moved',
    actualLocalDate: '2026-01-03',
    actualLocalTime: '10:30',
  });
  const modified = applyOccurrenceOverride(occurrence, {
    occurrenceKey: occurrence.occurrenceKey,
    kind: 'modified',
    durationMinutes: 90,
  });
  assert.equal(moved.originalLocalDate, '2026-01-01');
  assert.equal(moved.actualLocalDate, '2026-01-03');
  assert.equal(moved.occurrenceKey, occurrence.occurrenceKey);
  assert.equal(modified.durationMinutes, 90);
  assert.equal(modified.occurrenceKey, occurrence.occurrenceKey);
  assert.throws(() => applyOccurrenceOverride(occurrence, {
    occurrenceKey: 'stale-key',
    kind: 'moved',
    actualLocalDate: '2026-01-03',
  }), /does not match/);
});

test('materialization planner enforces the approved 90-day horizon and 500-item ceiling', () => {
  const batch = planRecurrenceMaterializationBatch({
    rule: timed(),
    seriesId: 'materialized',
    anchorDate: '2026-01-01',
    batchSize: 500,
  });
  assert.equal(MATERIALIZATION_HORIZON_DAYS, 90);
  assert.equal(MATERIALIZATION_BATCH_LIMIT, 500);
  assert.equal(batch.windowEndInclusive, '2026-03-31');
  assert.equal(batch.occurrences.length, 90);
  assert.equal(batch.hasMore, false);
  assert.equal(batch.nextCursor, null);
  assert.throws(() => planRecurrenceMaterializationBatch({
    rule: timed(),
    seriesId: 'too-large',
    anchorDate: '2026-01-01',
    batchSize: 501,
  }), /batchSize/);
});

test('materialization batches page with an exclusive civil-date cursor', () => {
  const first = planRecurrenceMaterializationBatch({
    rule: timed(),
    seriesId: 'paged',
    anchorDate: '2026-01-01',
    batchSize: 30,
  });
  const second = planRecurrenceMaterializationBatch({
    rule: timed(),
    seriesId: 'paged',
    anchorDate: '2026-01-01',
    afterDate: first.nextCursor,
    batchSize: 30,
  });
  const third = planRecurrenceMaterializationBatch({
    rule: timed(),
    seriesId: 'paged',
    anchorDate: '2026-01-01',
    afterDate: second.nextCursor,
    batchSize: 30,
  });
  assert.equal(first.hasMore, true);
  assert.equal(second.hasMore, true);
  assert.equal(third.hasMore, false);
  const allDates = [...dates(first.occurrences), ...dates(second.occurrences), ...dates(third.occurrences)];
  assert.equal(new Set(allDates).size, 90);
  assert.equal(allDates.length, 90);
});

test('rule validation rejects ambiguous, unsupported and unsafe shapes', () => {
  assert.throws(() => validateRecurrenceRule(timed({ frequency: 'HOURLY' })), /frequency/);
  assert.throws(() => validateRecurrenceRule(timed({ frequency: 'MONTHLY' })), /exactly one/);
  assert.throws(() => validateRecurrenceRule(timed({ frequency: 'YEARLY', byMonth: 2, byMonthDay: 29, byOrdinalWeekday: { ordinal: -1, weekday: 'MO' } })), /exactly one/);
  assert.throws(() => validateRecurrenceRule(timed({ frequency: 'WEEKLY' })), /byWeekday/);
  assert.throws(() => validateRecurrenceRule(timed({ unknown: true })), /unsupported fields/);
  assert.throws(() => validateRecurrenceRule(timed({ timeZone: 'Not/A_Real_Zone' })), /IANA timezone/);
});

test('month and year selectors apply their interval from the series start', () => {
  const monthly = expandRecurrenceDates({
    rule: timed({
      frequency: 'MONTHLY',
      interval: 2,
      startDate: '2026-01-01',
      byMonthDay: 1,
    }),
    seriesId: 'every-other-month',
    rangeStart: '2026-01-01',
    rangeEnd: '2026-08-31',
  });
  const yearly = expandRecurrenceDates({
    rule: timed({
      frequency: 'YEARLY',
      interval: 2,
      startDate: '2026-01-01',
      byMonth: 7,
      byMonthDay: 4,
    }),
    seriesId: 'every-other-year',
    rangeStart: '2026-01-01',
    rangeEnd: '2031-12-31',
  });
  assert.deepEqual(dates(monthly), ['2026-01-01', '2026-03-01', '2026-05-01', '2026-07-01']);
  assert.deepEqual(dates(yearly), ['2026-07-04', '2028-07-04', '2030-07-04']);
});

test('calendar arithmetic is stable across leap days', () => {
  assert.equal(addRecurrenceCalendarDays('2024-02-28', 1), '2024-02-29');
  assert.equal(addRecurrenceCalendarDays('2024-02-29', 1), '2024-03-01');
});
