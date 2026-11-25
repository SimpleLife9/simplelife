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
  const queued = await vault.listQueuedCaptures();
  assert.equal(queued.length, 1);
  assert.equal(queued[0].captureId, saved.captureId);
  assert.equal(queued[0].partId, saved.partId);
  assert.equal(queued[0].contentOriginal, source);
  assert.equal(queued[0].inputType, 'text');
  assert.ok(Number.isFinite(Date.parse(queued[0].capturedAt)));
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

test('offline recovery key restores the data key and rotates a lost passphrase without re-encrypting captures', async () => {
  const storage = createMemoryStorage();
  const vault = createVault(storage);
  const created = await vault.create('first-private-passphrase-2026');
  const recoveryKey = created.recoveryKey;

  assert.match(recoveryKey, /^[0-9a-f]{64}$/);
  assert.equal(JSON.stringify(await storage.getSettings()).includes(recoveryKey), false);

  const saved = await vault.saveTextCapture({
    contentOriginal: 'Recuperar el acceso sin perder esta captura.',
    captureId: '019b7000-0000-7000-8000-000000000301',
    partId: '019b7000-0000-7000-8000-000000000302',
  });
  vault.lock();

  await assert.rejects(
    vault.recoverWithRecoveryKey('0'.repeat(64), 'second-private-passphrase-2026'),
    /RECOVERY_KEY_INVALID/,
  );
  const recovered = await vault.recoverWithRecoveryKey(
    recoveryKey,
    'second-private-passphrase-2026',
  );
  assert.equal(recovered.unlocked, true);
  assert.equal((await vault.listQueuedCaptures())[0].captureId, saved.captureId);

  vault.lock();
  await assert.rejects(vault.unlock('first-private-passphrase-2026'), /PASSPHRASE_INVALID/);
  const unlocked = await vault.unlock('second-private-passphrase-2026');
  assert.equal(unlocked.unlocked, true);
  const [capture] = await vault.listQueuedCaptures();
  assert.equal(capture.contentOriginal, 'Recuperar el acceso sin perder esta captura.');
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


test('offline vault rotates a lost recovery key only after current-passphrase verification and preserves queued ciphertext', async () => {
  const storage = createMemoryStorage();
  const vault = createVault(storage);
  const created = await vault.create('rotation-original-passphrase-2026');
  const oldRecoveryKey = created.recoveryKey;
  const saved = await vault.saveTextCapture({
    contentOriginal: 'Esta captura debe sobrevivir a la renovación de la clave.',
    captureId: '019b7000-0000-7000-8000-000000000401',
    partId: '019b7000-0000-7000-8000-000000000402',
  });
  const before = await storage.getSettings();

  await assert.rejects(
    vault.rotateRecoveryKey('incorrect-rotation-passphrase'),
    /PASSPHRASE_INVALID/,
  );
  const afterRejectedAttempt = await storage.getSettings();
  assert.deepEqual(afterRejectedAttempt.recoveryWrap, before.recoveryWrap);

  const rotated = await vault.rotateRecoveryKey('rotation-original-passphrase-2026');
  const newRecoveryKey = rotated.recoveryKey;
  assert.match(newRecoveryKey, /^[0-9a-f]{64}$/);
  assert.notEqual(newRecoveryKey, oldRecoveryKey);
  const afterRotation = await storage.getSettings();
  assert.deepEqual(afterRotation.passphraseWrap, before.passphraseWrap);
  assert.notDeepEqual(afterRotation.recoveryWrap, before.recoveryWrap);

  const [stillQueued] = await vault.listQueuedCaptures();
  assert.equal(stillQueued.captureId, saved.captureId);
  assert.equal(stillQueued.partId, saved.partId);
  assert.equal(stillQueued.contentOriginal, 'Esta captura debe sobrevivir a la renovación de la clave.');

  vault.lock();
  await vault.unlock('rotation-original-passphrase-2026');
  const [stillAvailableWithOriginalPassphrase] = await vault.listQueuedCaptures();
  assert.equal(stillAvailableWithOriginalPassphrase.captureId, saved.captureId);

  await assert.rejects(
    vault.recoverWithRecoveryKey(oldRecoveryKey, 'new-rotation-passphrase-2026'),
    /RECOVERY_KEY_INVALID/,
  );
  await vault.recoverWithRecoveryKey(newRecoveryKey, 'new-rotation-passphrase-2026');
  const [recovered] = await vault.listQueuedCaptures();
  assert.equal(recovered.captureId, saved.captureId);
  assert.equal(recovered.contentOriginal, 'Esta captura debe sobrevivir a la renovación de la clave.');

  vault.lock();
  await vault.unlock('new-rotation-passphrase-2026');
  const [afterPassphraseUnlock] = await vault.listQueuedCaptures();
  assert.equal(afterPassphraseUnlock.captureId, saved.captureId);
});
