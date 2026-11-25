import test from 'node:test';
import assert from 'node:assert/strict';
import { getOfflineVaultUserMessage } from '../src/features/inbox/offline/offline-vault-errors.js';

test('wrong offline vault passphrase is shown as a simple Spanish message', () => {
  assert.equal(
    getOfflineVaultUserMessage(new Error('PRIVATE_OFFLINE_PASSPHRASE_INVALID')),
    'Contraseña incorrecta. Inténtalo de nuevo.',
  );
});

test('wrong recovery key is shown without exposing an internal error code', () => {
  assert.equal(
    getOfflineVaultUserMessage(new Error('PRIVATE_OFFLINE_RECOVERY_KEY_INVALID')),
    'Clave de recuperación incorrecta. Comprueba la clave e inténtalo de nuevo.',
  );
});

test('unknown offline vault failures use a safe generic message', () => {
  assert.equal(
    getOfflineVaultUserMessage(new Error('PRIVATE_OFFLINE_STORAGE_INTERNAL')),
    'No se pudo desbloquear la bóveda. Inténtalo de nuevo.',
  );
});
