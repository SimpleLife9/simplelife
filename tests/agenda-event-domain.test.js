import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyAuthoritativeEventResolution,
  buildEventTimeResolutionRequest,
  createEventDraft,
  EVENT_CREATABLE_STATUSES,
  EVENT_STATUSES,
} from '../src/features/agenda/domain/event.js';

function zonedDraft(extra = {}) {
  return createEventDraft({
    title: 'Consulta médica',
    temporalKind: 'zoned_civil',
    timeZone: 'America/New_York',
    startLocalDateTime: '2026-11-01T01:15',
    endLocalDateTime: '2026-11-01T01:45',
    ...extra,
  });
}

function authoritativeRange(extra = {}) {
  return {
    requestedTimeZone: 'America/New_York',
    timeZone: 'America/New_York',
    startsAt: '2026-11-01T05:15:00.000Z',
    endsAt: '2026-11-01T06:45:00.000Z',
    start: {
      requestedLocalDateTime: '2026-11-01T01:15:00.000',
      resolvedLocalDateTime: '2026-11-01T01:15:00.000',
      timeZone: 'America/New_York',
      instant: '2026-11-01T05:15:00.000Z',
      resolution: 'ambiguous-first',
      adjustmentMinutes: 0,
      rulesSource: 'iana-tzdb',
      rulesVersion: '2026f',
      resolverVersion: 'agenda-iana-resolver-v1',
      authoritative: true,
    },
    end: {
      requestedLocalDateTime: '2026-11-01T01:45:00.000',
      resolvedLocalDateTime: '2026-11-01T01:45:00.000',
      timeZone: 'America/New_York',
      instant: '2026-11-01T06:45:00.000Z',
      resolution: 'ambiguous-later',
      adjustmentMinutes: 0,
      rulesSource: 'iana-tzdb',
      rulesVersion: '2026f',
      resolverVersion: 'agenda-iana-resolver-v1',
      authoritative: true,
    },
    rulesSource: 'iana-tzdb',
    rulesVersion: '2026f',
    resolverVersion: 'agenda-iana-resolver-v1',
    authoritative: true,
    ...extra,
  };
}

test('all-day Event keeps an exclusive date range and never creates UTC instants', () => {
  const event = createEventDraft({
    title: 'Viaje familiar',
    temporalKind: 'all_day',
    startDate: '2026-12-24',
    endDateExclusive: '2026-12-27',
  });

  assert.equal(event.eventStatus, 'confirmed');
  assert.equal(event.lifecycleState, 'active');
  assert.deepEqual(event.temporal, {
    kind: 'all_day',
    startDate: '2026-12-24',
    endDateExclusive: '2026-12-27',
    dayCount: 3,
  });
  assert.equal('startsAt' in event.temporal, false);
  assert.equal('endsAt' in event.temporal, false);
  assert.throws(() => buildEventTimeResolutionRequest(event), /Only zoned civil-time Events/);
});

test('all-day Event rejects invalid or non-positive exclusive date ranges', () => {
  assert.throws(() => createEventDraft({
    title: 'Invalid date',
    temporalKind: 'all_day',
    startDate: '2026-02-30',
    endDateExclusive: '2026-03-01',
  }), /Invalid calendar date/);
  assert.throws(() => createEventDraft({
    title: 'Zero days',
    temporalKind: 'all_day',
    startDate: '2026-12-24',
    endDateExclusive: '2026-12-24',
  }), /end date must be after/);
  assert.throws(() => createEventDraft({
    title: 'Artificial UTC',
    temporalKind: 'all_day',
    startDate: '2026-12-24',
    endDateExclusive: '2026-12-25',
    startsAt: '2026-12-24T00:00:00Z',
  }), /cannot include startsAt/);
});

