import { handleRequest } from "../supabase/functions/agenda-event-mutate/handler.ts";
import type { EventAuthenticatedContext } from "../supabase/functions/_shared/agenda-event-profile.ts";
import {
  hashEventMutationIntent,
  normalizeEventMutation,
  normalizeEventMutationId,
  normalizeExpectedEventVersion,
} from "../src/features/agenda/domain/event-mutation.js";
import { createEventDraft } from "../src/features/agenda/domain/event.js";

const AUTH_USER_ID = "00000000-0000-4000-8000-000000000001";
const PROFILE_ID = "0190f47a-7b2c-7abc-8def-0123456789ac";
const EVENT_ID = "0190f47a-7b2c-7abc-8def-0123456789ad";
const KEY = "0190f47a-7b2c-7abc-8def-0123456789ae";
const VERSION = "2026-11-22T18:00:00.123456Z";

function assertEquals(actual: unknown, expected: unknown, label: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(label + ": expected " + JSON.stringify(expected) + ", got " + JSON.stringify(actual));
  }
}
async function body(response: Response): Promise<Record<string, unknown>> {
  return await response.json() as Record<string, unknown>;
}
function request(
  payload: Record<string, unknown>,
  key = KEY,
  method = "POST",
  contentType = "application/json",
): Request {
  return new Request("https://local.test/agenda-event-mutate", {
    method,
    headers: { "content-type": contentType, "idempotency-key": key },
    body: method === "POST" ? JSON.stringify(payload) : undefined,
  });
}

function mockContext({
  profileStatus = "active",
  existing = null as Record<string, unknown> | null,
  lookupError = null as unknown,
  rpcResult = [{
    http_status: 200,
    response_body: {
      eventId: EVENT_ID,
      updatedAt: "2026-11-22T18:10:00.123456Z",
      eventStatus: "confirmed",
      lifecycle: "active",
      archivedAt: null,
      deletedAt: null,
      purgeAfter: null,
    },
    replayed: false,
  }],
  rpcError = null,
  protectedBlocks = [] as Record<string, unknown>[],
  taskSchedules = [] as Record<string, unknown>[],
  currentEvent = {
    temporal_kind: "all_day",
    start_date: "2026-12-24",
    end_date_exclusive: "2026-12-26",
    starts_at: null,
    ends_at: null,
    protected_time_decisions: [],
    task_schedule_conflict_decisions: [],
  } as Record<string, unknown>,
}: {
  profileStatus?: string;
  existing?: Record<string, unknown> | null;
  lookupError?: unknown;
  rpcResult?: unknown;
  rpcError?: unknown;
  protectedBlocks?: Record<string, unknown>[];
  taskSchedules?: Record<string, unknown>[];
  currentEvent?: Record<string, unknown>;
} = {}) {
  const calls: Record<string, unknown> = { profileLookup: 0, rpc: 0, rpcName: null, rpcArgs: null };
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
                    data: { id: PROFILE_ID, auth_user_id: AUTH_USER_ID, account_status: profileStatus },
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
      if (table === "event_mutation_request") {
        return {
          select() {
            return {
              eq(_column: string, _value: string) {
                return {
                  eq(_key: string, _value: string) {
                    return {
                      async maybeSingle() {
                        calls.ledgerLookup = Number(calls.ledgerLookup ?? 0) + 1;
                        return { data: existing, error: lookupError };
                      },
                    };
                  },
                };
              },
            };
          },
        };
      }
      if (table === "calendar_event") {
        const query: any = {
          select() { return this; },
          eq() { return this; },
          async maybeSingle() { return { data: currentEvent, error: null }; },
        };
        return query;
      }
      if (table === "user_preference") {
        return {
          select() {
            return {
              eq() { return { async maybeSingle() { return { data: { time_zone: "America/Havana" }, error: null }; } }; },
            };
          },
        };
      }
      if (table === "protected_time_block") {
        const query: any = {
          select() { return this; },
          eq() { return this; },
          is() { return this; },
          order() { return this; },
          async limit() { return { data: protectedBlocks, error: null }; },
        };
        return query;
      }
      if (table === "task_schedule") {
        const query: any = {
          select() { return this; },
          eq() { return this; },
          in() { return this; },
          order() { return this; },
          async limit() { return { data: taskSchedules, error: null }; },
        };
        return query;
      }
      throw new Error("unexpected admin table " + table);
    },
    async rpc(name: string, args: Record<string, unknown>) {
      calls.rpc = Number(calls.rpc) + 1;
      calls.rpcName = name;
      calls.rpcArgs = args;
      return { data: rpcResult, error: rpcError };
    },
  };
  const ctx = {
    authMode: "user",
    userClaims: { id: AUTH_USER_ID },
    supabase,
    supabaseAdmin,
  } as unknown as EventAuthenticatedContext & { supabaseAdmin: typeof supabaseAdmin };
  return { ctx, calls };
}

