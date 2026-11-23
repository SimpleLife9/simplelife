import { handleRequest } from "../supabase/functions/agenda-event-occurrence-mutate/handler.ts";
import type { EventAuthenticatedContext } from "../supabase/functions/_shared/agenda-event-profile.ts";
import { resolveLocalDateTimeRange } from "../supabase/functions/agenda-time-resolve/resolver.ts";

const AUTH_USER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PROFILE_ID = "019a0000-0000-7000-8000-000000000001";
const OCCURRENCE_ID = "019a0000-0000-7000-8000-000000000501";
const SERIES_ID = "019a0000-0000-7000-8000-000000000502";
const KEY = "019a0000-0000-7000-8000-000000000503";

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
function request(
  input: Record<string, unknown>,
  key = KEY,
): Request {
  return new Request("https://local.test/agenda-event-occurrence-mutate", {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": key },
    body: JSON.stringify(input),
  });
}
function timedOccurrence() {
  const range = resolveLocalDateTimeRange({
    timeZone: "America/Havana",
    start: { localDateTime: "2026-11-24T09:00", disambiguation: "earlier", gapStrategy: "next-valid" },
    end: { localDateTime: "2026-11-24T10:00", disambiguation: "earlier", gapStrategy: "next-valid" },
  });
  return {
    id: OCCURRENCE_ID,
    owner_user_id: PROFILE_ID,
    created_by_user_id: PROFILE_ID,
    updated_by_user_id: PROFILE_ID,
    calendar_event_id: SERIES_ID,
    occurrence_key: "v1:" + SERIES_ID + ":2026-11-24:09:00:00.000",
    original_local_date: "2026-11-24",
    original_local_time: "09:00:00",
    actual_local_date: "2026-11-24",
    actual_local_time: "09:00:00",
    temporal_kind: "zoned_civil",
    start_date: null,
    end_date_exclusive: null,
    start_local: "2026-11-24T09:00:00",
    end_local: "2026-11-24T10:00:00",
    time_zone: "America/Havana",
    starts_at: range.startsAt,
    ends_at: range.endsAt,
    start_disambiguation: "earlier",
    end_disambiguation: "earlier",
    start_gap_strategy: "next-valid",
    end_gap_strategy: "next-valid",
    resolver_metadata: {
      rulesSource: range.rulesSource,
      rulesVersion: range.rulesVersion,
      resolverVersion: range.resolverVersion,
      authoritative: true,
      start: range.start,
      end: range.end,
    },
    occurrence_status: "scheduled",
    override_kind: null,
    review_candidate: null,
    row_version: 4,
    created_at: "2026-11-20T12:00:00.000Z",
    updated_at: "2026-11-22T12:00:00.000Z",
  };
}
function allDayOccurrence() {
  return {
    id: OCCURRENCE_ID,
    owner_user_id: PROFILE_ID,
    created_by_user_id: PROFILE_ID,
    updated_by_user_id: PROFILE_ID,
    calendar_event_id: SERIES_ID,
    occurrence_key: "v1:" + SERIES_ID + ":2026-11-24:ALL_DAY",
    original_local_date: "2026-11-24",
    original_local_time: null,
    actual_local_date: "2026-11-24",
    actual_local_time: null,
    temporal_kind: "all_day",
    start_date: "2026-11-24",
    end_date_exclusive: "2026-11-26",
    start_local: null,
    end_local: null,
    time_zone: null,
    starts_at: null,
    ends_at: null,
    start_disambiguation: null,
    end_disambiguation: null,
    start_gap_strategy: null,
    end_gap_strategy: null,
    resolver_metadata: null,
    occurrence_status: "scheduled",
    override_kind: null,
    review_candidate: null,
    row_version: 2,
    created_at: "2026-11-20T12:00:00.000Z",
    updated_at: "2026-11-22T12:00:00.000Z",
  };
}
function mockContext({
  occurrence = timedOccurrence(),
  existingReceipt = null as Record<string, unknown> | null,
  profileStatus = "active",
}: {
  occurrence?: Record<string, unknown>;
  existingReceipt?: Record<string, unknown> | null;
  profileStatus?: string;
} = {}) {
  const calls: Record<string, unknown> = {
    profileLookup: 0,
    occurrenceLookup: 0,
    receiptLookup: 0,
    rpc: 0,
    rpcArgs: null,
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
  const supabaseAdmin = {
    from(table: string) {
      const builder: Record<string, unknown> = {};
      for (const method of ["select", "eq", "is", "in", "order", "limit"]) {
        builder[method] = () => builder;
      }
      builder.maybeSingle = async () => {
        if (table === "calendar_event_occurrence_mutation_request") {
          calls.receiptLookup = Number(calls.receiptLookup) + 1;
          return { data: existingReceipt, error: null };
        }
        if (table === "calendar_event_occurrence") {
          calls.occurrenceLookup = Number(calls.occurrenceLookup) + 1;
          return { data: occurrence, error: null };
        }
        if (table === "user_preference") {
          return { data: { time_zone: "America/Havana" }, error: null };
        }
        throw new Error("unexpected admin table " + table);
      };
      builder.then = (
        resolve: (value: unknown) => unknown,
        reject: (reason: unknown) => unknown,
      ) => Promise.resolve({ data: [], error: null }).then(resolve, reject);
      return builder;
    },
    async rpc(name: string, args: Record<string, unknown>) {
      calls.rpc = Number(calls.rpc) + 1;
      calls.rpcArgs = { name, ...args };
      return {
        data: [{
          http_status: 200,
          response_body: {
            occurrenceId: OCCURRENCE_ID,
            seriesEventId: SERIES_ID,
            occurrenceStatus: args.p_occurrence_patch && (args.p_occurrence_patch as Record<string, unknown>).occurrence_status,
            overrideKind: args.p_occurrence_patch && (args.p_occurrence_patch as Record<string, unknown>).override_kind,
            rowVersion: Number((occurrence as Record<string, unknown>).row_version) + 1,
            updatedAt: "2026-11-23T12:00:00.000Z",
          },
          replayed: false,
        }],
        error: null,
      };
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

Deno.test("cancels one recurring occurrence without changing its original slot or series identity", async () => {
  const original = allDayOccurrence();
  const { ctx, calls } = mockContext({ occurrence: original });
  const response = await handleRequest(request({
    occurrenceId: OCCURRENCE_ID,
    expectedRowVersion: 2,
    action: "cancel",
  }), ctx, { now: () => "2026-11-23T12:00:00.000Z" });
  assertEquals(response.status, 200, "cancel status");
  assertEquals((await body(response)).overrideKind, "cancelled", "cancel override");
  const args = calls.rpcArgs as Record<string, unknown>;
  const patch = args.p_occurrence_patch as Record<string, unknown>;
  assertEquals(patch.occurrence_status, "cancelled", "cancel lifecycle status");
  assertEquals(patch.override_kind, "cancelled", "cancel override kind");
  assertEquals(args.p_owner_user_id, PROFILE_ID, "owner derived from verified profile");
  assertEquals(args.p_expected_row_version, 2, "expected row version");
  assertEquals(calls.rpc, 1, "one atomic mutation RPC");
  assertEquals(original.occurrence_key, "v1:" + SERIES_ID + ":2026-11-24:ALL_DAY", "stable occurrence key");
});

Deno.test("moves one timed occurrence through the pinned IANA resolver and keeps its stable original identity", async () => {
  const original = timedOccurrence();
  const { ctx, calls } = mockContext({ occurrence: original });
  const response = await handleRequest(request({
    occurrenceId: OCCURRENCE_ID,
    expectedRowVersion: 4,
    action: "move",
    actualLocalDate: "2026-11-25",
    actualLocalTime: "11:30",
  }), ctx, { now: () => "2026-11-23T12:00:00.000Z" });
  assertEquals(response.status, 200, "move status");
  const args = calls.rpcArgs as Record<string, unknown>;
  const patch = args.p_occurrence_patch as Record<string, unknown>;
  assertEquals(patch.override_kind, "moved", "move override kind");
  assertEquals(patch.actual_local_date, "2026-11-25", "effective moved date");
  assertEquals(patch.actual_local_time, "11:30:00.000", "effective moved clock");
  assertEquals(patch.start_local, "2026-11-25T11:30:00.000", "resolved local start");
  assert(typeof patch.starts_at === "string" && typeof patch.ends_at === "string"
    && Date.parse(String(patch.ends_at)) > Date.parse(String(patch.starts_at)),
  "moved occurrence must receive a positive authoritative UTC interval");
  assertEquals((patch.resolver_metadata as Record<string, unknown>).authoritative, true,
    "authoritative resolver metadata");
  assertEquals(original.occurrence_key, "v1:" + SERIES_ID + ":2026-11-24:09:00:00.000",
    "original occurrence identity remains unchanged");
});

Deno.test("modifies one all-day occurrence duration without changing its original start slot", async () => {
  const original = allDayOccurrence();
  const { ctx, calls } = mockContext({ occurrence: original });
  const response = await handleRequest(request({
    occurrenceId: OCCURRENCE_ID,
    expectedRowVersion: 2,
    action: "modify",
    endDateExclusive: "2026-11-27",
  }), ctx, { now: () => "2026-11-23T12:00:00.000Z" });
  assertEquals(response.status, 200, "modify status");
  const patch = (calls.rpcArgs as Record<string, unknown>).p_occurrence_patch as Record<string, unknown>;
  assertEquals(patch.override_kind, "modified", "modify override kind");
  assertEquals(patch.end_date_exclusive, "2026-11-27", "modified exclusive end");
  assertEquals(patch.actual_local_date, "2026-11-24", "original effective start remains unchanged");
});

Deno.test("replays a completed occurrence mutation before reading or resolving the row", async () => {
  const { ctx, calls } = mockContext({
    existingReceipt: {
      occurrence_id: OCCURRENCE_ID,
      payload_version: "recurring-occurrence-mutate-v1",
      payload_hash: "not-a-matching-hash",
      response_http_status: 200,
      response_body: { occurrenceId: OCCURRENCE_ID, occurrenceStatus: "cancelled" },
    },
  });
  const response = await handleRequest(request({
    occurrenceId: OCCURRENCE_ID,
    expectedRowVersion: 2,
    action: "cancel",
  }), ctx, { now: () => "2026-11-23T12:00:00.000Z" });
  assertEquals(response.status, 409, "changed/reused key status");
  assertEquals(calls.occurrenceLookup, 0, "receipt check precedes mutable row lookup");
  assertEquals(calls.rpc, 0, "no second write");
});

Deno.test("inactive profiles cannot read occurrence receipts or mutate occurrences", async () => {
  const { ctx, calls } = mockContext({ profileStatus: "disabled" });
  const response = await handleRequest(request({
    occurrenceId: OCCURRENCE_ID,
    expectedRowVersion: 4,
    action: "cancel",
  }), ctx, { now: () => "2026-11-23T12:00:00.000Z" });
  assertEquals(response.status, 403, "inactive profile status");
  assertEquals(calls.receiptLookup, 0, "no receipt lookup");
  assertEquals(calls.occurrenceLookup, 0, "no occurrence lookup");
  assertEquals(calls.rpc, 0, "no mutation");
});
