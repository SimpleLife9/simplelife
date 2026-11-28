import { uuidv7 } from '../../../lib/uuidv7.js';

const DB_NAME = 'simplelife-private-offline-v1';
const DB_VERSION = 1;
const SETTINGS_STORE = 'settings';
const CAPTURES_STORE = 'captures';
const CHECK_TEXT = 'SimpleLife private offline vault v1';
const PBKDF2_ITERATIONS = 310000;
const PASSPHRASE_AAD = 'simplelife-offline-data-key-passphrase-v1';
const RECOVERY_AAD = 'simplelife-offline-data-key-recovery-v1';
const encoder = new TextEncoder();
const decoder = new TextDecoder();

function assert(condition, message) {
  if (!condition) throw new TypeError(message);
}

function toBase64(bytes) {
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function fromBase64(value) {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function toHex(bytes) {
  return [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('');
}

function fromHex(value) {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/i.test(value)) {
    throw new Error('PRIVATE_OFFLINE_RECOVERY_KEY_INVALID');
  }
  const bytes = new Uint8Array(32);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

function makeRequestPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('OFFLINE_STORAGE_REQUEST_FAILED'));
  });
}

/** IndexedDB contains only AES-GCM ciphertext and non-sensitive queue metadata. */
export function createIndexedDbOfflineStorage(indexedDb = globalThis.indexedDB, databaseName = DB_NAME) {
  assert(indexedDb?.open, 'PRIVATE_OFFLINE_STORAGE_UNAVAILABLE');

  let databasePromise;
  const openDatabase = () => {
    if (!databasePromise) {
      databasePromise = new Promise((resolve, reject) => {
        const request = indexedDb.open(databaseName, DB_VERSION);
        request.onupgradeneeded = () => {
          const database = request.result;
          if (!database.objectStoreNames.contains(SETTINGS_STORE)) {
            database.createObjectStore(SETTINGS_STORE, { keyPath: 'id' });
          }
          if (!database.objectStoreNames.contains(CAPTURES_STORE)) {
            database.createObjectStore(CAPTURES_STORE, { keyPath: 'captureId' });
          }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error('OFFLINE_STORAGE_OPEN_FAILED'));
        request.onblocked = () => reject(new Error('OFFLINE_STORAGE_BLOCKED'));
      }).catch((error) => {
        databasePromise = null;
        throw error;
      });
    }
    return databasePromise;
  };

  async function run(storeName, mode, operation) {
    const database = await openDatabase();
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(storeName, mode);
      const request = operation(transaction.objectStore(storeName));
      let result;
      request.onsuccess = () => { result = request.result; };
      request.onerror = () => reject(request.error || new Error('OFFLINE_STORAGE_REQUEST_FAILED'));
      transaction.oncomplete = () => resolve(result);
      transaction.onerror = () => reject(transaction.error || new Error('OFFLINE_STORAGE_TRANSACTION_FAILED'));
      transaction.onabort = () => reject(transaction.error || new Error('OFFLINE_STORAGE_TRANSACTION_ABORTED'));
    });
  }

  return Object.freeze({
    getSettings: () => run(SETTINGS_STORE, 'readonly', (store) => store.get('primary')),
    putSettings: (settings) => run(SETTINGS_STORE, 'readwrite', (store) => store.put({ ...settings, id: 'primary' })),
    putCapture: (capture) => run(CAPTURES_STORE, 'readwrite', (store) => store.put(capture)),
    listCaptures: () => run(CAPTURES_STORE, 'readonly', (store) => store.getAll()),
    deleteCapture: (captureId) => run(CAPTURES_STORE, 'readwrite', (store) => store.delete(captureId)),
  });
}

