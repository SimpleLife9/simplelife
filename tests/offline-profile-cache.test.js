import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cacheProfileIdForAuthUser,
  getCachedProfileIdForAuthUser,
} from '../src/lib/offline-profile-cache.js';

const authUserA = '11111111-1111-4111-8111-111111111111';
const authUserB = '22222222-2222-4222-8222-222222222222';
const profileA = 'aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa';
const profileB = 'bbbbbbbb-bbbb-7bbb-8bbb-bbbbbbbbbbbb';

function makeStorage() {
  const values = new Map();
  return {
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, String(value)); },
    values,
  };
}

test('offline profile cache restores only the profile ID bound to the same auth user', () => {
  const storage = makeStorage();
  assert.equal(cacheProfileIdForAuthUser(authUserA, {
    id: profileA,
    auth_user_id: authUserA,
  }, storage), true);

  assert.equal(getCachedProfileIdForAuthUser(authUserA, storage), profileA);
  assert.equal(getCachedProfileIdForAuthUser(authUserB, storage), null);
});

test('offline profile cache refuses a profile owned by a different auth user', () => {
  const storage = makeStorage();
  assert.equal(cacheProfileIdForAuthUser(authUserA, {
    id: profileB,
    auth_user_id: authUserB,
  }, storage), false);
  assert.equal(getCachedProfileIdForAuthUser(authUserA, storage), null);
});

test('offline profile cache rejects malformed IDs and corrupted records', () => {
  const storage = makeStorage();
  assert.equal(cacheProfileIdForAuthUser('not-a-uuid', {
    id: profileA,
    auth_user_id: 'not-a-uuid',
  }, storage), false);
  storage.setItem('simplelife:offline-profile:v1:' + authUserA, '{invalid json');
  assert.equal(getCachedProfileIdForAuthUser(authUserA, storage), null);

  storage.setItem('simplelife:offline-profile:v1:' + authUserA, JSON.stringify({
    version: 1,
    authUserId: authUserA,
    profileId: profileB,
  }));
  assert.equal(getCachedProfileIdForAuthUser(authUserA, storage), profileB);
});

test('offline profile cache handles unavailable browser storage without throwing', () => {
  const brokenStorage = {
    getItem() { throw new Error('storage denied'); },
    setItem() { throw new Error('storage denied'); },
  };
  assert.equal(cacheProfileIdForAuthUser(authUserA, {
    id: profileA,
    auth_user_id: authUserA,
  }, brokenStorage), false);
  assert.equal(getCachedProfileIdForAuthUser(authUserA, brokenStorage), null);
});
