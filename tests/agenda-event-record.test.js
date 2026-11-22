import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyAuthoritativeEventResolution,
  createEventDraft,
} from '../src/features/agenda/domain/event.js';
import { buildEventInsertRecord } from '../src/features/agenda/domain/event-record.js';

const EVENT_ID = '0190f47a-7b2c-7abc-8def-0123456789ab';
const OWNER_ID = '0190f47a-7b2c-7abc-8def-0123456789ac';
const NOW = '2026-11-22T13:00:00-05:00';

function allDayDraft() {
  return createEventDraft({
    title: 'Viaje familiar',
    description: 'Fin de semana',
    locationLabel: 'Varadero',
    locationKind: 'physical',
    temporalKind: 'all_day',
    startDate: '2026-12-24',
    endDateExclusive: '2026-12-27',
  });
}

function fixedInstantDraft() {
  return createEventDraft({
    title: 'Webinar',
    temporalKind: 'fixed_instant',
    startsAt: '2026-11-02T09:00:00-05:00',
    endsAt: '2026-11-02T10:30:00-05:00',
    sourceTimeZone: 'America/New_York',
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

function serialize(eventDraft, overrides = {}) {
  return buildEventInsertRecord({
    eventDraft,
    eventId: EVENT_ID,
    ownerProfileId: OWNER_ID,
    now: NOW,
    ...overrides,
  });
}

test('serializes an all-day Event as date-only with an exclusive end', () => {
  const record = serialize(allDayDraft());

  assert.equal(record.temporal_kind, 'all_day');
  assert.equal(record.start_date, '2026-12-24');
  assert.equal(record.end_date_exclusive, '2026-12-27');
  assert.equal(record.starts_at, null);
  assert.equal(record.ends_at, null);
  assert.equal(record.start_local, null);
  assert.equal(record.end_local, null);
  assert.equal(record.time_zone, null);
});

test('serializes fixed instants in canonical UTC without inventing local wall time', () => {
  const record = serialize(fixedInstantDraft());

  assert.equal(record.temporal_kind, 'fixed_instant');
  assert.equal(record.starts_at, '2026-11-02T14:00:00.000Z');
  assert.equal(record.ends_at, '2026-11-02T15:30:00.000Z');
  assert.equal(record.time_zone, 'America/New_York');
  assert.equal(record.start_local, null);
  assert.equal(record.end_local, null);
  assert.equal(record.start_disambiguation, null);
  assert.equal(record.end_gap_strategy, null);
});

test('refuses zoned civil Event drafts before authoritative IANA resolution', () => {
  const draft = createEventDraft({
    title: 'Consulta médica',
    temporalKind: 'zoned_civil',
    timeZone: 'America/New_York',
    startLocalDateTime: '2026-11-01T01:15',
    endLocalDateTime: '2026-11-01T01:45',
    endDisambiguation: 'later',
  });

  assert.throws(() => serialize(draft), /authoritative IANA resolution/);
});

test('serializes zoned civil Events only with matching authoritative resolution metadata', () => {
  const record = serialize(zonedDraft());

  assert.equal(record.temporal_kind, 'zoned_civil');
  assert.equal(record.start_local, '2026-11-01T01:15:00.000');
  assert.equal(record.end_local, '2026-11-01T01:45:00.000');
  assert.equal(record.time_zone, 'America/New_York');
  assert.equal(record.starts_at, '2026-11-01T05:15:00.000Z');
  assert.equal(record.ends_at, '2026-11-01T06:45:00.000Z');
  assert.equal(record.start_disambiguation, 'earlier');
  assert.equal(record.end_disambiguation, 'later');
  assert.equal(record.start_gap_strategy, 'next-valid');
  assert.equal(record.end_gap_strategy, 'next-valid');
});

test('derives owner, creator and updater from the same trusted profile id', () => {
  const record = serialize(allDayDraft());

  assert.equal(record.owner_user_id, OWNER_ID);
  assert.equal(record.created_by_user_id, OWNER_ID);
  assert.equal(record.updated_by_user_id, OWNER_ID);
  assert.equal(record.id, EVENT_ID);
  assert.equal(record.event_status, 'confirmed');
  assert.equal(record.archived_at, null);
  assert.equal(record.deleted_at, null);
  assert.equal(record.purge_after, null);
});

test('normalizes server timestamps and never mutates its Event draft', () => {
  const draft = allDayDraft();
  const before = structuredClone(draft);
  const record = serialize(draft);

  assert.equal(record.created_at, '2026-11-22T18:00:00.000Z');
  assert.equal(record.updated_at, record.created_at);
  assert.deepEqual(draft, before);
  assert.equal(Object.isFrozen(record), true);
});

test('rejects non-UUIDv7 row ids and profile ids', () => {
  assert.throws(() => serialize(allDayDraft(), { eventId: '0190f47a-7b2c-4abc-8def-0123456789ab' }), /eventId.*UUIDv7/);
  assert.throws(() => serialize(allDayDraft(), { ownerProfileId: '0190f47a-7b2c-7abc-7def-0123456789ac' }), /ownerProfileId.*UUIDv7/);
  assert.throws(() => serialize(allDayDraft(), { ownerProfileId: 'not-a-uuid' }), /ownerProfileId.*UUIDv7/);
});

test('rejects absent or ambiguous server timestamps', () => {
  assert.throws(() => serialize(allDayDraft(), { now: undefined }), /now must be an explicit ISO timestamp/);
  assert.throws(() => serialize(allDayDraft(), { now: '2026-11-22T13:00:00' }), /explicit UTC offset or Z/);
  assert.throws(() => serialize(allDayDraft(), { now: 'not-a-dateZ' }), /valid instant/);
});

test('rejects invalid fixed-instant intervals at the persistence boundary', () => {
  const invalid = {
    ...fixedInstantDraft(),
    temporal: {
      ...fixedInstantDraft().temporal,
      endsAt: fixedInstantDraft().temporal.startsAt,
    },
  };

  assert.throws(() => serialize(invalid), /end must be after/);
});

test('requires internally consistent authoritative resolver metadata', () => {
  const draft = zonedDraft();
  const invalid = {
    ...draft,
    temporal: {
      ...draft.temporal,
      resolverMetadata: {
        ...draft.temporal.resolverMetadata,
        rulesSource: 'runtime-intl',
      },
    },
  };

  assert.throws(() => serialize(invalid), /authoritative IANA TZDB resolver/);
});