export function createOfflineCaptureVault({
  storage = createIndexedDbOfflineStorage(),
  cryptoProvider = globalThis.crypto,
  createId = uuidv7,
  now = () => new Date().toISOString(),
} = {}) {
  assert(storage && typeof storage.getSettings === 'function', 'OFFLINE_STORAGE_INVALID');
  assert(cryptoProvider?.subtle && cryptoProvider?.getRandomValues, 'WEB_CRYPTO_UNAVAILABLE');

  let unlockedKey = null;

  async function derivePassphraseKey(passphrase, salt) {
    assert(typeof passphrase === 'string' && passphrase.length >= 14,
      'PASSPHRASE_MUST_HAVE_AT_LEAST_14_CHARACTERS');
    const material = await cryptoProvider.subtle.importKey(
      'raw', encoder.encode(passphrase), 'PBKDF2', false, ['deriveKey'],
    );
    return await cryptoProvider.subtle.deriveKey(
      { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
      material,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt'],
    );
  }

  async function importAesKey(rawKey, usages = ['encrypt', 'decrypt']) {
    return await cryptoProvider.subtle.importKey(
      'raw', rawKey, { name: 'AES-GCM' }, false, usages,
    );
  }

  async function encryptBytes(key, bytes, additionalData) {
    const iv = cryptoProvider.getRandomValues(new Uint8Array(12));
    const ciphertext = await cryptoProvider.subtle.encrypt(
      { name: 'AES-GCM', iv, additionalData: encoder.encode(additionalData) },
      key,
      bytes,
    );
    return { iv: toBase64(iv), ciphertext: toBase64(new Uint8Array(ciphertext)) };
  }

  async function decryptBytes(key, record, additionalData) {
    const plaintext = await cryptoProvider.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: fromBase64(record.iv),
        additionalData: encoder.encode(additionalData),
      },
      key,
      fromBase64(record.ciphertext),
    );
    return new Uint8Array(plaintext);
  }

  async function encryptText(key, text, additionalData) {
    return await encryptBytes(key, encoder.encode(text), additionalData);
  }

  async function decryptText(key, record, additionalData) {
    return decoder.decode(await decryptBytes(key, record, additionalData));
  }

  async function verifyDataKey(key, settings) {
    try {
      const check = await decryptText(key, settings.verifier, 'simplelife-offline-vault-check-v1');
      return check === CHECK_TEXT;
    } catch {
      return false;
    }
  }

  async function getRecords() {
    return await storage.listCaptures();
  }

  async function unwrapWithPassphrase(passphrase, settings) {
    const wrappingKey = await derivePassphraseKey(passphrase, fromBase64(settings.salt));
    const rawDataKey = await decryptBytes(wrappingKey, settings.passphraseWrap, PASSPHRASE_AAD);
    const dataKey = await importAesKey(rawDataKey);
    if (!await verifyDataKey(dataKey, settings)) {
      throw new Error('PRIVATE_OFFLINE_PASSPHRASE_INVALID');
    }
    return { wrappingKey, rawDataKey, dataKey };
  }

  async function unwrapWithRecoveryKey(recoveryKey, settings) {
    const recoveryRaw = fromHex(recoveryKey);
    const recoveryWrappingKey = await importAesKey(recoveryRaw);
    const rawDataKey = await decryptBytes(recoveryWrappingKey, settings.recoveryWrap, RECOVERY_AAD);
    const dataKey = await importAesKey(rawDataKey);
    if (!await verifyDataKey(dataKey, settings)) {
      throw new Error('PRIVATE_OFFLINE_RECOVERY_KEY_INVALID');
    }
    return { recoveryRaw, recoveryWrappingKey, rawDataKey, dataKey };
  }

  async function getStatus() {
    const settings = await storage.getSettings();
    const records = await getRecords();
    return Object.freeze({
      configured: Boolean(settings),
      unlocked: Boolean(unlockedKey),
      queuedCount: records.filter((record) => record.state === 'queued').length,
      recoveryConfigured: Boolean(settings?.recoveryWrap),
    });
  }

  return Object.freeze({
    async getStatus() {
      return await getStatus();
    },

    async create(passphrase) {
      if (await storage.getSettings()) throw new Error('PRIVATE_OFFLINE_VAULT_ALREADY_EXISTS');
      assert(typeof passphrase === 'string' && passphrase.length >= 14,
        'PASSPHRASE_MUST_HAVE_AT_LEAST_14_CHARACTERS');

      const salt = cryptoProvider.getRandomValues(new Uint8Array(16));
      const rawDataKey = cryptoProvider.getRandomValues(new Uint8Array(32));
      const dataKey = await importAesKey(rawDataKey);
      const passphraseKey = await derivePassphraseKey(passphrase, salt);
      const recoveryRaw = cryptoProvider.getRandomValues(new Uint8Array(32));
      const recoveryWrappingKey = await importAesKey(recoveryRaw);

      const settings = {
        id: 'primary',
        version: 2,
        kdf: 'PBKDF2-SHA-256',
        iterations: PBKDF2_ITERATIONS,
        cipher: 'AES-256-GCM',
        salt: toBase64(salt),
        passphraseWrap: await encryptBytes(passphraseKey, rawDataKey, PASSPHRASE_AAD),
        recoveryWrap: await encryptBytes(recoveryWrappingKey, rawDataKey, RECOVERY_AAD),
        verifier: await encryptText(dataKey, CHECK_TEXT, 'simplelife-offline-vault-check-v1'),
        createdAt: now(),
      };
      await storage.putSettings(settings);
      unlockedKey = dataKey;
      const status = await getStatus();
      return Object.freeze({ ...status, recoveryKey: toHex(recoveryRaw) });
    },

    async unlock(passphrase) {
      const settings = await storage.getSettings();
      if (!settings) throw new Error('PRIVATE_OFFLINE_VAULT_NOT_CONFIGURED');
      if (settings.version !== 2 || settings.cipher !== 'AES-256-GCM'
        || settings.kdf !== 'PBKDF2-SHA-256' || settings.iterations !== PBKDF2_ITERATIONS
        || !settings.passphraseWrap || !settings.recoveryWrap) {
        throw new Error('PRIVATE_OFFLINE_VAULT_VERSION_UNSUPPORTED');
      }
      try {
        const { dataKey } = await unwrapWithPassphrase(passphrase, settings);
        unlockedKey = dataKey;
      } catch {
        throw new Error('PRIVATE_OFFLINE_PASSPHRASE_INVALID');
      }
      return await getStatus();
    },

    async recoverWithRecoveryKey(recoveryKey, newPassphrase) {
      const settings = await storage.getSettings();
      if (!settings) throw new Error('PRIVATE_OFFLINE_VAULT_NOT_CONFIGURED');
      if (settings.version !== 2 || !settings.recoveryWrap) {
        throw new Error('PRIVATE_OFFLINE_VAULT_VERSION_UNSUPPORTED');
      }
      assert(typeof newPassphrase === 'string' && newPassphrase.length >= 14,
        'PASSPHRASE_MUST_HAVE_AT_LEAST_14_CHARACTERS');

      let recovered;
      try {
        recovered = await unwrapWithRecoveryKey(recoveryKey, settings);
      } catch {
        throw new Error('PRIVATE_OFFLINE_RECOVERY_KEY_INVALID');
      }
      const newSalt = cryptoProvider.getRandomValues(new Uint8Array(16));
      const newWrappingKey = await derivePassphraseKey(newPassphrase, newSalt);
      const updated = {
        ...settings,
        salt: toBase64(newSalt),
        passphraseWrap: await encryptBytes(newWrappingKey, recovered.rawDataKey, PASSPHRASE_AAD),
        updatedAt: now(),
      };
      await storage.putSettings(updated);
      unlockedKey = recovered.dataKey;
      return await getStatus();
    },

    async rotateRecoveryKey(currentPassphrase) {
      if (!unlockedKey) throw new Error('PRIVATE_OFFLINE_VAULT_LOCKED');
      const settings = await storage.getSettings();
      if (!settings || settings.version !== 2 || !settings.passphraseWrap || !settings.recoveryWrap) {
        throw new Error('PRIVATE_OFFLINE_VAULT_VERSION_UNSUPPORTED');
      }

      let verified;
      try {
        verified = await unwrapWithPassphrase(currentPassphrase, settings);
      } catch {
        throw new Error('PRIVATE_OFFLINE_PASSPHRASE_INVALID');
      }

      const recoveryRaw = cryptoProvider.getRandomValues(new Uint8Array(32));
      try {
        const recoveryWrappingKey = await importAesKey(recoveryRaw);
        const recoveryWrap = await encryptBytes(recoveryWrappingKey, verified.rawDataKey, RECOVERY_AAD);
        await storage.putSettings({
          ...settings,
          recoveryWrap,
          updatedAt: now(),
        });
        unlockedKey = verified.dataKey;
        return Object.freeze({
          ...(await getStatus()),
          recoveryKey: toHex(recoveryRaw),
        });
      } finally {
        recoveryRaw.fill(0);
        verified.rawDataKey.fill(0);
      }
    },

    lock() {
      unlockedKey = null;
    },

    async saveTextCapture({ contentOriginal, captureId = createId(), partId = createId(), capturedAt = now() } = {}) {
      if (!unlockedKey) throw new Error('PRIVATE_OFFLINE_VAULT_LOCKED');
      assert(typeof contentOriginal === 'string' && contentOriginal.trim().length > 0,
        'CAPTURE_CONTENT_REQUIRED');
      assert(typeof captureId === 'string' && typeof partId === 'string',
        'CAPTURE_IDENTIFIERS_REQUIRED');

      const payload = JSON.stringify({
        captureId,
        partId,
        contentOriginal,
        capturedAt,
        inputType: 'text',
      });
      const encrypted = await encryptText(unlockedKey, payload, captureId);
      await storage.putCapture({
        captureId,
        partId,
        iv: encrypted.iv,
        ciphertext: encrypted.ciphertext,
        state: 'queued',
        createdAt: now(),
      });
      return Object.freeze({ captureId, partId, state: 'queued' });
    },

    async listQueuedCaptures() {
      if (!unlockedKey) throw new Error('PRIVATE_OFFLINE_VAULT_LOCKED');
      const records = await getRecords();
      const queued = [];
      for (const record of records.filter((item) => item.state === 'queued')) {
        const plaintext = await decryptText(unlockedKey, record, record.captureId);
        queued.push(Object.freeze(JSON.parse(plaintext)));
      }
      return queued;
    },

    async syncPending(syncCapture) {
      if (!unlockedKey) throw new Error('PRIVATE_OFFLINE_VAULT_LOCKED');
      assert(typeof syncCapture === 'function', 'OFFLINE_SYNC_CALLBACK_REQUIRED');
      const records = (await getRecords()).filter((item) => item.state === 'queued');
      const result = { synced: 0, failed: 0 };
      for (const record of records) {
        try {
          const plaintext = await decryptText(unlockedKey, record, record.captureId);
          const capture = JSON.parse(plaintext);
          const response = await syncCapture(capture);
          if (response !== true && response?.synced !== true) {
            throw new Error('OFFLINE_SYNC_NOT_CONFIRMED');
          }
          // Stable server IDs make retries idempotent after a lost response.
          // Delete local ciphertext only after a success/replay acknowledgement.
          await storage.deleteCapture(record.captureId);
          result.synced += 1;
        } catch {
          result.failed += 1;
        }
      }
      return Object.freeze(result);
    },
  });
}
