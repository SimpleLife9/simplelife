import test from 'node:test';
import assert from 'node:assert/strict';
import { completeTodayTask, rescheduleTodayTask } from '../src/features/today/services/today-tasks.js';

function mockClient(response) {
  const calls = [];
  const query = {
    update(payload) {
      calls.push({ method: 'update', payload });
      return this;
    },
    eq(column, value) {
      calls.push({ method: 'eq', column, value });
      return this;
    },
    select(columns) {
      calls.push({ method: 'select', columns });
      return this;
    },
    then(resolve, reject) {
      return Promise.resolve(response).then(resolve, reject);
    },
  };
  return {
    calls,
    client: {
      from(table) {
        calls.push({ method: 'from', table });
        return query;
      },
    },
  };
}

test('completeTodayTask updates only the selected task for its owner', async () => {
  const { client, calls } = mockClient({ error: null });

  await completeTodayTask(client, { id: 'task-1' }, 'owner-1');

  assert.equal(calls[0].method, 'from');
  assert.equal(calls[0].table, 'task');
  assert.deepEqual(calls[1], {
    method: 'update',
    payload: {
      status: 'completed',
      completed_at: calls[1].payload.completed_at,
      completion_outcome: 'complete',
    },
  });
  assert.ok(Number.isFinite(Date.parse(calls[1].payload.completed_at)));
  assert.deepEqual(calls.slice(2), [
    { method: 'eq', column: 'id', value: 'task-1' },
    { method: 'eq', column: 'owner_user_id', value: 'owner-1' },
  ]);
});

test('completeTodayTask propagates Supabase errors', async () => {
  const failure = new Error('update denied');
  const { client } = mockClient({ error: failure });
  await assert.rejects(completeTodayTask(client, { id: 'task-1' }, 'owner-1'), (error) => error === failure);
});

test('rescheduleTodayTask changes the due date and verifies the owner-scoped row', async () => {
  const { client, calls } = mockClient({ data: [{ id: 'task-1' }], error: null });

  await rescheduleTodayTask(client, { id: 'task-1' }, 'owner-1', '2026-11-20');

  assert.deepEqual(calls, [
    { method: 'from', table: 'task' },
    { method: 'update', payload: { due_date: '2026-11-20' } },
    { method: 'eq', column: 'id', value: 'task-1' },
    { method: 'eq', column: 'owner_user_id', value: 'owner-1' },
    { method: 'select', columns: 'id' },
  ]);
});

test('rescheduleTodayTask rejects missing rows and backend errors', async () => {
  const { client: emptyClient } = mockClient({ data: [], error: null });
  await assert.rejects(
    rescheduleTodayTask(emptyClient, { id: 'task-1' }, 'owner-1', '2026-11-20'),
    /No se pudo mover la tarea a hoy/
  );

  const failure = new Error('reschedule denied');
  const { client: failedClient } = mockClient({ data: null, error: failure });
  await assert.rejects(
    rescheduleTodayTask(failedClient, { id: 'task-1' }, 'owner-1', '2026-11-20'),
    (error) => error === failure
  );
});
