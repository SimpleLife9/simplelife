import { handleRequest } from "../supabase/functions/agenda-protected-time-mutate/handler.ts";
import { resolveLocalDateTimeRange } from "../supabase/functions/agenda-time-resolve/resolver.ts";
import type { EventAuthenticatedContext } from "../supabase/functions/_shared/agenda-event-profile.ts";
import {
  buildProtectedTimeBlockPatch,
  buildProtectedTimeResolutionRequest,
  hashProtectedTimeMutationIntent,
  normalizeProtectedTimeBlock,
} from "../src/features/agenda/domain/protected-time.js";

const AUTH_USER_ID = "00000000-0000-4000-8000-000000000021";
const PROFILE_ID = "0190f47a-7b2c-7abc-8def-0123456789ac";
const BLOCK_ID = "019a0000-0000-7000-8000-000000000321";
const KEY = "019a0000-0000-7000-8000-000000000322";
const VERSION = "2026-11-22T18:00:00.123456Z";

function assertEquals(actual: unknown, expected: unknown, label = "values differ"): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(label + ": expected " + JSON.stringify(expected) + ", received " + JSON.stringify(actual));
  }
}
function assert(condition: unknown, label: string): asserts condition {
  if (!condition) throw new Error(label);
}
async function responseBody(response: Response): Promise<Record<string, unknown>> {
  return await response.json() as Record<string, unknown>;
}
function request(payload: Record<string, unknown>, key = KEY, method = "POST"): Request {
  return new Request("https://local.test/agenda-protected-time-mutate", {
    method,
    headers: { "content-type": "application/json", "idempotency-key": key },
    body: method === "POST" ? JSON.stringify(payload) : undefined,
  });
}

function oneOff(overrides: Record<string, unknown> = {}) {
  return {
    label: "Sueño",
    category: "sleep",
    protectionMode: "hard",
    patternKind: "one_off",
    timeZone: "America/Havana",
    startLocalDateTime: "2026-12-24T22:00",
    endLocalDateTime: "2026-12-25T06:30",
    startDisambiguation: "earlier",
    endDisambiguation: "earlier",
    ...overrides,
  };
}
function weekly(overrides: Record<string, unknown> = {}) {
  return {
    label: "Entrenamiento",
    category: "training",
    protectionMode: "flexible",
    patternKind: "weekly",
    timeZone: "America/Havana",
    startDate: "2026-11-23",
    endDateExclusive: null,
    weekdays: [1, 3, 5],
    startLocalTime: "22:00",
    endLocalTime: "06:30",
    endsNextDay: true,
    ...overrides,
  };
}

function mockContext({
  authMode = "user",
  existing = null as Record<string, unknown> | null,
  lookupError = null as unknown,
  rpcResult = [{
    http_status: 201,
    response_body: {
      blockId: BLOCK_ID,
      updatedAt: "2026-11-22T18:10:00.123456Z",
      label: "Sueño",
      protectionMode: "hard",
      patternKind: "one_off",
      lifecycle: "active",
    },
    replayed: false,
  }],
  rpcError = null,
  taskSchedules = [] as Record<string, unknown>[],
  restoreBlock = null as Record<string, unknown> | null,
}: {
  authMode?: string;
  existing?: Record<string, unknown> | null;
  lookupError?: unknown;
  rpcResult?: unknown;
  rpcError?: unknown;
  taskSchedules?: Record<string, unknown>[];
  restoreBlock?: Record<string, unknown> | null;
} = {}) {
  const calls: Record<string, unknown> = {
    profileLookup: 0, ledgerLookup: 0, rpc: 0, rpcName: null, rpcArgs: null,
  };
  const supabase = {
    from(table: string) {
      if (table !== "user_profile") throw new Error("unexpected user client table " + table);
      return {
        select() {
          return {
            eq(_column: string, _value: string) {
              return {
                async maybeSingle() {
                  calls.profileLookup = Number(calls.profileLookup) + 1;
                  return {
                    data: { id: PROFILE_ID, auth_user_id: AUTH_USER_ID, account_status: "active" },
                    error: null,
                  };
                },
              };
            },
          };
        },
      };
    },
  };
  const supabaseAdmin = {
    from(table: string) {
      if (table === "task_schedule") {
        const query: any = {
          select() { return query; },
          eq() { return query; },
          in() { return query; },
          order() { return query; },
          async limit() { return { data: taskSchedules, error: null }; },
        };
        return query;
      }
      if (table === "protected_time_block") {
        const query: any = {
          select() { return query; },
          eq() { return query; },
          async maybeSingle() { return { data: restoreBlock, error: null }; },
        };
        return query;
      }
      if (table !== "protected_time_block_mutation_request") {
        throw new Error("unexpected admin table " + table);
      }
      return {
        select() {
          return {
            eq(_owner: string, _ownerId: string) {
              return {
                eq(_key: string, _keyId: string) {
                  return {
                    async maybeSingle() {
                      calls.ledgerLookup = Number(calls.ledgerLookup) + 1;
                      return { data: existing, error: lookupError };
                    },
                  };
                },
              };
            },
          };
        },
      };
    },
    async rpc(name: string, args: Record<string, unknown>) {
      calls.rpc = Number(calls.rpc) + 1;
      calls.rpcName = name;
      calls.rpcArgs = args;
      return { data: rpcResult, error: rpcError };
    },
  };
  const ctx = {
    authMode,
    userClaims: { id: AUTH_USER_ID },
    supabase,
    supabaseAdmin,
  } as unknown as EventAuthenticatedContext & { supabaseAdmin: typeof supabaseAdmin };
  return { ctx, calls };
}