test('zoned civil Event builds one atomic server request with independent DST choices', () => {
  const event = zonedDraft({
    startDisambiguation: 'earlier',
    endDisambiguation: 'later',
  });

  assert.equal(event.temporal.resolutionState, 'needs_authoritative_resolution');
  assert.equal('startsAt' in event.temporal, false);
  assert.deepEqual(buildEventTimeResolutionRequest(event), {
    timeZone: 'America/New_York',
    start: {
      localDateTime: '2026-11-01T01:15:00.000',
      disambiguation: 'earlier',
      gapStrategy: 'next-valid',
    },
    end: {
      localDateTime: '2026-11-01T01:45:00.000',
      disambiguation: 'later',
      gapStrategy: 'next-valid',
    },
  });
});

test('zoned civil Event validates the IANA zone, local values and explicit fold choice', () => {
  assert.throws(() => zonedDraft({ timeZone: 'Invalid/Zone' }), /supported IANA/);
  assert.throws(() => zonedDraft({ startLocalDateTime: '2026-11-01T01:15-04:00' }), /without an offset/);
  assert.throws(() => zonedDraft({ endLocalDateTime: '2026-02-30T01:45' }), /Invalid calendar date/);
  assert.throws(() => zonedDraft({ startDisambiguation: 'reject' }), /earlier or later/);
  assert.throws(() => zonedDraft({ endGapStrategy: 'reject' }), /fixed to next-valid/);
});

test('zoned civil Event promotes only matching authoritative atomic resolution', () => {
  const event = zonedDraft({
    title: ' Consulta médica ',
    description: ' Revisar resultados ',
    locationKind: 'physical',
    locationLabel: 'Clínica Central',
  });
  const resolved = applyAuthoritativeEventResolution(event, authoritativeRange());

  assert.equal(resolved.title, 'Consulta médica');
  assert.equal(resolved.description, 'Revisar resultados');
  assert.equal(resolved.locationKind, 'physical');
  assert.equal(resolved.lifecycleState, 'active');
  assert.equal(resolved.temporal.startsAt, '2026-11-01T05:15:00.000Z');
  assert.equal(resolved.temporal.endsAt, '2026-11-01T06:45:00.000Z');
  assert.equal(resolved.temporal.resolutionState, 'authoritatively_resolved');
  assert.equal(resolved.temporal.resolverMetadata.rulesVersion, '2026f');
  assert.equal(resolved.temporal.resolverMetadata.resolverVersion, 'agenda-iana-resolver-v1');
});

test('zoned civil Event refuses client preview, wrong timezone, stale endpoints and mismatched instants', () => {
  const event = zonedDraft();
  assert.throws(() => applyAuthoritativeEventResolution(event, {
    ...authoritativeRange(),
    authoritative: false,
    rulesSource: 'runtime-intl',
  }), /authoritative IANA/);
  assert.throws(() => applyAuthoritativeEventResolution(event, {
    ...authoritativeRange(),
    requestedTimeZone: 'America/Havana',
  }), /does not match the Event/);
  assert.throws(() => applyAuthoritativeEventResolution(event, {
    ...authoritativeRange(),
    end: {
      ...authoritativeRange().end,
      requestedLocalDateTime: '2026-11-01T02:45:00.000',
    },
  }), /does not match the requested/);
  assert.throws(() => applyAuthoritativeEventResolution(event, {
    ...authoritativeRange(),
    start: {
      ...authoritativeRange().start,
      rulesVersion: '2026g',
    },
  }), /TZDB version/);
  assert.throws(() => applyAuthoritativeEventResolution(event, {
    ...authoritativeRange(),
    end: {
      ...authoritativeRange().end,
      instant: '2026-11-01T06:40:00.000Z',
    },
  }), /instants do not match/);
  assert.throws(() => applyAuthoritativeEventResolution(event, {
    ...authoritativeRange(),
    start: {
      ...authoritativeRange().start,
      resolution: 'ambiguous-later',
    },
  }), /ignored the requested earlier fold choice/);
});

