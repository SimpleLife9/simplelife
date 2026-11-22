import { handleRequest } from "../supabase/functions/agenda-task-schedule-mutate/handler.ts";
import {
  hashTaskScheduleMutationIntent,
  normalizeTaskScheduleMutation,
} from "../src/features/agenda/domain/task-schedule.js";
import type { EventAuthenticatedContext } from "../supabase/functions/_shared/agenda-event-profile.ts";
import { resolveLocalDateTimeRange } from "../supabase/functions/agenda-time-resolve/resolver.ts";

const AUTH_USER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PROFILE_ID = "019a0000-0000-7000-8000-000000000001";
const TASK_ID = "019a0000-0000-7000-8000-000000000011";
const SCHEDULE_ID = "019a0000-0000-7000-8000-000000000101";
const KEY = "019a0000-0000-7000-8000-000000000201";
const EVENT_ID = "019a0000-0000-7000-8000-000000000301";
const BLOCK_ID = "019a0000-0000-7000-8000-000000000401";
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
  return new Request("https://local.test/agenda-task-schedule-mutate", {
    method,
    headers: { "content-type": "application/json", "idempotency-key": key },
    body: method === "POST" ? JSON.stringify(payload) : undefined,
  });
}
function createPayload(overrides: Record<string, unknown> = {}) {
  return {
    action: "create",
    taskId: TASK_ID,
    schedule: {
      startLocalDateTime: "2026-11-24T09:00",
      endLocalDateTime: "2026-11-24T10:00",
      timeZone: "America/Havana",
      startDisambiguation: "earlier",
      endDisambiguation: "earlier",
    },
    ...overrides,
  };
}

function queryResult(data: unknown, error: unknown = null) {
  const result = { data, error };
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "eq", "is", "in", "order", "limit"]) {
    builder[method] = () => builder;
  }
  builder.maybeSingle = async () => result;
  builder.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return builder;
}