function eventDraft(overrides: Record<string, unknown> = {}) {
  return createEventDraft({
    title: "Reunión actualizada",
    description: "Detalles nuevos",
    locationLabel: "Sala A",
    locationKind: "physical",
    eventStatus: "confirmed",
    temporalKind: "all_day",
    startDate: "2026-12-24",
    endDateExclusive: "2026-12-26",
    ...overrides,
  });
}

Deno.test("Event mutation normalizes UUIDv7 and preserves PostgreSQL microsecond version precision", () => {
  assertEquals(normalizeEventMutationId(EVENT_ID), EVENT_ID, "Event id");
  assertEquals(normalizeExpectedEventVersion(VERSION), VERSION, "exact expected updated_at");
  assertEquals(normalizeEventMutation({
    eventId: EVENT_ID,
    expectedUpdatedAt: VERSION,
    action: "cancel",
  }), {
    eventId: EVENT_ID,
    expectedUpdatedAt: VERSION,
    action: "cancel",
    eventDraft: null,
    protectedTimeDecisions: [],
    taskScheduleDecisions: [],
  }, "normalized cancel mutation");
});

Deno.test("Event mutation rejects malformed Event IDs, timestamp versions and unknown actions", () => {
  let failed = false;
  try { normalizeEventMutationId("not-a-uuid"); } catch { failed = true; }
  assertEquals(failed, true, "invalid Event id rejected");
  failed = false;
  try { normalizeExpectedEventVersion("2026-11-22T18:00:00"); } catch { failed = true; }
  assertEquals(failed, true, "timestamp without offset rejected");
  failed = false;
  try {
    normalizeEventMutation({ eventId: EVENT_ID, expectedUpdatedAt: VERSION, action: "delete" });
  } catch { failed = true; }
  assertEquals(failed, true, "unknown mutation rejected");
});

Deno.test("Event mutation hash binds action, Event, exact expected version and normalized edit intent", async () => {
  const mutation = normalizeEventMutation({
    eventId: EVENT_ID,
    expectedUpdatedAt: VERSION,
    action: "edit",
    eventDraft: eventDraft(),
  });
  const first = await hashEventMutationIntent(mutation);
  const replay = await hashEventMutationIntent(mutation);
  const changedVersion = await hashEventMutationIntent({
    ...mutation,
    expectedUpdatedAt: "2026-11-22T18:00:00.123457Z",
  });
  const changedAction = await hashEventMutationIntent({
    ...mutation,
    action: "cancel",
    eventDraft: null,
  });
  const consent = {
    blockId: "019a0000-0000-7000-8000-000000000111",
    blockUpdatedAt: "2026-11-20T10:00:00.000000+00:00",
    occurrenceStartsAt: "2026-12-24T06:00:00.000Z",
    decision: "override_hard",
  };
  const withConsent = await hashEventMutationIntent({
    ...mutation,
    protectedTimeDecisions: [consent],
  });
  const changedConsent = await hashEventMutationIntent({
    ...mutation,
    protectedTimeDecisions: [{ ...consent, decision: "keep_flexible" }],
  });
  const taskScheduleConsent = {
    taskScheduleId: "019a0000-0000-7000-8000-000000000222",
    taskScheduleUpdatedAt: VERSION,
    decision: "keep_overlap",
  };
  const withTaskScheduleConsent = await hashEventMutationIntent({
    ...mutation,
    taskScheduleDecisions: [taskScheduleConsent],
  });
  const changedTaskScheduleConsent = await hashEventMutationIntent({
    ...mutation,
    taskScheduleDecisions: [{ ...taskScheduleConsent, taskScheduleUpdatedAt: "2026-11-22T18:00:00.123457Z" }],
  });
  assertEquals(first.payloadHash, replay.payloadHash, "stable hash");
  assertEquals(first.payloadHash.length, 64, "SHA-256 length");
  assertEquals(first.payloadHash === changedVersion.payloadHash, false, "version participates in hash");
  assertEquals(first.payloadHash === changedAction.payloadHash, false, "action participates in hash");
  assertEquals(first.payloadHash === withConsent.payloadHash, false, "Protected Time consent participates in hash");
  assertEquals(withConsent.payloadHash === changedConsent.payloadHash, false, "a changed consent choice changes the hash");
  assertEquals(first.payloadHash === withTaskScheduleConsent.payloadHash, false, "TaskSchedule consent participates in hash");
  assertEquals(withTaskScheduleConsent.payloadHash === changedTaskScheduleConsent.payloadHash, false,
    "a changed TaskSchedule version changes hash");
});