Deno.test("normalizes one-off hard Protected Time and keeps civil wall times", () => {
  const draft = normalizeProtectedTimeBlock(oneOff());
  assertEquals(draft.patternKind, "one_off", "pattern kind");
  assertEquals(draft.protectionMode, "hard", "protection mode");
  assertEquals(draft.startLocalDateTime, "2026-12-24T22:00", "local start");
  assertEquals(draft.endLocalDateTime, "2026-12-25T06:30", "local end");
});

Deno.test("normalizes weekly overnight rules with ISO weekdays and an exclusive end date", () => {
  const draft = normalizeProtectedTimeBlock(weekly());
  assertEquals(draft.weekdays, [1, 3, 5], "sorted ISO weekdays");
  assertEquals(draft.endsNextDay, true, "overnight flag");
  assertEquals(buildProtectedTimeResolutionRequest(draft).start.localDateTime, "2026-11-23T22:00",
    "first Monday occurrence");
  assertEquals(buildProtectedTimeResolutionRequest(draft).end.localDateTime, "2026-11-24T06:30",
    "overnight end date");
});

Deno.test("rejects invalid weekdays, duplicate days, invalid clock ranges and caller-owned IDs", () => {
  for (const invalid of [
    weekly({ weekdays: [0, 1] }),
    weekly({ weekdays: [1, 1] }),
    weekly({ endsNextDay: false }),
    oneOff({ ownerUserId: PROFILE_ID }),
  ]) {
    let failed = false;
    try { normalizeProtectedTimeBlock(invalid); } catch { failed = true; }
    assertEquals(failed, true, "invalid Protected Time draft rejected");
  }
});

Deno.test("one-off and weekly patches require matching authoritative IANA evidence", () => {
  const draft = normalizeProtectedTimeBlock(oneOff());
  const request = buildProtectedTimeResolutionRequest(draft);
  const resolution = {
    requestedTimeZone: request.timeZone,
    timeZone: request.timeZone,
    startsAt: "2026-12-25T03:00:00.000Z",
    endsAt: "2026-12-25T11:30:00.000Z",
    start: { requestedLocalDateTime: request.start.localDateTime },
    end: { requestedLocalDateTime: request.end.localDateTime },
    rulesSource: "iana-tzdb",
    rulesVersion: "2026f",
    resolverVersion: "agenda-iana-resolver-v1",
    authoritative: true,
  };
  const patch = buildProtectedTimeBlockPatch(draft, resolution);
  assertEquals(Object.keys(patch).length, 22, "exact database patch field count");
  assertEquals(patch.starts_at, resolution.startsAt, "resolved start instant");
  assertEquals(patch.start_local, draft.startLocalDateTime, "original local start");
  assertEquals(patch.protection_mode, "hard", "hard protection persisted");

  let failed = false;
  try {
    buildProtectedTimeBlockPatch(draft, { ...resolution, requestedTimeZone: "Europe/Madrid" });
  } catch { failed = true; }
  assertEquals(failed, true, "mismatched resolver cannot be persisted");
});

