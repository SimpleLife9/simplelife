import assert from 'node:assert/strict';
import test from 'node:test';
import { planRecurrenceEditScope } from '../src/features/agenda/domain/recurrence-edits.js';

const baseRule = Object.freeze({
  version: 1,
  frequency: 'WEEKLY',
  interval: 2,
  startDate: '2026-01-05',
  temporalKind: 'all_day',
  byWeekday: ['MO', 'WE'],
});

test('this occurrence scope applies a tombstone without changing the series rule or stable key', () => {
  const result = planRecurrenceEditScope({
    scope: 'this_occurrence',
    seriesId: 'series-a',
    rule: baseRule,
    selectedDate: '2026-01-19',
    override: { kind: 'cancelled' },
  });
  assert.equal(result.scope, 'this_occurrence');
  assert.equal(result.seriesRuleUnchanged, true);
  assert.equal(result.occurrence.status, 'cancelled');
  assert.equal(result.occurrence.overrideKind, 'cancelled');
  assert.equal(result.occurrence.occurrenceKey, 'v1:series-a:2026-01-19:ALL_DAY');
});

test('this and following splits the active segment while retaining the original interval anchor and selected key', () => {
  const result = planRecurrenceEditScope({
    scope: 'this_and_following',
    seriesId: 'series-a',
    newSeriesId: 'series-b',
    rule: baseRule,
    proposedRule: { ...baseRule, byWeekday: ['MO'] },
    selectedDate: '2026-01-19',
    effectiveFromDate: '2026-01-05',
  });
  assert.equal(result.previousSegment.effectiveThroughDate, '2026-01-18');
  assert.equal(result.previousSegment.rule.startDate, '2026-01-05');
  assert.equal(result.nextSegment.seriesId, 'series-b');
  assert.equal(result.nextSegment.rule.startDate, '2026-01-05');
  assert.equal(result.nextSegment.effectiveFromDate, '2026-01-19');
  assert.equal(result.nextSegment.materializeAfterDate, '2026-01-19');
  assert.equal(result.nextSegment.inheritedOccurrenceKey, 'v1:series-a:2026-01-19:ALL_DAY');
  assert.equal(result.preserveSelectedOccurrenceIdentity, true);
});

test('splitting on the first occurrence does not create an empty historical segment', () => {
  const result = planRecurrenceEditScope({
    scope: 'this_and_following',
    seriesId: 'series-a',
    newSeriesId: 'series-b',
    rule: baseRule,
    selectedDate: '2026-01-05',
  });
  assert.equal(result.previousSegment, null);
  assert.equal(result.nextSegment.effectiveFromDate, '2026-01-05');
  assert.equal(result.selectedOccurrenceKey, 'v1:series-a:2026-01-05:ALL_DAY');
});

test('entire-series scope replaces only the future rule and retains historical boundary', () => {
  const result = planRecurrenceEditScope({
    scope: 'entire_series',
    seriesId: 'series-a',
    rule: baseRule,
    selectedDate: '2026-01-19',
    proposedRule: {
      version: 1,
      frequency: 'DAILY',
      interval: 1,
      startDate: '2026-01-19',
      temporalKind: 'all_day',
    },
  });
  assert.equal(result.preserveHistoryBeforeDate, '2026-01-19');
  assert.equal(result.replaceFutureFromDate, '2026-01-19');
  assert.equal(result.replacementRule.frequency, 'DAILY');
  assert.equal(result.replacementStartsWithOccurrence, true);
  assert.equal(result.selectedOccurrenceKey, 'v1:series-a:2026-01-19:ALL_DAY');
});

test('edit scopes fail closed for non-occurrence dates, missing split IDs and changed split anchors', () => {
  assert.throws(() => planRecurrenceEditScope({
    scope: 'this_occurrence', seriesId: 'series-a', rule: baseRule,
    selectedDate: '2026-01-12', override: { kind: 'cancelled' },
  }), /not an eligible occurrence/);
  assert.throws(() => planRecurrenceEditScope({
    scope: 'this_and_following', seriesId: 'series-a', rule: baseRule,
    selectedDate: '2026-01-19',
  }), /newSeriesId/);
  assert.throws(() => planRecurrenceEditScope({
    scope: 'this_and_following', seriesId: 'series-a', newSeriesId: 'series-b',
    rule: baseRule, selectedDate: '2026-01-19',
    proposedRule: { ...baseRule, startDate: '2026-01-19' },
  }), /preserve the original recurrence anchor/);
});

test('all three edit scopes reject a selected date outside an effective segment', () => {
  assert.throws(() => planRecurrenceEditScope({
    scope: 'this_occurrence', seriesId: 'series-a', rule: baseRule,
    selectedDate: '2026-01-19', effectiveFromDate: '2026-01-21',
    override: { kind: 'cancelled' },
  }), /not an eligible occurrence|cannot precede/);
});