Deno.test("authenticated edit invokes only the atomic owner-scoped mutation RPC with server-derived owner", async () => {
  const { ctx, calls } = mockContext();
  const response = await handleRequest(request({
    eventId: EVENT_ID,
    expectedUpdatedAt: VERSION,
    action: "edit",
    event: {
      title: "Reunión actualizada",
      description: "Detalles nuevos",
      locationLabel: "Sala A",
      locationKind: "physical",
      eventStatus: "confirmed",
      temporalKind: "all_day",
      startDate: "2026-12-24",
      endDateExclusive: "2026-12-26",
    },
  }), ctx, { now: () => "2026-11-22T18:10:00.000Z" });

  assertEquals(response.status, 200, "edit status");
  assertEquals((await body(response)).eventId, EVENT_ID, "edit response Event ID");
  assertEquals(calls.rpc, 1, "atomic mutation RPC count");
  assertEquals(calls.rpcName, "mutate_calendar_event_once", "RPC name");
  const args = calls.rpcArgs as Record<string, unknown>;
  assertEquals(args.p_owner_user_id, PROFILE_ID, "owner from verified profile");
  assertEquals(args.p_event_id, EVENT_ID, "Event id");
  assertEquals(args.p_expected_updated_at, VERSION, "optimistic version");
  assertEquals(args.p_mutation, "edit", "mutation kind");
  assertEquals(args.p_idempotency_key, KEY, "UUIDv7 key");
  const patch = args.p_event_patch as Record<string, unknown>;
  assertEquals(Object.keys(patch).length, 21, "editable Event fields plus Protected Time and TaskSchedule evidence");
  assertEquals(patch.title, "Reunión actualizada", "title patch");
  assertEquals(patch.protected_time_decisions, [], "no Protected Time decisions needed");
  assertEquals(patch.protected_time_snapshot, [], "empty Protected Time owner snapshot supplied");
  assertEquals(patch.task_schedule_conflict_decisions, [], "no TaskSchedule decisions needed");
  assertEquals(patch.task_schedule_snapshot, [], "empty TaskSchedule owner snapshot supplied");
  assertEquals(Object.keys(patch.task_schedule_window as Record<string, unknown>).length, 2, "resolved TaskSchedule comparison window");
  assertEquals(patch.owner_user_id, undefined, "no owner identity in patch");
});

