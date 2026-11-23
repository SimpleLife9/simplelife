import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildRecurrenceEndEndpoints,
  validatePersistableTimedRecurrence,
} from '../src/features/agenda/domain/recurrence-endpoints.js';
import { planOccurrenceResolutionBatches } from '../src/features/agenda/domain/occurrence-resolution.js';

const timedRule = {
  version: 1,
  frequency: 'WEEKLY',
  interval: 1,
  startDate: '2026-10-25',
  temporalKind: 'zoned_civil',
  byWeekday: ['SU'],
  localTime: '01:30',
  timeZone: 'America/New_York',
  durationMinutes: 60,
  disambiguation: 'earlier',
};

const occurrence = (extra = {}) => ({
  occurrenceKey: 'v1:series:2026-10-25:01:30',
  originalLocalDate: '2026-10-25',
  actualLocalDate: '2026-10-25',
  actualLocalTime: '01:30:00.000',
  temporalKind: 'zoned_civil',
  timeZone: 'America/New_York',
  durationMinutes: 60,
  disambiguation: 'earlier',
  gapStrategy: 'next-valid',
  status: 'scheduled',
  ...extra,
});

test('persistable timed recurrence requires an explicit local end clock rather than guessing from duration', () => {
  assert.throws(() => validatePersistableTimedRecurrence(timedRule), /explicit endLocalTime/);
  const normalized = validatePersistableTimedRecurrence({
    ...timedRule,
    endLocalTime: '02:30',
  });
  assert.equal(normalized.endLocalTime, '02:30:00.000');
  assert.equal(normalized.endDayOffset, 0);
  assert.equal(normalized.rule.durationMinutes, 60);
});

test('same-day and overnight end endpoints remain civil-time inputs for the same IANA batch', () => {
  const morning = occurrence();
  const overnight = occurrence({
    occurrenceKey: 'v1:series:2026-10-26:23:00',
    originalLocalDate: '2026-10-26',
    actualLocalDate: '2026-10-26',
    actualLocalTime: '23:00',
  });
  const ends = buildRecurrenceEndEndpoints({
    occurrences: [morning, overnight],
    endLocalTime: '02:30',
    occurrenceEndOverrides: {
      [overnight.occurrenceKey]: { localTime: '01:00', endDayOffset: 1 },
    },
  });
  assert.equal(ends[morning.occurrenceKey].localDateTime, '2026-10-25T02:30:00.000');
  assert.equal(ends[overnight.occurrenceKey].localDateTime, '2026-10-27T01:00:00.000');
});

test('moved occurrences resolve their effective local date/time but preserve the original key', () => {
  const moved = occurrence({
    actualLocalDate: '2026-11-02',
    actualLocalTime: '10:30',
    disambiguation: 'later',
  });
  const ends = buildRecurrenceEndEndpoints({
    occurrences: [moved],
    endLocalTime: '11:15',
  });
  assert.equal(Object.keys(ends)[0], occurrence().occurrenceKey);
  assert.equal(ends[moved.occurrenceKey].localDateTime, '2026-11-02T11:15:00.000');
  assert.equal(ends[moved.occurrenceKey].disambiguation, 'later');
});

test('occurrence-specific end overrides retain stable identity and validate positive local ranges', () => {
  const item = occurrence();
  const ends = buildRecurrenceEndEndpoints({
    occurrences: [item],
    endLocalTime: '02:30',
    occurrenceEndOverrides: {
      [item.occurrenceKey]: {
        localDateTime: '2026-10-25T03:00',
        disambiguation: 'later',
      },
    },
  });
  assert.equal(ends[item.occurrenceKey].localDateTime, '2026-10-25T03:00:00.000');
  assert.equal(ends[item.occurrenceKey].disambiguation, 'later');
  assert.throws(() => buildRecurrenceEndEndpoints({
    occurrences: [item],
    endLocalTime: '02:30',
    occurrenceEndOverrides: {
      [item.occurrenceKey]: { localTime: '01:00', endDayOffset: 0 },
    },
  }), /must end after its effective local start/);
});

test('all-day recurrence stays date-only and cannot receive a timed end override', () => {
  const allDay = {
    occurrenceKey: 'v1:series:2026-10-25:ALL_DAY',
    originalLocalDate: '2026-10-25',
    actualLocalDate: '2026-10-25',
    temporalKind: 'all_day',
  };
  assert.deepEqual(buildRecurrenceEndEndpoints({ occurrences: [allDay] }), {});
  assert.throws(() => buildRecurrenceEndEndpoints({
    occurrences: [allDay],
    occurrenceEndOverrides: { [allDay.occurrenceKey]: { localTime: '10:00' } },
  }), /All-day recurrence cannot/);
});

test('end planner rejects invalid dates/times, unknown overrides and terminal occurrences', () => {
  assert.throws(() => buildRecurrenceEndEndpoints({
    occurrences: [occurrence()], endLocalTime: '25:00',
  }), /outside the local clock range/);
  assert.throws(() => buildRecurrenceEndEndpoints({
    occurrences: [occurrence()], endLocalTime: '01:00',
  }), /must end after its effective local start/);
  assert.throws(() => buildRecurrenceEndEndpoints({
    occurrences: [occurrence()], endLocalTime: '02:30', endDayOffset: 31,
  }), /from 0 to 30/);
  assert.throws(() => buildRecurrenceEndEndpoints({
    occurrences: [occurrence({ status: 'completed' })], endLocalTime: '02:30',
  }), /Only scheduled future occurrences/);
  assert.throws(() => buildRecurrenceEndEndpoints({
    occurrences: [occurrence()], endLocalTime: '02:30',
    occurrenceEndOverrides: { unused: { localTime: '10:00' } },
  }), /unknown occurrenceKey/);
});

test('explicit recurrence ends plug into the atomic resolver adapter without duration inference', () => {
  const item = occurrence({ actualLocalDate: '2026-11-02', actualLocalTime: '09:00' });
  const ends = buildRecurrenceEndEndpoints({
    occurrences: [item],
    endLocalTime: '10:15',
  });
  const plan = planOccurrenceResolutionBatches({
    occurrences: [item],
    endByOccurrenceKey: ends,
  });
  assert.equal(plan.timedOccurrenceCount, 1);
  assert.equal(plan.batches[0].occurrenceKeys[0], item.occurrenceKey);
  assert.equal(plan.batches[0].payload.ranges[0].start.localDateTime, '2026-11-02T09:00:00.000');
  assert.equal(plan.batches[0].payload.ranges[0].end.localDateTime, '2026-11-02T10:15:00.000');
  assert.equal(plan.batches[0].payload.ranges[0].timeZone, 'America/New_York');
});

test('two different local clock choices stay distinct even when the elapsed UTC durations differ at DST', () => {
  const item = occurrence();
  const one = buildRecurrenceEndEndpoints({ occurrences: [item], endLocalTime: '02:30' });
  const two = buildRecurrenceEndEndpoints({ occurrences: [item], endLocalTime: '03:00' });
  assert.notEqual(one[item.occurrenceKey].localDateTime, two[item.occurrenceKey].localDateTime);
  assert.equal(one[item.occurrenceKey].localDateTime, '2026-10-25T02:30:00.000');
  assert.equal(two[item.occurrenceKey].localDateTime, '2026-10-25T03:00:00.000');
});