function mockContext({
  authMode = "user",
  existing = null as Record<string, unknown> | null,
  events = [] as Record<string, unknown>[],
  protectedBlocks = [] as Record<string, unknown>[],
  schedules = [] as Record<string, unknown>[],
  rpcResult = [{
    http_status: 201,
    response_body: {
      taskScheduleId: SCHEDULE_ID,
      taskId: TASK_ID,
      scheduleStatus: "proposed",
      updatedAt: "2026-11-22T18:10:00.123456Z",
      startsAt: "2026-11-24T14:00:00.000Z",
      endsAt: "2026-11-24T15:00:00.000Z",
      conflictDecisionCount: 0,
    },
    replayed: false,
  }],
}: {
  authMode?: string;
  existing?: Record<string, unknown> | null;
  events?: Record<string, unknown>[];
  protectedBlocks?: Record<string, unknown>[];
  schedules?: Record<string, unknown>[];
  rpcResult?: unknown;
} = {}) {
  const calls: Record<string, unknown> = {
    profileLookup: 0, ledgerLookup: 0, rpc: 0, rpcName: null, rpcArgs: null,
    adminTables: [] as string[],
  };
  const supabase = {
    from(table: string) {
      if (table !== "user_profile") throw new Error("unexpected user client table " + table);
      return {
        select() {
          return {
            eq() {
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
  const rows: Record<string, unknown> = {
    user_preference: { data: { time_zone: "America/Havana" }, error: null },
    calendar_event: { data: events, error: null },
    protected_time_block: { data: protectedBlocks, error: null },
    task_schedule: { data: schedules, error: null },
    task_schedule_mutation_request: { data: existing, error: null },
  };
  const supabaseAdmin = {
    from(table: string) {
      (calls.adminTables as string[]).push(table);
      const result = rows[table] ?? { data: null, error: null };
      return queryResult((result as Record<string, unknown>).data, (result as Record<string, unknown>).error);
    },
    async rpc(name: string, args: Record<string, unknown>) {
      calls.rpc = Number(calls.rpc) + 1;
      calls.rpcName = name;
      calls.rpcArgs = args;
      return { data: rpcResult, error: null };
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

Deno.test("authenticated create resolves IANA and calls the owner-scoped TaskSchedule RPC", async () => {
  const { ctx, calls } = mockContext();
  const response = await handleRequest(request(createPayload()), ctx, {
    now: () => "2026-11-22T18:10:00.000Z",
    newTaskScheduleId: () => SCHEDULE_ID,
  });
  assertEquals(response.status, 201, "create status");
  assertEquals((await responseBody(response)).taskScheduleId, SCHEDULE_ID, "created TaskSchedule id");
  assertEquals(calls.rpc, 1, "RPC call count");
  assertEquals(calls.rpcName, "mutate_task_schedule_once", "RPC name");
  const args = calls.rpcArgs as Record<string, unknown>;
  assertEquals(args.p_owner_user_id, PROFILE_ID, "owner derived from verified profile");
  assertEquals(args.p_task_schedule_id, SCHEDULE_ID, "server-generated reservation id");
  assertEquals(args.p_mutation, "create", "create mutation");
  assertEquals(args.p_expected_updated_at, null, "create omits expected version");
  const patch = args.p_schedule_patch as Record<string, unknown>;
  assertEquals(Object.keys(patch).length, 14, "exactly 14 mutable database fields");
  assertEquals(patch.task_id, TASK_ID, "references the selected existing Task");
  assertEquals(patch.schedule_status, "proposed", "new reservation is proposed");
  assertEquals(patch.start_local, "2026-11-24T09:00", "original wall time");
  assertEquals(patch.resolver_metadata && (patch.resolver_metadata as Record<string, unknown>).authoritative,
    true, "authoritative resolver metadata");
  assertEquals(patch.owner_user_id, undefined, "owner is not caller-controlled");
  assertEquals((patch.conflict_snapshot as unknown[]).length, 0, "complete empty owner conflict snapshot");
});

Deno.test("a timed Event overlap requires an explicit version-bound keep choice", async () => {
  const candidate = resolveLocalDateTimeRange({
    timeZone: "America/Havana",
    start: { localDateTime: "2026-11-24T09:00" },
    end: { localDateTime: "2026-11-24T10:00" },
  });
  const event = {
    id: EVENT_ID,
    updated_at: VERSION,
    title: "Reunión",
    event_status: "confirmed",
    temporal_kind: "fixed_instant",
    starts_at: new Date(Date.parse(candidate.startsAt) + 30 * 60_000).toISOString(),
    ends_at: new Date(Date.parse(candidate.endsAt) + 30 * 60_000).toISOString(),
  };
  const missing = mockContext({ events: [event] });
  const blocked = await handleRequest(request(createPayload()), missing.ctx, {
    now: () => "2026-11-22T18:10:00.000Z",
    newTaskScheduleId: () => SCHEDULE_ID,
  });
  assertEquals(blocked.status, 409, "missing conflict decision status");
  assertEquals((await responseBody(blocked)).error, "TASK_SCHEDULE_CONFLICTS", "missing decision code");
  assertEquals(missing.calls.rpc, 0, "no mutation without explicit choice");

  const accepted = mockContext({ events: [event] });
  const response = await handleRequest(request(createPayload({
    eventDecisions: [{
      eventId: EVENT_ID,
      eventUpdatedAt: VERSION,
      decision: "keep_overlap",
    }],
  }), "019a0000-0000-7000-8000-000000000202"), accepted.ctx, {
    now: () => "2026-11-22T18:10:00.000Z",
    newTaskScheduleId: () => SCHEDULE_ID,
  });
  assertEquals(response.status, 201, "accepted overlap status");
  const patch = (accepted.calls.rpcArgs as Record<string, unknown>).p_schedule_patch as Record<string, unknown>;
  assertEquals((patch.conflict_decisions as unknown[]).length, 1, "explicit Event consent persisted");
  assertEquals((patch.conflict_snapshot as unknown[]).length, 1, "Event version added to snapshot");
});

Deno.test("a hard Protected Time overlap requires its per-occurrence override decision", async () => {
  const candidate = resolveLocalDateTimeRange({
    timeZone: "America/Havana",
    start: { localDateTime: "2026-11-24T09:00" },
    end: { localDateTime: "2026-11-24T10:00" },
  });
  const block = {
    id: BLOCK_ID,
    updated_at: VERSION,
    label: "Sueño",
    category: "sleep",
    protection_mode: "hard",
    pattern_kind: "one_off",
    time_zone: "America/Havana",
    starts_at: new Date(Date.parse(candidate.startsAt) + 30 * 60_000).toISOString(),
    ends_at: new Date(Date.parse(candidate.endsAt) + 30 * 60_000).toISOString(),
    archived_at: null,
    deleted_at: null,
  };
  const blocked = mockContext({ protectedBlocks: [block] });
  const response = await handleRequest(request(createPayload()), blocked.ctx, {
    now: () => "2026-11-22T18:10:00.000Z",
    newTaskScheduleId: () => SCHEDULE_ID,
  });
  assertEquals(response.status, 409, "missing hard-block decision");
  assertEquals((await responseBody(response)).error, "PROTECTED_TIME_CONFLICTS", "Protected Time code");
  assertEquals(blocked.calls.rpc, 0, "hard conflict cannot be ignored");

  const accepted = mockContext({ protectedBlocks: [block] });
  const acceptedResponse = await handleRequest(request(createPayload({
    protectedTimeDecisions: [{
      blockId: BLOCK_ID,
      blockUpdatedAt: VERSION,
      occurrenceStartsAt: block.starts_at,
      decision: "override_hard",
    }],
  }), "019a0000-0000-7000-8000-000000000203"), accepted.ctx, {
    now: () => "2026-11-22T18:10:00.000Z",
    newTaskScheduleId: () => SCHEDULE_ID,
  });
  assertEquals(acceptedResponse.status, 201, "hard conflict override accepted");
  const patch = (accepted.calls.rpcArgs as Record<string, unknown>).p_schedule_patch as Record<string, unknown>;
  assertEquals((patch.conflict_decisions as unknown[]).length, 1, "Protected Time consent persisted");
  assertEquals((patch.conflict_snapshot as unknown[]).length, 1, "Protected Time version added to snapshot");
});

Deno.test("completed idempotent retry replays before timezone and conflict lookups", async () => {
  const intent = await hashTaskScheduleMutationIntent(
    normalizeTaskScheduleMutation(createPayload()),
  );
  const existing = {
    task_schedule_id: SCHEDULE_ID,
    payload_version: intent.version,
    payload_hash: intent.payloadHash,
    response_http_status: 201,
    response_body: { taskScheduleId: SCHEDULE_ID, replayed: false },
  };
  const { ctx, calls } = mockContext({ existing });
  const response = await handleRequest(request(createPayload()), ctx);
  assertEquals(response.status, 201, "replay status");
  assertEquals((await responseBody(response)).replayed, true, "replay marker");
  assertEquals(calls.rpc, 0, "no second write");
  assertEquals(calls.adminTables, ["task_schedule_mutation_request"], "no mutable dependency lookup during replay");
});

Deno.test("unauthenticated requests cannot inspect receipts or write TaskSchedules", async () => {
  const { ctx, calls } = mockContext({ authMode: "anon" });
  const response = await handleRequest(request(createPayload()), ctx);
  assertEquals(response.status, 401, "unauthenticated status");
  assertEquals(calls.adminTables, [], "no admin queries");
  assertEquals(calls.rpc, 0, "no mutation");
});

Deno.test("a weekly protected-time rule is expanded using IANA time for TaskSchedule conflict", async () => {
  const weeklyOccurrence = resolveLocalDateTimeRange({
    timeZone: "America/Havana",
    start: { localDateTime: "2026-11-24T09:30" },
    end: { localDateTime: "2026-11-24T10:30" },
  });
  const block = {
    id: BLOCK_ID,
    updated_at: VERSION,
    label: "Sueño semanal",
    category: "sleep",
    protection_mode: "flexible",
    pattern_kind: "weekly",
    time_zone: "America/Havana",
    start_date: "2026-11-23",
    end_date_exclusive: null,
    weekdays: [1, 2, 3, 4, 5, 6, 7],
    start_time_local: "09:30:00",
    end_time_local: "10:30:00",
    ends_next_day: false,
    archived_at: null,
    deleted_at: null,
  };
  const accepted = mockContext({ protectedBlocks: [block] });
  const response = await handleRequest(request(createPayload({
    protectedTimeDecisions: [{
      blockId: BLOCK_ID,
      blockUpdatedAt: VERSION,
      occurrenceStartsAt: weeklyOccurrence.startsAt,
      decision: "keep_flexible",
    }],
  }), "019a0000-0000-7000-8000-000000000204"), accepted.ctx, {
    now: () => "2026-11-22T18:10:00.000Z",
    newTaskScheduleId: () => SCHEDULE_ID,
  });
  assertEquals(response.status, 201, "weekly conflict consent accepted");
});