Deno.test("Protected Time mutation hash binds action, block, expected version and normalized intent", async () => {
  const draft = normalizeProtectedTimeBlock(oneOff());
  const first = await hashProtectedTimeMutationIntent({
    action: "create", blockId: BLOCK_ID, expectedUpdatedAt: null, blockDraft: draft,
  });
  const replay = await hashProtectedTimeMutationIntent({
    action: "create", blockId: BLOCK_ID, expectedUpdatedAt: null, blockDraft: draft,
  });
  const changed = await hashProtectedTimeMutationIntent({
    action: "create", blockId: BLOCK_ID, expectedUpdatedAt: null,
    blockDraft: normalizeProtectedTimeBlock(oneOff({ label: "Otro bloque" })),
  });
  assertEquals(first.payloadHash, replay.payloadHash, "stable canonical hash");
  assertEquals(first.payloadHash === changed.payloadHash, false, "changed intent hash");
  assertEquals(first.payloadHash.length, 64, "SHA-256 length");
  const concurrentCreate = await hashProtectedTimeMutationIntent({
    action: "create", blockId: "019a0000-0000-7000-8000-000000000399", expectedUpdatedAt: null, blockDraft: draft,
  });
  assertEquals(first.payloadHash, concurrentCreate.payloadHash, "create intent is stable across racing generated IDs");
  const otherAction = await hashProtectedTimeMutationIntent({
    action: "edit", blockId: BLOCK_ID, expectedUpdatedAt: VERSION, blockDraft: draft,
  });
  const otherBlock = await hashProtectedTimeMutationIntent({
    action: "edit", blockId: "019a0000-0000-7000-8000-000000000399", expectedUpdatedAt: VERSION, blockDraft: draft,
  });
  assertEquals(otherAction.payloadHash === otherBlock.payloadHash, false, "non-create intent remains block-scoped");
});

Deno.test("authenticated one-off create resolves IANA and calls only the owner-scoped RPC", async () => {
  const { ctx, calls } = mockContext();
  const response = await handleRequest(request({ action: "create", block: oneOff() }), ctx, {
    now: () => "2026-11-22T18:10:00.000Z",
    newBlockId: () => BLOCK_ID,
  });
  if (response.status !== 201) throw new Error("create failed: " + JSON.stringify(await responseBody(response)));
  assertEquals((await responseBody(response)).blockId, BLOCK_ID, "created block id");
  assertEquals(calls.rpc, 1, "mutation RPC count");
  assertEquals(calls.rpcName, "mutate_protected_time_block_once", "RPC name");
  const args = calls.rpcArgs as Record<string, unknown>;
  assertEquals(args.p_owner_user_id, PROFILE_ID, "owner derived from verified profile");
  assertEquals(args.p_block_id, BLOCK_ID, "server generated block id");
  assertEquals(args.p_mutation, "create", "create action");
  assertEquals(args.p_expected_updated_at, null, "create has no expected version");
  const patch = args.p_block_patch as Record<string, unknown>;
  assertEquals(Object.keys(patch).length, 22, "20 editable fields plus conflict evidence");
  assertEquals(patch.resolver_metadata && (patch.resolver_metadata as Record<string, unknown>).authoritative,
    true, "authoritative resolver metadata");
  assertEquals(patch.owner_user_id, undefined, "no caller-supplied owner field");
});

Deno.test("authenticated weekly create stores the civil rule, not a fake UTC occurrence", async () => {
  const { ctx, calls } = mockContext();
  const response = await handleRequest(request({ action: "create", block: weekly() }), ctx, {
    now: () => "2026-11-22T18:10:00.000Z",
    newBlockId: () => BLOCK_ID,
  });
  if (response.status !== 201) throw new Error("weekly create failed: " + JSON.stringify(await responseBody(response)));
  const args = calls.rpcArgs as Record<string, unknown>;
  const patch = args.p_block_patch as Record<string, unknown>;
  assertEquals(patch.pattern_kind, "weekly", "weekly pattern");
  assertEquals(patch.starts_at, null, "no fabricated UTC start for an infinite rule");
  assertEquals(patch.weekdays, [1, 3, 5], "weekdays");
  assertEquals(patch.start_time_local, "22:00", "weekly start clock");
  assertEquals(patch.ends_next_day, true, "overnight weekly rule");
});

