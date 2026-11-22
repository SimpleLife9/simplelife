import test from 'node:test';
import assert from 'node:assert/strict';
import { applyAuthoritativeEventResolution, createEventDraft } from '../src/features/agenda/domain/event.js';
import {
  buildEventCreateIntent,
  createEventIdempotencyHash,
  createEventIdempotencyKey,
  isEventIdempotencyKey,
  serializeEventCreateIntent,
} from '../src/features/agenda/domain/event-idempotency.js';

function allDayDraft(overrides = {}) {
  return createEventDraft({
    title: '  Viaje familiar  ',
    description: 'Fin de semana',
    locationLabel: 'Varadero',
    locationKind: 'physical',
    temporalKind: 'all_day',
    startDate: '2026-12-24',
    endDateExclusive: '2026-12-27',
    ...overrides,
  });
}

function fixedInstantDraft(overrides = {}) {
  return createEventDraft({
    title: 'Webinar',
    temporalKind: 'fixed_instant',
    startsAt: '2026-11-02T09:00:00-05:00',
    endsAt: '2026-11-02T10:30:00-05:00',
    sourceTimeZone: 'America/New_York',
    ...overrides,
  });
}

function zonedDraft() {
  const draft = createEventDraft({
    title: 'Consulta médica',
    temporalKind: 'zoned_civil',
    timeZone: 'America/New_York',
    startLocalDateTime: '2026-11-01T01:15',
    endLocalDateTime: '2026-11-01T01:45',
    endDisambiguation: 'later',
  });
  return applyAuthoritativeEventResolution(draft, {
    requestedTimeZone: 'America/New_York',
    timeZone: 'America/New_York',
    startsAt: '2026-11-01T05:15:00.000Z',
    endsAt: '2026-11-01T06:45:00.000Z',
    start: {
      requestedLocalDateTime: '2026-11-01T01:15:00.000',
      timeZone: 'America/New_York',
      instant: '2026-11-01T05:15:00.000Z',
      resolution: 'ambiguous-first',
      rulesSource: 'iana-tzdb',
      rulesVersion: '2026f',
      resolverVersion: 'agenda-iana-resolver-v1',
      authoritative: true,
    },
    end: {
      requestedLocalDateTime: '2026-11-01T01:45:00.000',
      timeZone: 'America/New_York',
      instant: '2026-11-01T06:45:00.000Z',
      resolution: 'ambiguous-later',
      rulesSource: 'iana-tzdb',
      rulesVersion: '2026f',
      resolverVersion: 'agenda-iana-resolver-v1',
      authoritative: true,
    },
    rulesSource: 'iana-tzdb',
    rulesVersion: '2026f',
    resolverVersion: 'agenda-iana-resolver-v1',
    authoritative: true,
  });
}

test('validates UUIDv4 request keys separately from Event UUIDv7 IDs', () => {
  assert.equal(isEventIdempotencyKey('019a0000-0000-4000-8000-000000000001'), true);
  assert.equal(isEventIdempotencyKey('019a0000-0000-7000-8000-000000000001'), false);
  assert.equal(isEventIdempotencyKey('not-a-uuid'), false);
  assert.equal(isEventIdempotencyKey('019a0000-0000-4000-7000-000000000001'.replace('4000','7000')), false);
});

test('generates a fresh UUIDv4 key with a cryptographic provider', () => {
  const key = createEventIdempotencyKey({
    randomUUID: () => 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
  });
  assert.equal(key, 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee');
  assert.equal(isEventIdempotencyKey(key), true);
  assert.throws(() => createEventIdempotencyKey({ randomUUID: () => 'not-a-uuid' }), /valid UUIDv4/);
});

test('canonicalizes optional text and whitespace before hashing', async () => {
  const first = allDayDraft();
  const second = allDayDraft({
    title: 'Viaje familiar',
    description: ' Fin de semana ',
    locationLabel: ' Varadero ',
  });
  assert.equal(serializeEventCreateIntent(first), serializeEventCreateIntent(second));
  assert.equal(await createEventIdempotencyHash(first), await createEventIdempotencyHash(second));
});

test('canonical payload preserves all-day date-only intent', () => {
  const intent = buildEventCreateIntent(allDayDraft());
  assert.deepEqual(intent.temporal, {
    kind: 'all_day',
    startDate: '2026-12-24',
    endDateExclusive: '2026-12-27',
  });
  assert.equal(JSON.stringify(intent).includes('startsAt'), false);
  assert.equal(JSON.stringify(intent).includes('timeZone'), false);
});

test('fixed-instant intent hashes canonical UTC instants and source timezone', async () => {
  const normalized = fixedInstantDraft();
  const equivalent = fixedInstantDraft({
    startsAt: '2026-11-02T14:00:00.000Z',
    endsAt: '2026-11-02T15:30:00.000Z',
  });
  assert.equal(await createEventIdempotencyHash(normalized), await createEventIdempotencyHash(equivalent));
  const differentZone = fixedInstantDraft({ sourceTimeZone: 'UTC' });
  assert.notEqual(await createEventIdempotencyHash(normalized), await createEventIdempotencyHash(differentZone));
});

test('zoned-civil hash is stable across IANA resolver/TZDB metadata changes', async () => {
  const resolved = zonedDraft();
  const reResolved = {
    ...resolved,
    temporal: {
      ...resolved.temporal,
      startsAt: '2026-11-01T06:15:00.000Z',
      endsAt: '2026-11-01T07:45:00.000Z',
      resolverMetadata: {
        ...resolved.temporal.resolverMetadata,
        rulesVersion: '2027a',
        resolverVersion: 'agenda-iana-resolver-v2',
      },
    },
  };
  assert.equal(await createEventIdempotencyHash(resolved), await createEventIdempotencyHash(reResolved));
});

test('changes to user-visible Event intent produce a different hash', async () => {
  const base = allDayDraft();
  const baseHash = await createEventIdempotencyHash(base);
  assert.notEqual(baseHash, await createEventIdempotencyHash(allDayDraft({ title: 'Otro viaje' })));
  assert.notEqual(baseHash, await createEventIdempotencyHash(allDayDraft({ startDate: '2026-12-25' })));
  assert.notEqual(baseHash, await createEventIdempotencyHash(allDayDraft({ eventStatus: 'proposed' })));
  assert.match(baseHash, /^[0-9a-f]{64}$/);
});

test('rejects malformed or server-inconsistent Event drafts', () => {
  assert.throws(() => buildEventCreateIntent(null), /normalized Event draft/);
  assert.throws(() => buildEventCreateIntent({ ...allDayDraft(), lifecycleState: 'archived' }), /active lifecycle/);
  assert.throws(() => buildEventCreateIntent({ ...allDayDraft(), temporal: { kind: 'unsupported' } }), /temporal kind is invalid/);
});
