const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STORAGE_KEY_PREFIX = 'simplelife:offline-profile:v1:';

function resolveStorage(storage) {
  if (storage) return storage;
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

/**
 * Cache only the opaque profile ID needed to reopen that user's existing
 * IndexedDB vault. Never store an auth token, passphrase, recovery key or
 * capture content here. The key is scoped to the authenticated Supabase user.
 */
export function cacheProfileIdForAuthUser(authUserId, profile, storage = null) {
  if (!UUID_PATTERN.test(String(authUserId || ''))
    || profile?.auth_user_id !== authUserId
    || !UUID_PATTERN.test(String(profile?.id || ''))) {
    return false;
  }

  const target = resolveStorage(storage);
  if (!target || typeof target.setItem !== 'function') return false;

  try {
    target.setItem(STORAGE_KEY_PREFIX + authUserId.toLowerCase(), JSON.stringify({
      version: 1,
      authUserId,
      profileId: profile.id,
    }));
    return true;
  } catch {
    return false;
  }
}

/** Returns a profile ID only when the cached record is bound to this exact auth user. */
export function getCachedProfileIdForAuthUser(authUserId, storage = null) {
  if (!UUID_PATTERN.test(String(authUserId || ''))) return null;

  const target = resolveStorage(storage);
  if (!target || typeof target.getItem !== 'function') return null;

  try {
    const raw = target.getItem(STORAGE_KEY_PREFIX + authUserId.toLowerCase());
    if (!raw) return null;
    const record = JSON.parse(raw);
    if (record?.version !== 1
      || record.authUserId !== authUserId
      || !UUID_PATTERN.test(String(record.profileId || ''))) {
      return null;
    }
    return record.profileId;
  } catch {
    return null;
  }
}