Deno.test("idempotent create replay reuses the recorded block id and skips timezone resolution", async () => {
  const draft = normalizeProtectedTimeBlock(oneOff());
  const intent = await hashProtectedTimeMutationIntent({
    action: "create", blockId: BLOCK_ID, expectedUpdatedAt: null, blockDraft: draft,
  });
  const existing = {
    block_id: BLOCK_ID,
    payload_version: intent.version,
    payload_hash: intent.payloadHash,
    response_http_status: 201,
    response_body: { blockId: BLOCK_ID, lifecycle: "active" },
  };
  const { ctx, calls } = mockContext({ existing });
  const response = await handleRequest(request({ action: "create", block: oneOff() }), ctx, {
    newBlockId: () => { throw new Error("retry must not generate another block id"); },
  });
  assertEquals(response.status, 201, "replay status");
  assertEquals((await responseBody(response)).replayed, true, "replay marker");
  assertEquals(calls.rpc, 0, "no second write");
});


Deno.test("Protected Time requires version-bound consent for overlapping TaskSchedules", async () => {
  const taskScheduleId = "019a0000-0000-7000-8000-000000000411";
  const taskScheduleUpdatedAt = "2026-12-25T04:00:00.000Z";
  const taskSchedules = [{
    id: taskScheduleId,
    updated_at: taskScheduleUpdatedAt,
    starts_at: "2026-12-25T04:00:00.000Z",
    ends_at: "2026-12-25T05:00:00.000Z",
    time_zone: "America/Havana",
    schedule_status: "confirmed",
  }];
  const { ctx, calls } = mockContext({ taskSchedules });
  const missingDecision = await handleRequest(request({ action: "create", block: oneOff() }), ctx, {
    now: () => "2026-11-22T18:10:00.000Z",
    newBlockId: () => BLOCK_ID,
  });
  assertEquals(missingDecision.status, 409, "missing explicit overlap decision status");
  const conflictBody = await responseBody(missingDecision);
  assertEquals(conflictBody.error, "TASK_SCHEDULE_CONFLICTS", "missing decision error");
  const conflicts = conflictBody.taskScheduleConflicts as Record<string, unknown>[];
  assertEquals(conflicts.length, 1, "one overlapping TaskSchedule occurrence");
  assertEquals(conflicts[0].taskScheduleId, taskScheduleId, "conflict schedule identity");
  assertEquals(calls.rpc, 0, "no write before explicit consent");

  const accepted = await handleRequest(request({
    action: "create",
    block: oneOff(),
    taskScheduleDecisions: [{
      taskScheduleId,
      taskScheduleUpdatedAt,
      occurrenceStartsAt: "2026-12-25T02:00:00.000Z",
      decision: "keep_overlap",
    }],
  }), ctx, {
    now: () => "2026-11-22T18:11:00.000Z",
    newBlockId: () => BLOCK_ID,
  });
  if (accepted.status !== 201) throw new Error("accepted overlap failed: " + JSON.stringify(await responseBody(accepted)));
  const args = calls.rpcArgs as Record<string, unknown>;
  assertEquals(args.p_payload_version, "protected-time-mutation-v2", "consent is idempotency-hash versioned");
  const patch = args.p_block_patch as Record<string, unknown>;
  const decisions = patch.task_schedule_conflict_decisions as Record<string, unknown>[];
  assertEquals(decisions.length, 1, "one stored consent record");
  assertEquals(decisions[0].taskScheduleId, taskScheduleId, "consent binds TaskSchedule id");
  assertEquals(decisions[0].taskScheduleUpdatedAt, taskScheduleUpdatedAt, "consent binds TaskSchedule version");
  assertEquals(decisions[0].decision, "keep_overlap", "explicit keep-overlap decision");
  assertEquals(patch.task_schedule_snapshot, [{ id: taskScheduleId, updated_at: taskScheduleUpdatedAt }],
    "full active schedule snapshot sent to atomic RPC");
});

