import test from 'node:test';
import assert from 'node:assert/strict';
import { isOpenTask } from '../src/features/tasks/domain/task-status.js';

test('pending, in-progress and blocked tasks remain open', () => {
  assert.equal(isOpenTask({ status: 'todo' }), true);
  assert.equal(isOpenTask({ status: 'in_progress' }), true);
  assert.equal(isOpenTask({ status: 'blocked' }), true);
});

test('completed and cancelled tasks are not open', () => {
  assert.equal(isOpenTask({ status: 'completed' }), false);
  assert.equal(isOpenTask({ status: 'cancelled' }), false);
});

test('unrecognized statuses preserve the current open-by-default behavior', () => {
  assert.equal(isOpenTask({ status: 'unknown' }), true);
  assert.equal(isOpenTask({}), true);
});