Deno.test("Event edit requires explicit consent for an overlapping TaskSchedule", async () => {
  const schedule = {
    id: "019a0000-0000-7000-8000-000000000223",
    updated_at: "2026-11-20T10:00:00.000000+00:00",
    starts_at: "2026-12-24T06:00:00.000Z",
    ends_at: "2026-12-24T07:00:00.000Z",
    time_zone: "America/Havana",
    schedule_status: "confirmed",
  };
  const missing = mockContext({ taskSchedules: [schedule] });
  const noConsent = await handleRequest(request({
    eventId: EVENT_ID,
    expectedUpdatedAt: VERSION,
    action: "edit",
    event: {
      title: "Reunión actualizada",
      description: "Detalles nuevos",
      locationLabel: "Sala A",
      locationKind: "physical",
      eventStatus: "confirmed",
      temporalKind: "all_day",
      startDate: "2026-12-24",
      endDateExclusive: "2026-12-26",
    },
  }), missing.ctx, { now: () => "2026-11-22T18:10:00.000Z" });
  assertEquals(noConsent.status, 409, "overlap must be resolved before edit");
  assertEquals((await body(noConsent)).error, "TASK_SCHEDULE_CONFLICTS", "schedule conflict code");
  assertEquals(missing.calls.rpc, 0, "no edit RPC without consent");

  const accepted = mockContext({ taskSchedules: [schedule] });
  const response = await handleRequest(request({
    eventId: EVENT_ID,
    expectedUpdatedAt: VERSION,
    action: "edit",
    event: {
      title: "Reunión actualizada",
      description: "Detalles nuevos",
      locationLabel: "Sala A",
      locationKind: "physical",
      eventStatus: "confirmed",
      temporalKind: "all_day",
      startDate: "2026-12-24",
      endDateExclusive: "2026-12-26",
    },
    taskScheduleDecisions: [{
      taskScheduleId: schedule.id,
      taskScheduleUpdatedAt: schedule.updated_at,
      decision: "keep_overlap",
    }],
  }), accepted.ctx, { now: () => "2026-11-22T18:10:00.000Z" });
  assertEquals(response.status, 200, "explicit TaskSchedule decision accepted");
  const args = accepted.calls.rpcArgs as Record<string, unknown>;
  const patch = args.p_event_patch as Record<string, unknown>;
  const decisions = patch.task_schedule_conflict_decisions as Array<Record<string, unknown>>;
  assertEquals(decisions.length, 1, "one consent persisted for edit");
  assertEquals(decisions[0].taskScheduleId, schedule.id, "edit consent is version-bound");
  assertEquals(decisions[0].taskScheduleUpdatedAt, schedule.updated_at, "edit uses exact schedule version");
  assertEquals((patch.task_schedule_snapshot as unknown[]).length, 1, "edit supplies full active schedule snapshot");
  assertEquals(Object.keys(patch.task_schedule_window as object).length, 2, "edit supplies resolved UTC comparison window");
});

