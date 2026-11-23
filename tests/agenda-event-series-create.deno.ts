import { handleRequest } from "../supabase/functions/agenda-event-series-create/handler.ts";
import type { EventAuthenticatedContext } from "../supabase/functions/_shared/agenda-event-profile.ts";
import { resolveLocalDateTimeRange } from "../supabase/functions/agenda-time-resolve/resolver.ts";

const AUTH_USER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PROFILE_ID = "019a0000-0000-7000-8000-000000000001";
const SERIES_ID = "019a0000-0000-7000-8000-000000000501";
const KEY = "019a0000-0000-7000-8000-000000000502";

function assertEquals(actual: unknown, expected: unknown, label: string): void {
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
function request(event: Record<string, unknown>, recurrenceRule: Record<string, unknown>, extras: Record<string, unknown> = {}, key = KEY): Request {
  return new Request("https://local.test/agenda-event-series-create", {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": key },
    body: JSON.stringify({ event, recurrenceRule, ...extras }),
  });
}
function resolvedTimedWindow() {
  return resolveLocalDateTimeRange({
    timeZone: "America/Havana",
    start: {
      localDateTime: "2026-11-24T09:00",
      disambiguation: "earlier",
      gapStrategy: "next-valid",
    },
    end: {
      localDateTime: "2026-11-24T10:00",
      disambiguation: "earlier",
      gapStrategy: "next-valid",
    },
  });
}
function timedEvent(overrides: Record<string, unknown> = {}) {
  return {
    title: "Revisión semanal",
    temporalKind: "zoned_civil",
    startLocalDateTime: "2026-11-24T09:00",
    endLocalDateTime: "2026-11-24T10:00",
    timeZone: "America/Havana",
    ...overrides,
  };
}
function weeklyRule(overrides: Record<string, unknown> = {}) {
  return {
    version: 1,
    frequency: "DAILY",
    interval: 1,
    startDate: "2026-11-24",
    temporalKind: "zoned_civil",
    localTime: "09:00",
    timeZone: "America/Havana",
    durationMinutes: 60,
    disambiguation: "earlier",
    count: 2,
    ...overrides,
  };
}
function makeQuery(data: unknown, error: unknown = null) {
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
  existing = null as Record<string, unknown> | null,
  protectedBlocks = [] as Record<string, unknown>[],
  taskSchedules = [] as Record<string, unknown>[],
  profileStatus = "active",
  rpcResult = [{
    http_status: 201,
    response_body: {
      seriesEventId: SERIES_ID,
      materializedCount: 2,
      horizonStart: "2026-11-24",
      horizonEnd: "2026-11-25",
    },
    replayed: false,
  }],
  rpcError = null as unknown,
}: {
  existing?: Record<string, unknown> | null;
  protectedBlocks?: Record<string, unknown>[];
  taskSchedules?: Record<string, unknown>[];
  profileStatus?: string;
  rpcResult?: unknown;
  rpcError?: unknown;
} = {}) {
  const calls: Record<string, unknown> = {
    profileLookup: 0, ledgerLookup: 0, rpc: 0, rpcName: null, rpcArgs: null,
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
    calendar_event_series_mutation_request: existing,
    protected_time_block: protectedBlocks,
    task_schedule: taskSchedules,
    user_preference: { time_zone: "America/Havana" },
  };
  const supabaseAdmin = {
    from(table: string) {
      if (table === "calendar_event_series_mutation_request") {
        const builder: Record<string, unknown> = {};
        builder.select = () => builder;
        builder.eq = () => builder;
        builder.maybeSingle = async () => {
          calls.ledgerLookup = Number(calls.ledgerLookup) + 1;
          return { data: rows[table], error: null };
        };
        return builder;
      }
      const result = rows[table] ?? [];
      return makeQuery(result);
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

Deno.test("creates timed recurring Event and exactly bounded, authoritative occurrences in one RPC", async () => {
  let occurrenceSequence = 0;
  const { ctx, calls } = mockContext();
  const response = await handleRequest(request(
    timedEvent(),
    weeklyRule(),
    { endLocalTime: "10:00", endDayOffset: 0 },
  ), ctx, {
    now: () => "2026-11-23T12:00:00.000Z",
    newEventId: () => SERIES_ID,
    newOccurrenceId: () => "019a0000-0000-7000-8000-" + String(++occurrenceSequence).padStart(12, "0"),
  });
  assertEquals(response.status, 201, "create status");
  assertEquals((await responseBody(response)).materializedCount, 2, "materialized occurrence count");
  assertEquals(calls.rpc, 1, "atomic series RPC count");
  assertEquals(calls.rpcName, "create_recurring_calendar_event_once", "RPC name");
  const args = calls.rpcArgs as Record<string, unknown>;
  assertEquals(args.p_owner_user_id, PROFILE_ID, "owner from verified profile");
  assertEquals(args.p_idempotency_key, KEY, "idempotency key");
  const series = args.p_event_record as Record<string, unknown>;
  assertEquals(series.owner_user_id, PROFILE_ID, "series owner");
  assertEquals(series.recurrence_rule && (series.recurrence_rule as Record<string, unknown>).frequency,
    "DAILY", "versioned recurrence rule");
  assertEquals(series.recurrence_end_local_time, "10:00:00.000", "explicit local end clock");
  assertEquals(series.recurrence_end_day_offset, 0, "explicit calendar end offset");
  assertEquals(Object.keys(series).length, 34, "exact series RPC record shape");
  const rows = args.p_occurrence_rows as Array<Record<string, unknown>>;
  assertEquals(rows.length, 2, "one row per generated slot");
  assert(rows.every((row) => row.temporal_kind === "zoned_civil"
    && row.resolver_metadata && (row.resolver_metadata as Record<string, unknown>).authoritative === true
    && typeof row.starts_at === "string" && typeof row.ends_at === "string"
    && Date.parse(String(row.ends_at)) > Date.parse(String(row.starts_at))),
  "each timed row must contain a positive authoritative UTC interval");
  assert(rows[0].occurrence_key !== rows[1].occurrence_key, "occurrence keys must be stable and unique");
});

Deno.test("creates date-only all-day recurrence without inventing UTC instants", async () => {
  const { ctx, calls } = mockContext();
  const response = await handleRequest(request(
    {
      title: "Fin de semana",
      temporalKind: "all_day",
      startDate: "2026-11-24",
      endDateExclusive: "2026-11-26",
    },
    {
      version: 1,
      frequency: "DAILY",
      interval: 1,
      startDate: "2026-11-24",
      temporalKind: "all_day",
      count: 2,
    },
    { endDayOffset: 1 },
  ), ctx, {
    now: () => "2026-11-23T12:00:00.000Z",
    newEventId: () => SERIES_ID,
    newOccurrenceId: () => "019a0000-0000-7000-8000-000000000601",
  });
  assertEquals(response.status, 201, "all-day create status");
  const rows = (calls.rpcArgs as Record<string, unknown>).p_occurrence_rows as Array<Record<string, unknown>>;
  assertEquals(rows.length, 2, "all-day occurrence count");
  assertEquals(rows.map((row) => row.end_date_exclusive),
    ["2026-11-26", "2026-11-27"], "each all-day occurrence keeps its own exclusive end date");
  assert(rows.every((row) => row.temporal_kind === "all_day"
    && row.starts_at === null && row.ends_at === null
    && row.start_local === null && row.time_zone === null),
  "all-day occurrences must remain date-only without artificial UTC instants");
});

Deno.test("rejects Protected Time and TaskSchedule overlaps before the atomic write", async () => {
  // Derive fixture instants from the same pinned IANA authority as the writer.
  // This remains valid when local political decisions change the zone offset.
  const candidate = resolvedTimedWindow();
  const block = {
    id: "019a0000-0000-7000-8000-000000000701",
    updated_at: "2026-11-22T10:00:00.000000Z",
    label: "Descanso",
    category: "personal",
    protection_mode: "hard",
    pattern_kind: "one_off",
    time_zone: "America/Havana",
    starts_at: new Date(Date.parse(candidate.startsAt) + 30 * 60_000).toISOString(),
    ends_at: candidate.endsAt,
    archived_at: null,
    deleted_at: null,
  };
  const { ctx, calls } = mockContext({ protectedBlocks: [block] });
  const response = await handleRequest(request(
    timedEvent(),
    weeklyRule(),
    { endLocalTime: "10:00", endDayOffset: 0 },
  ), ctx, {
    now: () => "2026-11-23T12:00:00.000Z",
    newEventId: () => SERIES_ID,
    newOccurrenceId: () => "019a0000-0000-7000-8000-000000000801",
  });
  assertEquals(response.status, 409, "Protected Time conflict status");
  assertEquals((await responseBody(response)).error, "PROTECTED_TIME_CONFLICTS", "conflict code");
  assertEquals(calls.rpc, 0, "conflicted series must not reach persistence");
});

Deno.test("rejects a TaskSchedule overlap before the atomic write", async () => {
  const candidate = resolvedTimedWindow();
  const schedule = {
    id: "019a0000-0000-7000-8000-000000000711",
    updated_at: "2026-11-22T10:00:00.000000Z",
    starts_at: new Date(Date.parse(candidate.startsAt) + 30 * 60_000).toISOString(),
    ends_at: candidate.endsAt,
    time_zone: "America/Havana",
    schedule_status: "confirmed",
  };
  const { ctx, calls } = mockContext({ taskSchedules: [schedule] });
  const response = await handleRequest(request(
    timedEvent(),
    weeklyRule(),
    { endLocalTime: "10:00", endDayOffset: 0 },
  ), ctx, {
    now: () => "2026-11-23T12:00:00.000Z",
    newEventId: () => SERIES_ID,
    newOccurrenceId: () => "019a0000-0000-7000-8000-000000000812",
  });
  assertEquals(response.status, 409, "TaskSchedule conflict status");
  assertEquals((await responseBody(response)).error, "TASK_SCHEDULE_CONFLICTS", "conflict code");
  assertEquals(calls.rpc, 0, "conflicted series must not reach persistence");
});

Deno.test("returns the idempotent recurring-series receipt without resolving or writing twice", async () => {
  const first = mockContext();
  const deps = {
    now: () => "2026-11-23T12:00:00.000Z",
    newEventId: () => SERIES_ID,
    newOccurrenceId: () => "019a0000-0000-7000-8000-000000000901",
  };
  const input = request(timedEvent(), weeklyRule(), { endLocalTime: "10:00", endDayOffset: 0 });
  const firstResponse = await handleRequest(input, first.ctx, deps);
  assertEquals(firstResponse.status, 201, "first create");
  const hash = (first.calls.rpcArgs as Record<string, unknown>).p_payload_hash_hex;
  const existing = {
    payload_version: "recurring-event-create-v1",
    payload_hash: "\\x" + String(hash),
    response_http_status: 201,
    response_body: {
      seriesEventId: SERIES_ID,
      materializedCount: 2,
      horizonStart: "2026-11-24",
      horizonEnd: "2026-11-25",
    },
  };
  const second = mockContext({ existing });
  const replay = await handleRequest(request(timedEvent(), weeklyRule(), {
    endLocalTime: "10:00", endDayOffset: 0,
  }), second.ctx, deps);
  assertEquals(replay.status, 201, "replay status");
  assertEquals((await responseBody(replay)).replayed, true, "replay marker");
  assertEquals(second.calls.rpc, 0, "replay must not call the writer RPC");
});

Deno.test("inactive profiles cannot read receipts or create a recurring series", async () => {
  const { ctx, calls } = mockContext({ profileStatus: "disabled" });
  const response = await handleRequest(request(
    timedEvent(), weeklyRule(), { endLocalTime: "10:00", endDayOffset: 0 },
  ), ctx);
  assertEquals(response.status, 403, "inactive profile status");
  assertEquals(calls.ledgerLookup, 0, "receipt lookup must not run");
  assertEquals(calls.rpc, 0, "no series creation");
});
