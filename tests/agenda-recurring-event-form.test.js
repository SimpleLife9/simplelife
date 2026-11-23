import assert from 'node:assert/strict';
import test from 'node:test';
import { buildRecurringEventCreatePayload } from '../src/features/agenda/domain/recurring-event-form.js';

test('builds a one-day all-day DAILY rule without introducing time or timezone data', () => {
  const result = buildRecurringEventCreatePayload({
    eventDraft: { temporal: { kind: 'all_day', startDate: '2026-11-24', endDateExclusive: '2026-11-25' } },
    frequency: 'DAILY',
    count: 10,
  });
  assert.deepEqual(result, {
    recurrenceRule: {
      version: 1, frequency: 'DAILY', interval: 1, startDate: '2026-11-24',
      temporalKind: 'all_day', count: 10,
    },
    endDayOffset: 0,
    endLocalTime: null,
  });
});

test('all-day multi-day series preserve inclusive UI end as exclusive occurrence end offset', () => {
  const result = buildRecurringEventCreatePayload({
    eventDraft: { temporal: { kind: 'all_day', startDate: '2026-11-24', endDateExclusive: '2026-11-27' } },
    frequency: 'MONTHLY',
  });
  assert.equal(result.endDayOffset, 2);
  assert.equal(result.recurrenceRule.byMonthDay, 24);
  assert.equal(result.recurrenceRule.count, 12);
});

test('weekly series default to the anchor weekday and sort an explicit selected set', () => {
  const eventDraft = { temporal: { kind: 'all_day', startDate: '2026-11-25', endDateExclusive: '2026-11-26' } };
  assert.deepEqual(buildRecurringEventCreatePayload({ eventDraft, frequency: 'WEEKLY' }).recurrenceRule.byWeekday, ['WE']);
  assert.deepEqual(buildRecurringEventCreatePayload({
    eventDraft, frequency: 'WEEKLY', weekdays: ['FR', 'MO', 'WE'],
  }).recurrenceRule.byWeekday, ['MO', 'WE', 'FR']);
});

test('yearly rule uses the anchor month and day', () => {
  const result = buildRecurringEventCreatePayload({
    eventDraft: { temporal: { kind: 'all_day', startDate: '2028-02-29', endDateExclusive: '2028-03-01' } },
    frequency: 'YEARLY',
  });
  assert.equal(result.recurrenceRule.byMonth, 2);
  assert.equal(result.recurrenceRule.byMonthDay, 29);
});

test('timed series carry the explicit end clock and offset, with duration as metadata only', () => {
  const result = buildRecurringEventCreatePayload({
    eventDraft: { temporal: {
      kind: 'zoned_civil',
      startLocalDateTime: '2026-11-24T23:15:00.000',
      endLocalDateTime: '2026-11-25T01:00:00.000',
      timeZone: 'America/Havana',
      startDisambiguation: 'earlier',
      startGapStrategy: 'next-valid',
    } },
    frequency: 'DAILY',
  });
  assert.equal(result.endLocalTime, '01:00:00.000');
  assert.equal(result.endDayOffset, 1);
  assert.equal(result.recurrenceRule.localTime, '23:15:00');
  assert.equal(result.recurrenceRule.durationMinutes, 105);
  assert.equal(result.recurrenceRule.timeZone, 'America/Havana');
  assert.equal(result.recurrenceRule.disambiguation, 'earlier');
});

test('positive sub-minute civil intervals keep positive duration metadata', () => {
  const result = buildRecurringEventCreatePayload({
    eventDraft: { temporal: {
      kind: 'zoned_civil',
      startLocalDateTime: '2026-11-24T10:00:30',
      endLocalDateTime: '2026-11-24T10:00:40',
      timeZone: 'America/Havana',
    } },
    frequency: 'DAILY',
  });
  assert.equal(result.recurrenceRule.durationMinutes, 1);
  assert.equal(result.endLocalTime, '10:00:40.000');
});

test('validates frequency, interval, count, day offsets and duplicate weekday input', () => {
  const eventDraft = { temporal: { kind: 'all_day', startDate: '2026-11-24', endDateExclusive: '2026-11-25' } };
  assert.throws(() => buildRecurringEventCreatePayload({ eventDraft, frequency: 'HOURLY' }), /frequency/);
  assert.throws(() => buildRecurringEventCreatePayload({ eventDraft, frequency: 'DAILY', interval: 0 }), /interval/);
  assert.throws(() => buildRecurringEventCreatePayload({ eventDraft, frequency: 'DAILY', count: 0 }), /count/);
  assert.throws(() => buildRecurringEventCreatePayload({
    eventDraft, frequency: 'WEEKLY', weekdays: ['MO', 'MO'],
  }), /duplicates/);
  assert.throws(() => buildRecurringEventCreatePayload({
    eventDraft: { temporal: { kind: 'all_day', startDate: '2026-11-24', endDateExclusive: '2027-01-01' } },
    frequency: 'DAILY',
  }), /31 calendar days/);
});