Deno.test("a detail-only Event edit preserves the original Protected Time consent timestamp", async () => {Deno.test("a detail-only Event edit preserves the original Protected Time consent timestamp", async () => {
  const blockId = "019a0000-0000-7000-8000-000000000211";
  const blockUpdatedAt = "2026-11-20T10:00:00.000000+00:00";
  const occurrenceStartsAt = "2026-12-24T06:00:00.000Z";
  const priorConsent = {
    policyVersion: "protected-time-decision-v1",
    blockId,
    blockUpdatedAt,
    protectionMode: "hard",
    occurrenceDate: null,
    occurrenceStartsAt,
    occurrenceEndsAt: "2026-12-24T07:00:00.000Z",
    overlapStartsAt: occurrenceStartsAt,
    overlapEndsAt: "2026-12-24T07:00:00.000Z",
    timeZone: "America/Havana",
    decision: "override_hard",
    consentedAt: "2026-11-20T12:00:00.000Z",
  };
  const currentEvent = {
    temporal_kind: "all_day",
    start_date: "2026-12-24",
    end_date_exclusive: "2026-12-26",
    starts_at: null,
    ends_at: null,
    protected_time_decisions: [priorConsent],
  };
  const protectedBlock = {
    id: blockId,
    updated_at: blockUpdatedAt,
    label: "Sueño protegido",
    category: "salud",
    protection_mode: "hard",
    pattern_kind: "one_off",
    time_zone: "America/Havana",
    starts_at: occurrenceStartsAt,
    ends_at: "2026-12-24T07:00:00.000Z",
    archived_at: null,
    deleted_at: null,
  };
  const { ctx, calls } = mockContext({
    currentEvent,
    protectedBlocks: [protectedBlock],
  });
  const response = await handleRequest(request({
    eventId: EVENT_ID,
    expectedUpdatedAt: VERSION,
    action: "edit",
    event: {
      title: "Reunión actualizada",
      description: "Sólo cambió la descripción",
      locationLabel: "Sala A",
      locationKind: "physical",
      eventStatus: "confirmed",
      temporalKind: "all_day",
      startDate: "2026-12-24",
      endDateExclusive: "2026-12-26",
    },
  }), ctx, { now: () => "2026-11-22T18:10:00.000Z" });

  assertEquals(response.status, 200, "detail-only edit succeeds with existing consent");
  const args = calls.rpcArgs as Record<string, unknown>;
  const patch = args.p_event_patch as Record<string, unknown>;
  const decisions = patch.protected_time_decisions as Array<Record<string, unknown>>;
  assertEquals(decisions.length, 1, "one still-current overlap decision remains");
  assertEquals(decisions[0].consentedAt, priorConsent.consentedAt,
    "original user consent timestamp is preserved");
  assertEquals(decisions[0].blockUpdatedAt, blockUpdatedAt,
    "decision stays tied to the exact Protected Time version");
  assertEquals((patch.protected_time_snapshot as unknown[]).length, 1,
    "current full owner snapshot accompanies the Event write");
});

Deno.test("finish action is a distinct terminal Event transition", async () => {
  const { ctx, calls } = mockContext({
    rpcResult: [{
      http_status: 200,
      response_body: {
        eventId: EVENT_ID,
        updatedAt: "2026-11-22T18:10:00.000000Z",
        eventStatus: "finished",
        lifecycle: "active",
        archivedAt: null,
        deletedAt: null,
        purgeAfter: null,
      },
      replayed: false,
    }],
  });
  const response = await handleRequest(request({
    eventId: EVENT_ID,
    expectedUpdatedAt: VERSION,
    action: "finish",
  }), ctx);
  assertEquals(response.status, 200, "finish status");
  assertEquals((await body(response)).eventStatus, "finished", "finish result status");
  const args = calls.rpcArgs as Record<string, unknown>;
  assertEquals(args.p_mutation, "finish", "finish action");
  assertEquals(args.p_event_patch, {}, "finish does not accept a caller patch");
});

Deno.test("cancel action has no caller-supplied Event patch and returns the recorded status", async () => {
  const { ctx, calls } = mockContext({
    rpcResult: [{
      http_status: 200,
      response_body: {
        eventId: EVENT_ID,
        updatedAt: "2026-11-22T18:10:00.000000Z",
        eventStatus: "cancelled",
        lifecycle: "active",
        archivedAt: null,
        deletedAt: null,
        purgeAfter: null,
      },
      replayed: false,
    }],
  });
  const response = await handleRequest(request({
    eventId: EVENT_ID,
    expectedUpdatedAt: VERSION,
    action: "cancel",
  }), ctx);
  assertEquals(response.status, 200, "cancel status");
  assertEquals((await body(response)).eventStatus, "cancelled", "cancel result status");
  const args = calls.rpcArgs as Record<string, unknown>;
  assertEquals(args.p_event_patch, {}, "non-edit mutation patch");
  assertEquals(args.p_mutation, "cancel", "cancel action");
});

Deno.test("same idempotent mutation receipt is surfaced as replayed", async () => {
  const { ctx } = mockContext({
    rpcResult: [{
      http_status: 200,
      response_body: { eventId: EVENT_ID, eventStatus: "confirmed", lifecycle: "active" },
      replayed: true,
    }],
  });
  const response = await handleRequest(request({
    eventId: EVENT_ID,
    expectedUpdatedAt: VERSION,
    action: "reopen",
  }), ctx);
  assertEquals(response.status, 200, "replay status");
  assertEquals((await body(response)).replayed, true, "replay marker");
});

Deno.test("mutation conflicts preserve their HTTP 409 response without another write path", async () => {
  const { ctx, calls } = mockContext({
    rpcResult: [{
      http_status: 409,
      response_body: { error: "EVENT_VERSION_CONFLICT", currentUpdatedAt: VERSION },
      replayed: false,
    }],
  });
  const response = await handleRequest(request({
    eventId: EVENT_ID,
    expectedUpdatedAt: VERSION,
    action: "archive",
  }), ctx);
  assertEquals(response.status, 409, "conflict status");
  assertEquals((await body(response)).error, "EVENT_VERSION_CONFLICT", "conflict code");
  assertEquals(calls.rpc, 1, "conflict remains within atomic mutation RPC");
});

Deno.test("inactive profiles and malformed requests fail closed before the write RPC", async () => {
  const inactive = mockContext({ profileStatus: "disabled" });
  const denied = await handleRequest(request({
    eventId: EVENT_ID,
    expectedUpdatedAt: VERSION,
    action: "cancel",
  }), inactive.ctx);
  assertEquals(denied.status, 403, "inactive profile");
  assertEquals(inactive.calls.rpc, 0, "inactive profile never writes");

  const active = mockContext();
  const wrongMethod = await handleRequest(new Request("https://local.test", { method: "GET" }), active.ctx);
  assertEquals(wrongMethod.status, 405, "method gate");
  const invalidKey = await handleRequest(request({
    eventId: EVENT_ID,
    expectedUpdatedAt: VERSION,
    action: "cancel",
  }, "not-a-key"), active.ctx);
  assertEquals(invalidKey.status, 422, "idempotency key gate");
  const unknownField = await handleRequest(request({
    eventId: EVENT_ID,
    expectedUpdatedAt: VERSION,
    action: "cancel",
    owner_user_id: PROFILE_ID,
  }), active.ctx);
  assertEquals(unknownField.status, 422, "unknown identity field");
  assertEquals(active.calls.rpc, 0, "invalid requests do not write");
});


Deno.test("completed mutation receipt replays before resolver and RPC", async () => {
  const draft = eventDraft();
  const mutation = normalizeEventMutation({
    eventId: EVENT_ID,
    expectedUpdatedAt: VERSION,
    action: "edit",
    eventDraft: draft,
  });
  const intent = await hashEventMutationIntent(mutation);
  const existing = {
    event_id: EVENT_ID,
    payload_version: intent.version,
    payload_hash: "\\x" + intent.payloadHash,
    response_http_status: 200,
    response_body: {
      eventId: EVENT_ID,
      updatedAt: VERSION,
      eventStatus: "confirmed",
      lifecycle: "active",
    },
  };
  const { ctx, calls } = mockContext({ existing });
  const response = await handleRequest(request({
    eventId: EVENT_ID,
    expectedUpdatedAt: VERSION,
    action: "edit",
    event: {
      title: "Reunión actualizada",
      description: "Detalles nuevos",
      locationLabel: "Sala A",
      locationKind: "physical",
      eventStatus: "confirmed",
      temporalKind: "all_day",
      startDate: "2026-12-24",
      endDateExclusive: "2026-12-26",
    },
  }), ctx);
  assertEquals(response.status, 200, "preflight replay status");
  assertEquals((await body(response)).replayed, true, "preflight replay marker");
  assertEquals(calls.rpc, 0, "preflight replay skips mutation RPC and resolver path");
});

Deno.test("a mutation key whose stored intent differs returns 409 before writing", async () => {
  const { ctx, calls } = mockContext({
    existing: {
      event_id: EVENT_ID,
      payload_version: "event-mutation-v1",
      payload_hash: "\\x" + "0".repeat(64),
      response_http_status: 200,
      response_body: { eventId: EVENT_ID },
    },
  });
  const response = await handleRequest(request({
    eventId: EVENT_ID,
    expectedUpdatedAt: VERSION,
    action: "cancel",
  }), ctx);
  assertEquals(response.status, 409, "preflight idempotency conflict");
  assertEquals((await body(response)).error, "IDEMPOTENCY_KEY_REUSED", "preflight conflict code");
  assertEquals(calls.rpc, 0, "conflict skips the mutation RPC");
});

Deno.test("mutation receipt lookup failure blocks the write", async () => {
  const { ctx, calls } = mockContext({ lookupError: new Error("offline") });
  const response = await handleRequest(request({
    eventId: EVENT_ID,
    expectedUpdatedAt: VERSION,
    action: "cancel",
  }), ctx);
  assertEquals(response.status, 503, "ledger lookup failure");
  assertEquals(calls.rpc, 0, "failed receipt lookup never writes");
});
