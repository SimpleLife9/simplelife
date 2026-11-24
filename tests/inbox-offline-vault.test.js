import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { createOfflineCaptureVault } from '../src/features/inbox/offline/private-offline-vault.js';

const ids = [
  '019b7000-0000-7000-8000-000000000101',
  '019b7000-0000-7000-8000-000000000102',
  '019b7000-0000-7000-8000-000000000103',
  '019b7000-0000-7000-8000-000000000104',
];
function createMemoryStorage() {
  let settings = null;
  const captures = new Map();
  return {
    captures,
    async getSettings() { return settings; },
    async putSettings(value) { settings = structuredClone(value); },
    async putCapture(value) { captures.set(value.captureId, structuredClone(value)); },
    async listCaptures() { return [...captures.values()].map((value) => structuredClone(value)); },
    async deleteCapture(id) { captures.delete(id); },
  };
}

function createVault(storage, createId = () => ids.shift()) {
  return createOfflineCaptureVault({ storage, cryptoProvider: webcrypto, createId });
}

test('offline vault encrypts the local capture and never stores original text in IndexedDB records', async () => {
  const storage = createMemoryStorage();
  const vault = createVault(storage);
  await vault.create('a-long-private-passphrase-2026');

  const source = 'Comprar café ☕ y llamar a Ana.';
  const saved = await vault.saveTextCapture({ contentOriginal: source });
  const persisted = storage.captures.get(saved.captureId);

  assert.equal(saved.state, 'queued');
  assert.ok(persisted.ciphertext);
  assert.ok(persisted.iv);
  assert.equal(JSON.stringify(persisted).includes(source), false);
  assert.deepEqual(await vault.listQueuedCaptures(), [{
    captureId: ids[0] || '019b7000-0000-7000-8000-000000000103',
    partId: ids[1] || '019b7000-0000-7000-8000-000000000104',
    contentOriginal: source,
    capturedAt: persisted ? (await vault.listQueuedCaptures())[0].capturedAt : null,
    inputType: 'text',
  }]);
});

test('offline vault rejects wrong passphrases and stays locked until the correct one is supplied', async () => {
  const storage = createMemoryStorage();
  const vault = createVault(storage);
  await vault.create('correct-private-passphrase');
  vault.lock();

  await assert.rejects(vault.unlock('incorrect-private-passphrase'), /PASSPHRASE_INVALID/);
  await assert.rejects(
    vault.saveTextCapture({ contentOriginal: 'No debe persistirse' }),
    /VAULT_LOCKED/,
  );
  const status = await vault.unlock('correct-private-passphrase');
  assert.equal(status.unlocked, true);
});

test('offline sync keeps ciphertext after failure and removes it only after an idempotent acknowledgement', async () => {
  const storage = createMemoryStorage();
  const vault = createVault(storage);
  await vault.create('recovery-passphrase-with-entropy');
  const saved = await vault.saveTextCapture({
    contentOriginal: 'Enviar el informe mañana.',
    captureId: '019b7000-0000-7000-8000-000000000201',
    partId: '019b7000-0000-7000-8000-000000000202',
    capturedAt: '2026-11-23T18:30:00.000Z',
  });

  const failed = await vault.syncPending(async () => {
    throw new Error('NETWORK_OFFLINE');
  });
  assert.deepEqual(failed, { synced: 0, failed: 1 });
  assert.ok(storage.captures.has(saved.captureId));

  const replayed = [];
  const success = await vault.syncPending(async (capture) => {
    replayed.push(capture);
    return { synced: true, replayed: true };
  });
  assert.deepEqual(success, { synced: 1, failed: 0 });
  assert.equal(storage.captures.has(saved.captureId), false);
  assert.equal(replayed.length, 1);
  assert.equal(replayed[0].contentOriginal, 'Enviar el informe mañana.');
  assert.equal(replayed[0].captureId, saved.captureId);
  assert.equal(replayed[0].partId, saved.partId);
});

test('offline vault validates input before encrypting', async () => {
  const storage = createMemoryStorage();
  const vault = createVault(storage);
  await vault.create('another-long-recovery-passphrase');

  await assert.rejects(vault.saveTextCapture({ contentOriginal: '   ' }), /CONTENT_REQUIRED/);
  assert.equal(storage.captures.size, 0);
});
