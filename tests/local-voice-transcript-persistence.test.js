import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getLocalVoiceTranscriptSaveError,
  LOCAL_VOICE_TRANSCRIPT_MAX_CHARS,
  persistLocalVoiceTranscript,
} from '../src/features/inbox/domain/local-voice-transcript-persistence.js';

const ownerUserId = '019b7200-0000-7000-8000-000000000061';
const asset = Object.freeze({
  id: '019b7200-0000-7000-8000-000000000063',
  owner_user_id: ownerUserId,
  capture_id: null,
  status: 'uploaded',
  retention_until: '2026-12-02T20:00:00.000Z',
  object_path: ownerUserId + '/019b7200-0000-7000-8000-000000000063/source.webm',
  sha256_hex: 'a'.repeat(64),
});

function createIds() {
  const ids = [
    '019b7200-0000-7000-8000-000000000064',
    '019b7200-0000-7000-8000-000000000065',
  ];
  return () => ids.shift();
}

test('local transcript save validates owner, upload state, retention and reviewed text before RPC', () => {
  const now = Date.parse('2026-11-27T12:00:00.000Z');
  assert.equal(getLocalVoiceTranscriptSaveError({
    asset, ownerUserId, transcriptText: '  Comprar carne y pavo.  ', now,
  }), null);
  assert.match(getLocalVoiceTranscriptSaveError({
    asset, ownerUserId: '019b7200-0000-7000-8000-000000000099',
    transcriptText: 'texto', now,
  }), /no pertenece a la cuenta activa/);
  assert.match(getLocalVoiceTranscriptSaveError({
    asset: { ...asset, status: 'transcribed' }, ownerUserId,
    transcriptText: 'texto', now,
  }), /ya no está pendiente/);
  assert.match(getLocalVoiceTranscriptSaveError({
    asset: { ...asset, capture_id: '019b7200-0000-7000-8000-000000000066' },
    ownerUserId, transcriptText: 'texto', now,
  }), /ya no está pendiente/);
  assert.match(getLocalVoiceTranscriptSaveError({
    asset: { ...asset, retention_until: '2026-11-27T11:59:59.000Z' },
    ownerUserId, transcriptText: 'texto', now,
  }), /retención temporal.*venció/);
  assert.match(getLocalVoiceTranscriptSaveError({
    asset, ownerUserId, transcriptText: '  ', now,
  }), /transcripción está vacía/);
  assert.match(getLocalVoiceTranscriptSaveError({
    asset, ownerUserId, transcriptText: 'x'.repeat(LOCAL_VOICE_TRANSCRIPT_MAX_CHARS + 1), now,
  }), /20 000 caracteres/);
});

test('persists the trimmed reviewed transcript through the owner-scoped RPC without touching Storage', async () => {
  const rpcCalls = [];
  const storageCalls = [];
  const result = await persistLocalVoiceTranscript({
    supabase: {
      rpc: async (name, parameters) => {
        rpcCalls.push({ name, parameters });
        return {
          data: [{
            capture_id: parameters.p_capture_id,
            part_id: parameters.p_part_id,
            replayed: false,
          }],
          error: null,
        };
      },
      storage: { from: () => ({ download: async () => { storageCalls.push('download'); } }) },
    },
    asset,
    ownerUserId,
    transcriptText: '  Comprar carne de cerdo y pavo.  ',
    createId: createIds(),
    now: () => Date.parse('2026-11-27T12:00:00.000Z'),
  });

  assert.deepEqual(rpcCalls, [{
    name: 'record_inbox_voice_transcription_local',
    parameters: {
      p_asset_id: asset.id,
      p_capture_id: '019b7200-0000-7000-8000-000000000064',
      p_part_id: '019b7200-0000-7000-8000-000000000065',
      p_transcript_text: 'Comprar carne de cerdo y pavo.',
    },
  }]);
  assert.deepEqual(result, {
    captureId: '019b7200-0000-7000-8000-000000000064',
    partId: '019b7200-0000-7000-8000-000000000065',
    replayed: false,
  });
  assert.deepEqual(storageCalls, []);
  assert.equal(asset.status, 'uploaded');
  assert.equal(asset.capture_id, null);
});

test('idempotent replay returns the existing capture without requiring newly generated IDs to match', async () => {
  const result = await persistLocalVoiceTranscript({
    supabase: {
      rpc: async () => ({
        data: [{
          capture_id: '019b7200-0000-7000-8000-000000000074',
          part_id: '019b7200-0000-7000-8000-000000000075',
          replayed: true,
        }],
        error: null,
      }),
    },
    asset,
    ownerUserId,
    transcriptText: 'Texto reconocido.',
    createId: createIds(),
    now: () => Date.parse('2026-11-27T12:00:00.000Z'),
  });
  assert.deepEqual(result, {
    captureId: '019b7200-0000-7000-8000-000000000074',
    partId: '019b7200-0000-7000-8000-000000000075',
    replayed: true,
  });
});

test('refuses an invalid server receipt and propagates RPC failures', async () => {
  const invalid = {
    rpc: async () => ({ data: [{ capture_id: null, part_id: null, replayed: false }], error: null }),
  };
  await assert.rejects(persistLocalVoiceTranscript({
    supabase: invalid, asset, ownerUserId, transcriptText: 'Texto.',
    createId: createIds(), now: () => Date.parse('2026-11-27T12:00:00.000Z'),
  }), /no confirmó la captura/);

  const failed = {
    rpc: async () => ({ data: null, error: new Error('RPC denied') }),
  };
  await assert.rejects(persistLocalVoiceTranscript({
    supabase: failed, asset, ownerUserId, transcriptText: 'Texto.',
    createId: createIds(), now: () => Date.parse('2026-11-27T12:00:00.000Z'),
  }), /RPC denied/);
});

test('local transcript persistence rejects invalid ownership and expired audio before any RPC', async () => {
  let rpcCalls = 0;
  const supabase = { rpc: async () => { rpcCalls += 1; return { data: [], error: null }; } };
  await assert.rejects(persistLocalVoiceTranscript({
    supabase, asset, ownerUserId: '019b7200-0000-7000-8000-000000000099',
    transcriptText: 'Texto.', now: () => Date.parse('2026-11-27T12:00:00.000Z'),
  }), /no pertenece a la cuenta activa/);
  await assert.rejects(persistLocalVoiceTranscript({
    supabase, asset: { ...asset, retention_until: '2026-11-27T11:59:00.000Z' },
    ownerUserId, transcriptText: 'Texto.', now: () => Date.parse('2026-11-27T12:00:00.000Z'),
  }), /retención temporal.*venció/);
  assert.equal(rpcCalls, 0);
});