Deno.test("restoring archived Protected Time requires version-bound TaskSchedule consent", async () => {
  const taskScheduleId = "019a0000-0000-7000-8000-000000000412";
  const taskScheduleUpdatedAt = "2026-12-25T04:00:00.000Z";
  const restoreBlock = {
    id: BLOCK_ID,
    // PostgREST's UTC offset form is the same instant as VERSION's Z form.
    updated_at: "2026-11-22T18:00:00.123456+00:00",
    label: "Sueño protegido",
    category: "sleep",
    protection_mode: "hard",
    pattern_kind: "one_off",
    time_zone: "America/Havana",
    starts_at: "2026-12-25T03:00:00.000Z",
    ends_at: "2026-12-25T11:30:00.000Z",
    start_date: null,
    end_date_exclusive: null,
    weekdays: null,
    start_time_local: null,
    end_time_local: null,
    ends_next_day: null,
    archived_at: "2026-11-22T18:00:00.000Z",
    deleted_at: null,
  };
  const taskSchedules = [{
    id: taskScheduleId,
    updated_at: taskScheduleUpdatedAt,
    starts_at: "2026-12-25T04:00:00.000Z",
    ends_at: "2026-12-25T05:00:00.000Z",
    time_zone: "America/Havana",
    schedule_status: "confirmed",
  }];
  const { ctx, calls } = mockContext({
    restoreBlock,
    taskSchedules,
    rpcResult: [{
      http_status: 200,
      response_body: { blockId: BLOCK_ID, updatedAt: "2026-11-22T18:15:00.000000Z", lifecycle: "active" },
      replayed: false,
    }],
  });
  const base = { action: "restore", blockId: BLOCK_ID, expectedUpdatedAt: VERSION };
  const missing = await handleRequest(request(base), ctx, {
    now: () => "2026-11-22T18:10:00.000Z",
  });
  assertEquals(missing.status, 409, "restore without schedule consent status");
  assertEquals((await responseBody(missing)).error, "TASK_SCHEDULE_CONFLICTS", "restore conflict code");
  assertEquals(calls.rpc, 0, "restore does not write before explicit consent");

  const accepted = await handleRequest(request({
    ...base,
    taskScheduleDecisions: [{
      taskScheduleId,
      taskScheduleUpdatedAt,
      occurrenceStartsAt: restoreBlock.starts_at,
      decision: "keep_overlap",
    }],
  }), ctx, { now: () => "2026-11-22T18:11:00.000Z" });
  assertEquals(accepted.status, 200, "restore with accepted conflict status");
  const args = calls.rpcArgs as Record<string, unknown>;
  assertEquals(args.p_expected_updated_at, VERSION, "full-precision expected version reaches SQL CAS unchanged");
  assertEquals(args.p_payload_version, "protected-time-mutation-v2", "restore consent is hash-versioned");
  assertEquals(args.p_block_patch && Object.keys(args.p_block_patch as Record<string, unknown>).length, 2,
    "restore patch contains only decision evidence and the complete snapshot");
  const patch = args.p_block_patch as Record<string, unknown>;
  assertEquals((patch.task_schedule_conflict_decisions as Record<string, unknown>[])[0].taskScheduleId,
    taskScheduleId, "restore stores the exact TaskSchedule consent");
  assertEquals(patch.task_schedule_snapshot, [{ id: taskScheduleId, updated_at: taskScheduleUpdatedAt }],
    "restore sends the complete TaskSchedule snapshot");
});

Deno.test("an inactive profile cannot write Protected Time", async () => {
  const { ctx, calls } = mockContext({ authMode: "anon" });
  const response = await handleRequest(request({ action: "create", block: oneOff() }), ctx);
  assertEquals(response.status, 401, "unauthenticated status");
  assertEquals(calls.ledgerLookup, 0, "no ledger access");
  assertEquals(calls.rpc, 0, "no write");
});

Deno.test("allows an explicit one-hour interval across the repeated DST wall-clock time", () => {
  const draft = normalizeProtectedTimeBlock(oneOff({
    timeZone: "America/New_York",
    startLocalDateTime: "2026-11-01T01:30",
    endLocalDateTime: "2026-11-01T01:30",
    startDisambiguation: "earlier",
    endDisambiguation: "later",
  }));
  const resolved = resolveLocalDateTimeRange(buildProtectedTimeResolutionRequest(draft));
  assert(Date.parse(resolved.endsAt) > Date.parse(resolved.startsAt), "resolved fold interval must have positive duration");
  assertEquals(resolved.start.resolution, "ambiguous-first", "start chooses the first DST fold instant");
  assertEquals(resolved.end.resolution, "ambiguous-later", "end chooses the second DST fold instant");
});
