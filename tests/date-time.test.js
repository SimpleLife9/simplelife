import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addDaysToDateKey,
  formatDate,
  formatDuration,
  todayInHavana,
} from '../src/lib/date-time.js';

test('todayInHavana returns a calendar date key', () => {
  assert.match(todayInHavana(), /^\d{4}-\d{2}-\d{2}$/);
});

test('addDaysToDateKey handles month, year and leap-day boundaries', () => {
  assert.equal(addDaysToDateKey('2026-11-20', 1), '2026-11-21');
  assert.equal(addDaysToDateKey('2026-12-31', 1), '2027-01-01');
  assert.equal(addDaysToDateKey('2024-02-28', 1), '2024-02-29');
  assert.equal(addDaysToDateKey('2024-02-29', 1), '2024-03-01');
  assert.equal(addDaysToDateKey('2026-11-20', -1), '2026-11-19');
  assert.equal(addDaysToDateKey('', 1), '');
});

test('formatDuration preserves readable hour and minute output', () => {
  assert.equal(formatDuration(25), '25 min');
  assert.equal(formatDuration(60), '1 h');
  assert.equal(formatDuration(90), '1 h 30 min');
  assert.equal(formatDuration(0), '');
  assert.equal(formatDuration(-10), '');
  assert.equal(formatDuration('invalid'), '');
});

test('formatDate preserves empty-state text and Spanish calendar formatting', () => {
  assert.equal(formatDate(''), 'Sin fecha');
  assert.equal(formatDate(null), 'Sin fecha');
  assert.equal(formatDate('2026-11-20'), '20 nov');
});
