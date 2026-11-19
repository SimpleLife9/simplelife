import test from 'node:test';
import assert from 'node:assert/strict';
import { uuidv7 } from '../src/lib/uuidv7.js';

test('uuidv7 has canonical formatting, version 7 and RFC variant', () => {
  const id = uuidv7(1_700_000_000_000, new Uint8Array(16));
  assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/);
});

test('uuidv7 encodes the timestamp in the first 48 bits', () => {
  const id = uuidv7(1_700_000_000_000, new Uint8Array(16));
  const hex = id.replaceAll('-', '');
  assert.equal(BigInt(`0x${hex.slice(0, 12)}`), 1_700_000_000_000n);
});

test('uuidv7 rejects invalid timestamps', () => {
  assert.throws(() => uuidv7(-1, new Uint8Array(16)), RangeError);
  assert.throws(() => uuidv7(Number.MAX_SAFE_INTEGER, new Uint8Array(16)), RangeError);
});
