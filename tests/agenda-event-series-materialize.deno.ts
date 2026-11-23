import { handleRequest } from "../supabase/functions/agenda-event-series-materialize/handler.ts";
import type { EventAuthenticatedContext } from "../supabase/functions/_shared/agenda-event-profile.ts";
import { resolveLocalDateTimeRange } from "../supabase/functions/agenda-time-resolve/resolver.ts";

const AUTH_USER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PROFILE_ID = "019a0000-0000-7000-8000-000000000001";
const SERIES_ID = "019a0000-0000-7000-8000-000000000501";
const NOW = "2026-11-23T12:00:00.000Z";

function assertEquals(actual: unknown, expected: unknown, label: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(label + ": expected " + JSON.stringify(expected) + ", received " + JSON.stringify(actual));
  }
}
function assert(condition: unknown, label: string): asserts condition {
  if (!condition) throw new Error(label);
}
async function body(response: Response): Promise<Record<string, unknown>> {
  return await response.json() as Record<string, unknown>;
}
function makeQuery(data: unknown, error: unknown = null) {
  const result = { data, error };
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "eq", "is", "in", "order", "limit", "gte", "lt"]) {
    builder[method] = () => builder;
  }
  builder.maybeSingle = async () => result;
  builder.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return builder;
}
function request(seriesIds: string[] = [SERIES_ID]) {
  return new Request("https://local.test/agenda-event-series-materialize", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ seriesIds }),
  });
}
function series() {
  return {
    id: SERIES_ID,
    owner_user_id: PROFILE_ID,
    event_status: "confirmed",
    archived_at: null,
    deleted_at: null,
    temporal_kind: "all_day",
    start_date: "2026-11-23",
    end_date_exclusive: "2026-11-24",
    recurrence_rule: {
      version: 1,
      frequency: "DAILY",
      interval: 1,
      startDate: "2026-11-23",
      temporalKind: "all_day",
      count: 3,
    },
    recurrence_end_local_time: null,
    recurrence_end_day_offset: 0,
  };
}
function mockContext({
  existingRows = [] as Record<string, unknown>[],
  protectedBlocks = [] as Record<string, unknown>[],
  taskSchedules = [] as Record<string, unknown>[],
  profileStatus = "active",
}: {
  existingRows?: Record<string, unknown>[];
  protectedBlocks?: Record<string, unknown>[];
  taskSchedules?: Record<string, unknown>[];
  profileStatus?: string;
} = {}) {
  const calls: Record<string, unknown> = {
    profileLookup: 0,
    rpc: 0,
    rpcName: null,
    rpcArgs: null,
    occurrenceLookup: 0,
  };
  const supabase = {
    from(table: string) {
      if (table !== "user_profile") throw new Error("unexpected user table " + table);
      return {
        select() {
          return {
            eq() {
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
  const rows: Record<string, unknown> = {
    user_preference: { time_zone: "America/Havana" },
    protected_time_block: protectedBlocks,
    task_schedule: taskSchedules,
    calendar_event: series(),
    calendar_event_occurrence: existingRows,
  };
  const supabaseAdmin = {
    from(table: string) {
      if (table === "calendar_event_occurrence") {
        calls.occurrenceLookup = Number(calls.occurrenceLookup) + 1;
      }
      return makeQuery(rows[table] ?? []);
    },
    async rpc(name: string, args: Record<string, unknown>) {
      calls.rpc = Number(calls.rpc) + 1;
      calls.rpcName = name;
      calls.rpcArgs = args;
      return { data: (args.p_occurrence_rows as unknown[]).length, error: null };
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

Deno.test("authenticated rolling-horizon top-up inserts only missing date-only occurrences in one bounded RPC", async () => {
  let sequence = 0;
  const { ctx, calls } = mockContext();
  const response = await handleRequest(request(), ctx, {
    now: () => NOW,
    newOccurrenceId: () => "019a0000-0000-7000-8000-" + String(++sequence).padStart(12, "0"),
  });
  assertEquals(response.status, 200, "top-up status");
  assertEquals(await body(response), {
    processedSeriesCount: 1,
    materializedCount: 3,
    horizonDays: 90,
  }, "top-up receipt");
  assertEquals(calls.rpc, 1, "one atomic materialization RPC");
  assertEquals(calls.rpcName, "materialize_recurring_calendar_event_once", "materialization RPC name");
  const args = calls.rpcArgs as Record<string, unknown>;
  assertEquals(args.p_owner_user_id, PROFILE_ID, "server-derived owner");
  assertEquals(args.p_series_event_id, SERIES_ID, "series id");
  assertEquals(args.p_materialization_date, "2026-11-23", "Havana materialization date");
  const rows = args.p_occurrence_rows as Array<Record<string, unknown>>;
  assertEquals(rows.length, 3, "missing occurrence count");
  assertEquals(rows.map((row) => row.original_local_date), [
    "2026-11-23", "2026-11-24", "2026-11-25",
  ], "bounded local dates");
  assert(rows.every((row) => row.temporal_kind === "all_day"
    && row.starts_at === null && row.ends_at === null
    && row.start_date === row.actual_local_date),
  "all-day top-up must remain date-only");
  assertEquals(args.p_protected_time_snapshot, [], "empty protected snapshot");
  assertEquals(args.p_task_schedule_snapshot, [], "empty TaskSchedule snapshot");
});

Deno.test("top-up never rewrites an existing cancelled/overridden occurrence and is retry-safe", async () => {
  const existing = {
    id: "019a0000-0000-7000-8000-000000000601",
    occurrence_key: "v1:" + SERIES_ID + ":2026-11-23:ALL_DAY",
    original_local_date: "2026-11-23",
    actual_local_date: "2026-11-23",
    temporal_kind: "all_day",
    start_date: "2026-11-23",
    end_date_exclusive: "2026-11-24",
    occurrence_status: "cancelled",
    override_kind: "cancelled",
    review_candidate: null,
  };
  const { ctx, calls } = mockContext({ existingRows: [existing] });
  const response = await handleRequest(request(), ctx, {
    now: () => NOW,
    newOccurrenceId: () => "019a0000-0000-7000-8000-000000000602",
  });
  assertEquals(response.status, 200, "partial top-up status");
  const args = calls.rpcArgs as Record<string, unknown>;
  const rows = args.p_occurrence_rows as Array<Record<string, unknown>>;
  assertEquals(rows.map((row) => row.original_local_date), ["2026-11-24", "2026-11-25"],
    "only missing dates are inserted");
  assertEquals(rows.some((row) => row.occurrence_key === existing.occurrence_key), false,
    "existing cancelled key is never recreated");
  assertEquals((await body(response)).materializedCount, 2, "only missing rows reported");
});

Deno.test("Protected Time conflict blocks top-up before any occurrence write", async () => {
  const resolved = resolveLocalDateTimeRange({
    timeZone: "America/Havana",
    start: { localDateTime: "2026-11-23T00:00", disambiguation: "earlier", gapStrategy: "next-valid" },
    end: { localDateTime: "2026-11-24T00:00", disambiguation: "earlier", gapStrategy: "next-valid" },
  });
  const block = {
    id: "019a0000-0000-7000-8000-000000000701",
    updated_at: "2026-11-22T10:00:00.000000Z",
    label: "Descanso",
    category: "personal",
    protection_mode: "hard",
    pattern_kind: "one_off",
    time_zone: "America/Havana",
    starts_at: resolved.startsAt,
    ends_at: resolved.endsAt,
    archived_at: null,
    deleted_at: null,
  };
  const { ctx, calls } = mockContext({ protectedBlocks: [block] });
  const response = await handleRequest(request(), ctx, { now: () => NOW });
  assertEquals(response.status, 409, "Protected Time conflict status");
  assertEquals((await body(response)).error, "PROTECTED_TIME_CONFLICTS", "conflict code");
  assertEquals(calls.rpc, 0, "conflicted occurrence must not reach persistence");
});

Deno.test("TaskSchedule overlap blocks a timed recurring top-up before the atomic write", async () => {
  const candidate = resolveLocalDateTimeRange({
    timeZone: "America/Havana",
    start: { localDateTime: "2026-11-23T00:00", disambiguation: "earlier", gapStrategy: "next-valid" },
    end: { localDateTime: "2026-11-24T00:00", disambiguation: "earlier", gapStrategy: "next-valid" },
  });
  const taskSchedule = {
    id: "019a0000-0000-7000-8000-000000000721",
    updated_at: "2026-11-22T10:00:00.000000Z",
    starts_at: new Date(Date.parse(candidate.startsAt) + 30 * 60_000).toISOString(),
    ends_at: new Date(Date.parse(candidate.startsAt) + 60 * 60_000).toISOString(),
    time_zone: "America/Havana",
    schedule_status: "confirmed",
  };
  const { ctx, calls } = mockContext({ taskSchedules: [taskSchedule] });
  const response = await handleRequest(request(), ctx, { now: () => NOW });
  assertEquals(response.status, 409, "TaskSchedule conflict status");
  assertEquals((await body(response)).error, "TASK_SCHEDULE_CONFLICTS", "conflict code");
  assertEquals(calls.rpc, 0, "conflicted top-up must not reach persistence");
});

Deno.test("inactive profiles cannot read recurring rows or top up the materialization horizon", async () => {
  const { ctx, calls } = mockContext({ profileStatus: "disabled" });
  const response = await handleRequest(request(), ctx, { now: () => NOW });
  assertEquals(response.status, 403, "inactive profile status");
  assertEquals(calls.occurrenceLookup, 0, "no occurrence lookup");
  assertEquals(calls.rpc, 0, "no materialization write");
});

Deno.test("top-up rejects duplicate series IDs and unbounded requests", async () => {
  const { ctx } = mockContext();
  const duplicate = await handleRequest(request([SERIES_ID, SERIES_ID]), ctx, { now: () => NOW });
  assertEquals(duplicate.status, 422, "duplicate series ids");
  const tooMany = await handleRequest(request([
    SERIES_ID,
    "019a0000-0000-7000-8000-000000000502",
    "019a0000-0000-7000-8000-000000000503",
    "019a0000-0000-7000-8000-000000000504",
    "019a0000-0000-7000-8000-000000000505",
    "019a0000-0000-7000-8000-000000000506",
  ]), ctx, { now: () => NOW });
  assertEquals(tooMany.status, 422, "too many series ids");
});
