import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildTaskScheduleMutationIntent,
  buildTaskSchedulePatch,
  buildTaskScheduleResolutionRequest,
  hashTaskScheduleMutationIntent,
  normalizeTaskScheduleIdempotencyKey,
  normalizeTaskScheduleMutation,
} from '../src/features/agenda/domain/task-schedule.js';

const TASK_ID = '019a0000-0000-7000-8000-000000000011';
const SCHEDULE_ID = '019a0000-0000-7000-8000-000000000101';
const KEY = '019a0000-0000-7000-8000-000000000201';
const VERSION = '2026-11-22T18:00:00.123456Z';

function createInput(overrides = {}) {
  return {
    action: 'create',
    taskId: TASK_ID,
    schedule: {
      startLocalDateTime: '2026-11-24T09:00',
      endLocalDateTime: '2026-11-24T10:00',
      timeZone: 'America/Havana',
      startDisambiguation: 'earlier',
      endDisambiguation: 'earlier',
    },
    ...overrides,
  };
}

test('normalizes a timed TaskSchedule without treating task due dates as a booking', () => {
  const mutation = normalizeTaskScheduleMutation(createInput());
  assert.equal(mutation.taskId, TASK_ID);
  assert.equal(mutation.schedule.startLocalDateTime, '2026-11-24T09:00');
  assert.equal(mutation.schedule.timeZone, 'America/Havana');
  assert.equal(mutation.action, 'create');
});

test('rejects offsets, invalid local dates, unsupported timezone and caller-owned identity', () => {
  for (const schedule of [
    { startLocalDateTime: '2026-11-24T09:00Z', endLocalDateTime: '2026-11-24T10:00', timeZone: 'America/Havana' },
    { startLocalDateTime: '2026-02-30T09:00', endLocalDateTime: '2026-02-30T10:00', timeZone: 'America/Havana' },
    { startLocalDateTime: '2026-11-24T09:00', endLocalDateTime: '2026-11-24T10:00', timeZone: 'Mars/Olympus' },
    { startLocalDateTime: '2026-11-24T09:00', endLocalDateTime: '2026-11-24T10:00', timeZone: 'America/Havana', ownerUserId: TASK_ID },
  ]) {
    assert.throws(() => normalizeTaskScheduleMutation(createInput({ schedule })));
  }
  assert.throws(() => normalizeTaskScheduleMutation(createInput({ taskId: 'not-a-uuid' })));
});

test('normalizes status mutation with exact version and no schedule payload', () => {
  const mutation = normalizeTaskScheduleMutation({
    action: 'confirm',
    taskScheduleId: SCHEDULE_ID,
    expectedUpdatedAt: VERSION,
  });
  assert.equal(mutation.taskScheduleId, SCHEDULE_ID);
  assert.equal(mutation.expectedUpdatedAt, VERSION);
  assert.equal(mutation.schedule, null);
  assert.throws(() => normalizeTaskScheduleMutation({
    action: 'confirm', taskScheduleId: SCHEDULE_ID, expectedUpdatedAt: VERSION, schedule: {},
  }));
});

test('builds the resolver request with explicit DST fold and gap policy', () => {
  const mutation = normalizeTaskScheduleMutation(createInput({
    schedule: {
      startLocalDateTime: '2026-11-01T01:30',
      endLocalDateTime: '2026-11-01T01:30',
      timeZone: 'America/New_York',
      startDisambiguation: 'earlier',
      endDisambiguation: 'later',
    },
  }));
  assert.deepEqual(buildTaskScheduleResolutionRequest(mutation), {
    timeZone: 'America/New_York',
    start: { localDateTime: '2026-11-01T01:30', disambiguation: 'earlier', gapStrategy: 'next-valid' },
    end: { localDateTime: '2026-11-01T01:30', disambiguation: 'later', gapStrategy: 'next-valid' },
  });
});