test('fixed-instant Event normalizes explicit offsets and bypasses the IANA wall-time resolver', () => {
  const event = createEventDraft({
    title: 'Webinar',
    temporalKind: 'fixed_instant',
    startsAt: '2026-11-02T09:00:00-05:00',
    endsAt: '2026-11-02T10:30:00-05:00',
    sourceTimeZone: 'America/New_York',
  });

  assert.deepEqual(event.temporal, {
    kind: 'fixed_instant',
    startsAt: '2026-11-02T14:00:00.000Z',
    endsAt: '2026-11-02T15:30:00.000Z',
    sourceTimeZone: 'America/New_York',
  });
  assert.throws(() => buildEventTimeResolutionRequest(event), /Only zoned civil-time Events/);
});

test('fixed-instant Event requires explicit offsets and a positive UTC interval', () => {
  assert.throws(() => createEventDraft({
    title: 'No offset',
    temporalKind: 'fixed_instant',
    startsAt: '2026-11-02T09:00',
    endsAt: '2026-11-02T10:00Z',
  }), /explicit UTC offset/);
  assert.throws(() => createEventDraft({
    title: 'Invalid interval',
    temporalKind: 'fixed_instant',
    startsAt: '2026-11-02T10:00:00Z',
    endsAt: '2026-11-02T10:00:00Z',
  }), /end must be after/);
  assert.throws(() => createEventDraft({
    title: 'Invalid calendar date',
    temporalKind: 'fixed_instant',
    startsAt: '2026-02-30T10:00:00Z',
    endsAt: '2026-03-01T10:00:00Z',
  }), /Invalid calendar date/);
  assert.throws(() => createEventDraft({
    title: 'Invalid source zone',
    temporalKind: 'fixed_instant',
    startsAt: '2026-11-02T09:00:00Z',
    endsAt: '2026-11-02T10:00:00Z',
    sourceTimeZone: 'Unknown/Zone',
  }), /sourceTimeZone/);
});

test('Event direct creation defaults to Confirmed and keeps functional status separate from lifecycle', () => {
  const event = createEventDraft({
    title: 'Gym',
    temporalKind: 'all_day',
    startDate: '2026-11-22',
    endDateExclusive: '2026-11-23',
  });

  assert.deepEqual(EVENT_CREATABLE_STATUSES, ['preparing', 'proposed', 'confirmed']);
  assert.deepEqual(EVENT_STATUSES, ['preparing', 'proposed', 'confirmed', 'cancelled', 'finished']);
  assert.equal(event.eventStatus, 'confirmed');
  assert.equal(event.lifecycleState, 'active');
  assert.throws(() => createEventDraft({
    title: 'Cancelled on creation',
    temporalKind: 'all_day',
    startDate: '2026-11-22',
    endDateExclusive: '2026-11-23',
    eventStatus: 'cancelled',
  }), /creation states/);
  assert.throws(() => createEventDraft({
    title: 'Untrusted fields',
    temporalKind: 'all_day',
    startDate: '2026-11-22',
    endDateExclusive: '2026-11-23',
    ownerUserId: 'some-owner',
  }), /unsupported or server-owned/);
});

test('Event text and location fields are normalized and bounded', () => {
  const event = createEventDraft({
    title: '  Cena  ',
    description: '  Reunión familiar  ',
    locationKind: 'online',
    temporalKind: 'all_day',
    startDate: '2026-12-24',
    endDateExclusive: '2026-12-25',
  });
  assert.equal(event.title, 'Cena');
  assert.equal(event.description, 'Reunión familiar');
  assert.equal(event.locationKind, 'online');
  assert.equal(event.locationLabel, null);
  assert.throws(() => createEventDraft({
    title: ' ',
    temporalKind: 'all_day',
    startDate: '2026-12-24',
    endDateExclusive: '2026-12-25',
  }), /title is required/);
  assert.throws(() => createEventDraft({
    title: 'x'.repeat(201),
    temporalKind: 'all_day',
    startDate: '2026-12-24',
    endDateExclusive: '2026-12-25',
  }), /maximum length/);
  assert.throws(() => createEventDraft({
    title: 'Bad location',
    temporalKind: 'all_day',
    startDate: '2026-12-24',
    endDateExclusive: '2026-12-25',
    locationKind: 'venue',
  }), /locationKind/);
});
