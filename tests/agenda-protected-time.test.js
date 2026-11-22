import test from 'node:test';
import assert from 'node:assert/strict';
import { assessProtectedTimeConflict } from '../src/features/agenda/domain/protected-time.js';

const timedCandidate = {
  temporalKind: 'timed',
  startsAt: '2026-11-22T10:30:00Z',
  endsAt: '2026-11-22T11:30:00Z',
};

function timedBlock(protectionMode, startsAt = '2026-11-22T10:00:00Z', endsAt = '2026-11-22T11:00:00Z') {
  return { temporalKind: 'timed', startsAt, endsAt, protectionMode };
}

function allDayBlock(protectionMode, startDate, endDateExclusive) {
  return { temporalKind: 'all_day', startDate, endDateExclusive, protectionMode };
}

test('adjacent timed intervals do not conflict with protected time', () => {
  const assessment = assessProtectedTimeConflict({
    candidate: { temporalKind: 'timed', startsAt: '2026-11-22T11:00:00Z', endsAt: '2026-11-22T12:00:00Z' },
    protectedBlock: timedBlock('hard'),
  });

  assert.equal(assessment.overlapping, false);
  assert.equal(assessment.outcome, 'clear');
  assert.equal(assessment.canProceed, true);
  assert.equal(assessment.blocksAutomaticScheduling, false);
});

test('hard-protected overlap blocks progress until an explicit override', () => {
  const pending = assessProtectedTimeConflict({
    candidate: timedCandidate,
    protectedBlock: timedBlock('hard'),
  });

  assert.equal(pending.overlapping, true);
  assert.equal(pending.outcome, 'override_required');
  assert.equal(pending.requiredAction, 'explicit_override');
  assert.equal(pending.requiresUserDecision, true);
  assert.equal(pending.requiresExplicitOverride, true);
  assert.equal(pending.canProceed, false);
  assert.equal(pending.blocksAutomaticScheduling, true);

  const accepted = assessProtectedTimeConflict({
    candidate: timedCandidate,
    protectedBlock: timedBlock('hard'),
    userAcceptedOverlap: true,
  });

  assert.equal(accepted.outcome, 'overridden');
  assert.equal(accepted.requiredAction, null);
  assert.equal(accepted.userAcceptedOverlap, true);
  assert.equal(accepted.blocksAutomaticScheduling, true);
  assert.equal(accepted.canProceed, true);
});

test('flexible-protected overlap requires an explicit keep-or-reschedule choice', () => {
  const pending = assessProtectedTimeConflict({
    candidate: timedCandidate,
    protectedBlock: timedBlock('flexible'),
  });

  assert.equal(pending.overlapping, true);
  assert.equal(pending.outcome, 'choice_required');
  assert.equal(pending.requiredAction, 'explicit_keep_or_reschedule_choice');
  assert.equal(pending.requiresUserDecision, true);
  assert.equal(pending.requiresExplicitOverride, false);
  assert.equal(pending.requiresFlexibleChoice, true);
  assert.equal(pending.canProceed, false);
  assert.equal(pending.blocksAutomaticScheduling, true);

  const accepted = assessProtectedTimeConflict({
    candidate: timedCandidate,
    protectedBlock: timedBlock('flexible'),
    userAcceptedOverlap: true,
  });

  assert.equal(accepted.outcome, 'kept_by_user_choice');
  assert.equal(accepted.userAcceptedOverlap, true);
  assert.equal(accepted.blocksAutomaticScheduling, true);
  assert.equal(accepted.canProceed, true);
});

test('all-day ranges compare calendar dates using exclusive end dates', () => {
  const adjacent = assessProtectedTimeConflict({
    candidate: { temporalKind: 'all_day', startDate: '2026-11-23', endDateExclusive: '2026-11-24' },
    protectedBlock: allDayBlock('hard', '2026-11-22', '2026-11-23'),
  });

  assert.equal(adjacent.overlapping, false);
  assert.equal(adjacent.temporalKind, 'all_day');

  const overlap = assessProtectedTimeConflict({
    candidate: { temporalKind: 'all_day', startDate: '2026-11-22', endDateExclusive: '2026-11-24' },
    protectedBlock: allDayBlock('flexible', '2026-11-23', '2026-11-25'),
  });

  assert.equal(overlap.overlapping, true);
  assert.equal(overlap.outcome, 'choice_required');
});

test('all-day multi-date ranges detect a shared interior date', () => {
  const assessment = assessProtectedTimeConflict({
    candidate: { temporalKind: 'all_day', startDate: '2026-12-24', endDateExclusive: '2026-12-28' },
    protectedBlock: allDayBlock('hard', '2026-12-25', '2026-12-26'),
  });

  assert.equal(assessment.overlapping, true);
  assert.equal(assessment.outcome, 'override_required');
});

test('timed and all-day ranges fail closed instead of assuming a timezone', () => {
  assert.throws(() => assessProtectedTimeConflict({
    candidate: timedCandidate,
    protectedBlock: allDayBlock('hard', '2026-11-22', '2026-11-23'),
  }), /explicit common calendar basis/);
});

test('invalid protection mode and decision input are rejected', () => {
  assert.throws(() => assessProtectedTimeConflict({
    candidate: timedCandidate,
    protectedBlock: timedBlock('soft'),
  }), /protectionMode/);

  assert.throws(() => assessProtectedTimeConflict({
    candidate: timedCandidate,
    protectedBlock: timedBlock('hard'),
    userAcceptedOverlap: 'yes',
  }), /userAcceptedOverlap/);
});

test('invalid timed and date-only ranges are rejected', () => {
  assert.throws(() => assessProtectedTimeConflict({
    candidate: { temporalKind: 'timed', startsAt: '2026-11-22T11:00:00Z', endsAt: '2026-11-22T11:00:00Z' },
    protectedBlock: timedBlock('hard'),
  }), /end must be after/);

  assert.throws(() => assessProtectedTimeConflict({
    candidate: { temporalKind: 'all_day', startDate: '2026-02-30', endDateExclusive: '2026-03-01' },
    protectedBlock: allDayBlock('hard', '2026-03-01', '2026-03-02'),
  }), /Invalid calendar date/);
});

test('assessment is immutable and does not mutate source ranges', () => {
  const candidate = { ...timedCandidate };
  const protectedBlock = timedBlock('hard');
  const assessment = assessProtectedTimeConflict({ candidate, protectedBlock });

  assert.equal(Object.isFrozen(assessment), true);
  assert.deepEqual(candidate, timedCandidate);
  assert.equal(protectedBlock.startsAt, '2026-11-22T10:00:00Z');
});