test('builds exact 14-field patch only from matching authoritative IANA resolution', () => {
  const mutation = normalizeTaskScheduleMutation(createInput());
  const request = buildTaskScheduleResolutionRequest(mutation);
  const resolution = {
    authoritative: true,
    rulesSource: 'iana-tzdb',
    requestedTimeZone: 'America/Havana',
    timeZone: 'America/Havana',
    rulesVersion: '2026f',
    resolverVersion: 'agenda-iana-resolver-v1',
    startsAt: '2026-11-24T14:00:00.000Z',
    endsAt: '2026-11-24T15:00:00.000Z',
    start: {
      requestedLocalDateTime: request.start.localDateTime,
      requestedTimeZone: request.timeZone,
      timeZone: 'America/Havana',
      rulesSource: 'iana-tzdb',
      rulesVersion: '2026f',
      resolverVersion: 'agenda-iana-resolver-v1',
      resolution: 'exact',
      instant: '2026-11-24T14:00:00.000Z',
    },
    end: {
      requestedLocalDateTime: request.end.localDateTime,
      requestedTimeZone: request.timeZone,
      timeZone: 'America/Havana',
      rulesSource: 'iana-tzdb',
      rulesVersion: '2026f',
      resolverVersion: 'agenda-iana-resolver-v1',
      resolution: 'exact',
      instant: '2026-11-24T15:00:00.000Z',
    },
  };
  const patch = buildTaskSchedulePatch({
    mutation: { ...mutation, taskId: TASK_ID },
    resolution,
  });
  assert.equal(Object.keys(patch).length, 14);
  assert.equal(patch.task_id, TASK_ID);
  assert.equal(patch.schedule_status, 'proposed');
  assert.equal(patch.starts_at, resolution.startsAt);
  assert.equal(patch.start_local, '2026-11-24T09:00');
  assert.equal(patch.resolver_metadata.authoritative, true);
  assert.equal(patch.conflict_decisions.length, 0);
  assert.throws(() => buildTaskSchedulePatch({
    mutation,
    resolution: { ...resolution, requestedTimeZone: 'Europe/Madrid' },
  }));
});

test('create intent is stable across provisional schedule IDs; edit binds ID and version', async () => {
  const create = normalizeTaskScheduleMutation(createInput());
  const sameCreate = normalizeTaskScheduleMutation(createInput());
  const changedCreate = normalizeTaskScheduleMutation(createInput({
    schedule: { ...createInput().schedule, startLocalDateTime: '2026-11-24T11:00' },
  }));
  const first = await hashTaskScheduleMutationIntent(create);
  const replay = await hashTaskScheduleMutationIntent(sameCreate);
  const changed = await hashTaskScheduleMutationIntent(changedCreate);
  assert.equal(first.payloadHash, replay.payloadHash);
  assert.notEqual(first.payloadHash, changed.payloadHash);
  assert.equal(first.payloadHash.length, 64);

  const edit = normalizeTaskScheduleMutation({
    action: 'edit',
    taskScheduleId: SCHEDULE_ID,
    expectedUpdatedAt: VERSION,
    schedule: createInput().schedule,
  });
  const changedVersion = normalizeTaskScheduleMutation({
    action: 'edit',
    taskScheduleId: SCHEDULE_ID,
    expectedUpdatedAt: '2026-11-22T18:00:00.123457Z',
    schedule: createInput().schedule,
  });
  assert.notEqual(
    buildTaskScheduleMutationIntent(edit).canonicalPayload,
    buildTaskScheduleMutationIntent(changedVersion).canonicalPayload,
  );
});

test('normalizes the UUIDv7 idempotency header', () => {
  assert.equal(normalizeTaskScheduleIdempotencyKey(KEY), KEY);
  assert.throws(() => normalizeTaskScheduleIdempotencyKey('bad-key'));
});

test('only explicit overlap choices and known Protected Time decisions are accepted', () => {
  assert.throws(() => normalizeTaskScheduleMutation(createInput({
    eventDecisions: [{ eventId: SCHEDULE_ID, eventUpdatedAt: VERSION, decision: 'silently_move' }],
  })));
  assert.throws(() => normalizeTaskScheduleMutation(createInput({
    protectedTimeDecisions: [{ blockId: SCHEDULE_ID, blockUpdatedAt: VERSION, occurrenceStartsAt: VERSION, decision: 'ignore' }],
  })));
});

test('TaskSchedule overlap consent is strict, version-bound and part of the idempotency intent', async () => {
  const decision = {
    taskScheduleId: '019a0000-0000-7000-8000-000000000106',
    taskScheduleUpdatedAt: VERSION,
    decision: 'keep_overlap',
  };
  const withoutConsent = normalizeTaskScheduleMutation(createInput());
  const withConsent = normalizeTaskScheduleMutation(createInput({
    taskScheduleDecisions: [decision],
  }));
  assert.equal(withConsent.taskScheduleDecisions.length, 1);
  assert.equal(withConsent.taskScheduleDecisions[0].decision, 'keep_overlap');
  assert.notEqual(
    (await hashTaskScheduleMutationIntent(withoutConsent)).payloadHash,
    (await hashTaskScheduleMutationIntent(withConsent)).payloadHash,
  );
  assert.throws(() => normalizeTaskScheduleMutation(createInput({
    taskScheduleDecisions: [{ ...decision, decision: 'silently_move' }],
  })));
  assert.throws(() => normalizeTaskScheduleMutation(createInput({
    taskScheduleDecisions: [{ ...decision, taskScheduleUpdatedAt: 'not-a-version' }],
  })));
  assert.throws(() => normalizeTaskScheduleMutation(createInput({
    taskScheduleDecisions: [decision, decision],
  })));
});
