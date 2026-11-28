import test from 'node:test';
import assert from 'node:assert/strict';
import { canAppendAudioChunk, MAX_AUDIO_BYTES } from '../src/features/inbox/domain/voice-capture-policy.js';

test('voice capture permits a final chunk that reaches exactly 25 MiB', () => {
  assert.equal(canAppendAudioChunk(MAX_AUDIO_BYTES - 1024, 1024), true);
  assert.equal(canAppendAudioChunk(0, MAX_AUDIO_BYTES), true);
});

test('voice capture rejects the first chunk that would exceed 25 MiB', () => {
  assert.equal(canAppendAudioChunk(MAX_AUDIO_BYTES, 1), false);
  assert.equal(canAppendAudioChunk(MAX_AUDIO_BYTES - 1024, 1025), false);
});

test('voice capture rejects invalid byte counters instead of buffering unbounded data', () => {
  assert.equal(canAppendAudioChunk(-1, 1), false);
  assert.equal(canAppendAudioChunk(Number.NaN, 1), false);
  assert.equal(canAppendAudioChunk(1, 0), false);
  assert.equal(canAppendAudioChunk(1, Number.POSITIVE_INFINITY), false);
  assert.equal(canAppendAudioChunk(Number.MAX_SAFE_INTEGER, 2), false);
});
