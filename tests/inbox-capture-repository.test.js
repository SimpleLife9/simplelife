import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CapturePartPersistenceError,
  persistTextCapture,
} from '../src/features/inbox/data/capture-repository.js';
import { createSingleSubmissionGate } from '../src/features/inbox/domain/capture-pipeline.js';

const ownerId = '019b0000-0000-7000-8000-000000000001';

function createSupabaseMock({ captureError = null, partError = null } = {}) {
  const calls = [];
  return {
    calls,
    from(table) {
      return {
        async insert(row) {
          calls.push({ table, row });
          return { error: table === 'capture' ? captureError : partError };
        },
      };
    },
  };
}

function createIds() {
  const ids = ['capture-id', 'part-id'];
  return () => ids.shift();
}

test('text capture persistence keeps every original character and owner scope', async () => {
  const supabase = createSupabaseMock();
  const original = '  Comprar café ☕.\nLlamar a Ana.  ';

  const result = await persistTextCapture({
    supabase,
    ownerUserId: ownerId,
    contentOriginal: original,
    createId: createIds(),
  });

  assert.deepEqual(result, { captureId: 'capture-id', partId: 'part-id' });
  assert.deepEqual(supabase.calls, [
    {
      table: 'capture',
      row: {
        id: 'capture-id',
        owner_user_id: ownerId,
        created_by_user_id: ownerId,
        input_type: 'text',
        content_original: original,
      },
    },
    {
      table: 'capture_part',
      row: {
        id: 'part-id',
        capture_id: 'capture-id',
        part_index: 0,
        original_fragment: original,
      },
    },
  ]);
  assert.equal(supabase.calls[0].row.content_original, original);
  assert.equal(supabase.calls[1].row.original_fragment, original);
});

test('capture insert failure stops before creating a part', async () => {
  const supabase = createSupabaseMock({ captureError: new Error('capture insert failed') });

  await assert.rejects(
    persistTextCapture({
      supabase,
      ownerUserId: ownerId,
      contentOriginal: 'source',
      createId: createIds(),
    }),
    /capture insert failed/,
  );
  assert.deepEqual(supabase.calls.map((call) => call.table), ['capture']);
});

test('part insert failure reports the recoverable source capture ID', async () => {
  const supabase = createSupabaseMock({ partError: new Error('part insert failed') });

  await assert.rejects(
    persistTextCapture({
      supabase,
      ownerUserId: ownerId,
      contentOriginal: 'source',
      createId: createIds(),
    }),
    (error) => {
      assert.ok(error instanceof CapturePartPersistenceError);
      assert.equal(error.captureId, 'capture-id');
      assert.match(error.message, /part insert failed/);
      return true;
    },
  );
  assert.deepEqual(supabase.calls.map((call) => call.table), ['capture', 'capture_part']);
});

test('capture persistence rejects missing owner identity before writing', async () => {
  const supabase = createSupabaseMock();

  await assert.rejects(
    persistTextCapture({
      supabase,
      ownerUserId: '',
      contentOriginal: 'source',
      createId: createIds(),
    }),
    /authenticated owner profile/,
  );
  assert.equal(supabase.calls.length, 0);
});

test('single submission gate ignores concurrent duplicate submits and unlocks after completion', async () => {
  const gate = createSingleSubmissionGate();
  let release;
  let calls = 0;
  const firstOperation = new Promise((resolve) => { release = resolve; });

  const first = gate(async () => {
    calls += 1;
    return firstOperation;
  });
  const duplicate = await gate(async () => {
    calls += 1;
    return 'duplicate';
  });

  assert.equal(duplicate, false);
  assert.equal(calls, 1);

  release(true);
  assert.equal(await first, true);
  assert.equal(await gate(async () => {
    calls += 1;
    return 'retry';
  }), 'retry');
  assert.equal(calls, 2);
});

test('single submission gate releases its lock when an operation rejects', async () => {
  const gate = createSingleSubmissionGate();
  await assert.rejects(gate(async () => { throw new Error('network error'); }), /network error/);
  assert.equal(await gate(async () => 'retry'), 'retry');
});
