import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createAllDayRange,
  formatInstantInTimeZone,
  intervalsOverlap,
  isSupportedTimeZone,
  parseCalendarDate,
  resolveLocalDateTime,
  validateTimedRange,
} from '../src/features/agenda/domain/temporal.js';

test('calendar dates are validated as dates, not instants', () => {
  assert.deepEqual(parseCalendarDate('2024-02-29'), {
    year: 2024, month: 2, day: 29, key: '2024-02-29',
  });
  assert.throws(() => parseCalendarDate('2026-02-29'), /Invalid calendar date/);
  assert.throws(() => parseCalendarDate('2026-13-01'), /Invalid calendar date/);
});

test('IANA zone validation uses the runtime timezone database', () => {
  assert.equal(isSupportedTimeZone('America/Havana'), true);
  assert.equal(isSupportedTimeZone('America/New_York'), true);
  assert.equal(isSupportedTimeZone('Not/A_Real_Zone'), false);
});

test('an exact local time round-trips through America/Havana', () => {
  const resolved = resolveLocalDateTime({
    localDateTime: '2026-11-21T09:15',
    timeZone: 'America/Havana',
  });
  assert.equal(resolved.resolution, 'exact');
  assert.equal(resolved.resolvedLocalDateTime, '2026-11-21T09:15:00.000');
  assert.equal(
    formatInstantInTimeZone(resolved.instant, 'America/Havana'),
    resolved.resolvedLocalDateTime,
  );
  assert.equal(resolved.authoritative, false);
});

test('a nonexistent spring-forward time moves to the first valid local minute', () => {
  const resolved = resolveLocalDateTime({
    localDateTime: '2026-03-08T02:30',
    timeZone: 'America/New_York',
  });
  assert.equal(resolved.resolution, 'gap-adjusted-next-valid');
  assert.equal(resolved.resolvedLocalDateTime, '2026-03-08T03:00:00.000');
  assert.equal(resolved.adjustmentMinutes, 30);
});

test('a repeated fall-back time defaults to its first occurrence', () => {
  const earlier = resolveLocalDateTime({
    localDateTime: '2026-11-01T01:30',
    timeZone: 'America/New_York',
  });
  const later = resolveLocalDateTime({
    localDateTime: '2026-11-01T01:30',
    timeZone: 'America/New_York',
    disambiguation: 'later',
  });
  assert.equal(earlier.resolution, 'ambiguous-first');
  assert.equal(later.resolution, 'ambiguous-later');
  assert.equal(Date.parse(later.instant) - Date.parse(earlier.instant), 60 * 60 * 1000);
  assert.throws(() => resolveLocalDateTime({
    localDateTime: '2026-11-01T01:30',
    timeZone: 'America/New_York',
    disambiguation: 'reject',
  }), /Ambiguous local date-time/);
});

test('a nonexistent local time can be rejected instead of adjusted', () => {
  assert.throws(() => resolveLocalDateTime({
    localDateTime: '2026-03-08T02:30',
    timeZone: 'America/New_York',
    gapStrategy: 'reject',
  }), /Nonexistent local date-time/);
});

test('all-day ranges use an exclusive calendar-date end', () => {
  assert.deepEqual(createAllDayRange('2026-03-08', '2026-03-09'), {
    startDate: '2026-03-08',
    endDateExclusive: '2026-03-09',
    dayCount: 1,
  });
  assert.throws(() => createAllDayRange('2026-03-09', '2026-03-09'), /exclusive/);
});

test('timed intervals may cross midnight but must have a positive duration', () => {
  assert.deepEqual(validateTimedRange('2026-11-21T23:30:00-05:00', '2026-11-22T00:15:00-05:00'), {
    startsAt: '2026-11-22T04:30:00.000Z',
    endsAt: '2026-11-22T05:15:00.000Z',
  });
  assert.throws(() => validateTimedRange('2026-11-22T10:00:00Z', '2026-11-22T10:00:00Z'), /after its start/);
});

test('half-open intervals allow adjacent events and detect actual overlaps', () => {
  assert.equal(intervalsOverlap(
    { startsAt: '2026-11-22T10:00:00Z', endsAt: '2026-11-22T11:00:00Z' },
    { startsAt: '2026-11-22T11:00:00Z', endsAt: '2026-11-22T12:00:00Z' },
  ), false);
  assert.equal(intervalsOverlap(
    { startsAt: '2026-11-22T10:00:00Z', endsAt: '2026-11-22T11:00:00Z' },
    { startsAt: '2026-11-22T10:30:00Z', endsAt: '2026-11-22T11:30:00Z' },
  ), true);
});


test('a 30-minute Lord Howe spring-forward gap moves to the first valid local minute', () => {
  const resolved = resolveLocalDateTime({
    localDateTime: '2026-10-04T02:15',
    timeZone: 'Australia/Lord_Howe',
  });
  assert.equal(resolved.resolution, 'gap-adjusted-next-valid');
  assert.equal(resolved.resolvedLocalDateTime, '2026-10-04T02:30:00.000');
  assert.equal(resolved.adjustmentMinutes, 15);
});

test('a 30-minute Lord Howe fall-back fold exposes both occurrences', () => {
  const earlier = resolveLocalDateTime({
    localDateTime: '2026-04-05T01:45',
    timeZone: 'Australia/Lord_Howe',
  });
  const later = resolveLocalDateTime({
    localDateTime: '2026-04-05T01:45',
    timeZone: 'Australia/Lord_Howe',
    disambiguation: 'later',
  });
  assert.equal(earlier.resolution, 'ambiguous-first');
  assert.equal(later.resolution, 'ambiguous-later');
  assert.equal(Date.parse(later.instant) - Date.parse(earlier.instant), 30 * 60 * 1000);
});

test('a skipped civil date resolves to the next valid local minute', () => {
  const resolved = resolveLocalDateTime({
    localDateTime: '2011-12-30T12:00',
    timeZone: 'Pacific/Apia',
  });
  assert.equal(resolved.resolution, 'gap-adjusted-next-valid');
  assert.equal(resolved.resolvedLocalDateTime, '2011-12-31T00:00:00.000');
  assert.equal(resolved.adjustmentMinutes, 12 * 60);
});
