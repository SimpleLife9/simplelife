import { handleRequest } from "../supabase/functions/agenda-event-series-mutate/handler.ts";
import type { EventAuthenticatedContext } from "../supabase/functions/_shared/agenda-event-profile.ts";

const AUTH_USER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PROFILE_ID = "019a0000-0000-7000-8000-000000000001";
const SERIES_ID = "019a0000-0000-7000-8000-000000000501";
const SELECTED_OCCURRENCE_ID = "019a0000-0000-7000-8000-000000000502";
const CHILD_SERIES_ID = "019a0000-0000-7000-8000-000000000503";
const NOW = "2026-11-23T12:00:00.000Z";
const SELECTED_DATE = "2026-11-24";
const EXPECTED_UPDATED_AT = "2026-11-23T11:00:00.000000Z";
const KEY = "019a0000-0000-7000-8000-000000000504";

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
function makeQuery(data: unknown, error: unknown = null) {
  const result = { data, error };
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "eq", "is", "in", "order", "limit"]) builder[method] = () => builder;
  builder.maybeSingle = async () => result;
  builder.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return builder;
}
function currentSeries(overrides: Record<string, unknown> = {}) {
  return {
    id: SERIES_ID,
    owner_user_id: PROFILE_ID,
    created_by_user_id: PROFILE_ID,
    updated_by_user_id: PROFILE_ID,
    created_at: "2026-11-20T10:00:00.000Z",
    updated_at: EXPECTED_UPDATED_AT,
    title: "Daily check-in",
    description: null,
    location_label: null,
    location_kind: null,
    event_status: "confirmed",
    temporal_kind: "all_day",
    start_date: SELECTED_DATE,
    end_date_exclusive: "2026-11-25",
    recurrence_rule: {
      version: 1,
      frequency: "DAILY",
      interval: 1,
      startDate: SELECTED_DATE,
      temporalKind: "all_day",
      count: 4,
    },
    recurrence_end_local_time: null,
    recurrence_end_day_offset: 0,
    recurrence_effective_from: null,
    recurrence_effective_through: null,
    recurrence_parent_event_id: null,
    recurrence_inherited_occurrence_id: null,
    archived_at: null,
    deleted_at: null,
    ...overrides,
  };
}
function selectedOccurrence(overrides: Record<string, unknown> = {}) {
  return {
    id: SELECTED_OCCURRENCE_ID,
    owner_user_id: PROFILE_ID,
    created_by_user_id: PROFILE_ID,
    updated_by_user_id: PROFILE_ID,
    calendar_event_id: SERIES_ID,
    occurrence_key: "v1:" + SERIES_ID + ":" + SELECTED_DATE + ":ALL_DAY",
    original_local_date: SELECTED_DATE,
    original_local_time: null,
    actual_local_date: SELECTED_DATE,
    actual_local_time: null,
    temporal_kind: "all_day",
    start_date: SELECTED_DATE,
    end_date_exclusive: "2026-11-25",
    start_local: null,
    end_local: null,
    time_zone: null,
    starts_at: null,
    ends_at: null,
    occurrence_status: "scheduled",
    override_kind: null,
    review_candidate: null,
    row_version: 1,
    updated_at: "2026-11-23T11:00:00.000000Z",
    ...overrides,
  };
}
function editRequest(scope: "entire_series" | "this_and_following" = "entire_series", changes: Record<string, unknown> = {}, key = KEY) {
  return new Request("https://local.test/agenda-event-series-mutate", {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": key },
    body: JSON.stringify({
      seriesId: SERIES_ID,
      expectedUpdatedAt: EXPECTED_UPDATED_AT,
      selectedOccurrenceId: SELECTED_OCCURRENCE_ID,
      scope,
      event: {
        title: "Revised family check-in",
        temporalKind: "all_day",
        startDate: SELECTED_DATE,
        endDateExclusive: "2026-11-25",
      },
      recurrenceRule: {
        version: 1,
        frequency: "DAILY",
        interval: 2,
        startDate: SELECTED_DATE,
        temporalKind: "all_day",
        count: 3,
      },
      endLocalTime: null,
      endDayOffset: 0,
      ...changes,
    }),
  });
}
function mockContext({
  receipt = null as Record<string, unknown> | null,
  blocks = [] as Record<string, unknown>[],
  schedules = [] as Record<string, unknown>[],
  profileStatus = "active",
}: {
  receipt?: Record<string, unknown> | null;
  blocks?: Record<string, unknown>[];
  schedules?: Record<string, unknown>[];
  profileStatus?: string;
} = {}) {
  const calls: Record<string, unknown> = {
    receiptLookup: 0,
    seriesLookup: 0,
    occurrenceLookup: 0,
    rpc: 0,
    rpcName: null,
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
    calendar_event_series_edit_request: receipt,
    calendar_event: currentSeries(),
    calendar_event_occurrence: selectedOccurrence(),
    user_preference: { time_zone: "America/Havana" },
    protected_time_block: blocks,
    task_schedule: schedules,
  };
  const supabaseAdmin = {
    from(table: string) {
      if (table === "calendar_event_series_edit_request") calls.receiptLookup = Number(calls.receiptLookup) + 1;
      if (table === "calendar_event") calls.seriesLookup = Number(calls.seriesLookup) + 1;
      if (table === "calendar_event_occurrence") calls.occurrenceLookup = Number(calls.occurrenceLookup) + 1;
      return makeQuery(rows[table] === undefined ? [] : rows[table]);
    },
    async rpc(name: string, args: Record<string, unknown>) {
      calls.rpc = Number(calls.rpc) + 1;
      calls.rpcName = name;
      calls.rpcArgs = args;
      return {
        data: [{
          http_status: 200,
          response_body: {
            seriesEventId: SERIES_ID,
            scope: args.p_scope,
            childSeriesEventId: args.p_scope === "this_and_following" ? CHILD_SERIES_ID : null,
            selectedOccurrenceId: SELECTED_OCCURRENCE_ID,
            materializedCount: (args.p_occurrence_rows as unknown[]).length,
            supersededCount: 1,
            updatedAt: "2026-11-23T12:00:00.000000Z",
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

Deno.test("entire-series scope sends one atomic owner-scoped patch and future reconciliation batch", async () => {
  const { ctx, calls } = mockContext();
  const response = await handleRequest(editRequest("entire_series"), ctx, {
    now: () => NOW,
    newOccurrenceId: () => "019a0000-0000-7000-8000-000000000601",
  });
  assertEquals(response.status, 200, "entire-series status");
  assertEquals(calls.rpc, 1, "single atomic RPC");
  assertEquals(calls.rpcName, "mutate_recurring_calendar_event_once", "series edit RPC");
  const args = calls.rpcArgs as Record<string, unknown>;
  assertEquals(args.p_owner_user_id, PROFILE_ID, "verified owner");
  assertEquals(args.p_series_event_id, SERIES_ID, "series ID");
  assertEquals(args.p_scope, "entire_series", "scope");
  assertEquals(args.p_selected_occurrence_id, SELECTED_OCCURRENCE_ID, "selected occurrence ID");
  assertEquals(args.p_new_series_record, null, "entire series has no child record");
  const patch = args.p_series_patch as Record<string, unknown>;
  assertEquals((patch.recurrence_rule as Record<string, unknown>).startDate, SELECTED_DATE, "future rule anchor");
  assertEquals(patch.recurrence_effective_from, SELECTED_DATE, "effective boundary");
  const rows = args.p_occurrence_rows as Array<Record<string, unknown>>;
  assertEquals(rows.map((row) => row.original_local_date), [
    "2026-11-24", "2026-11-26", "2026-11-28",
  ], "only replacement future slots are materialized");
  assert(rows.every((row) => row.calendar_event_id === SERIES_ID), "replacement rows remain in the same series");
});

Deno.test("this-and-following scope creates a linked child and excludes the selected inherited occurrence", async () => {
  const { ctx, calls } = mockContext();
  const response = await handleRequest(editRequest("this_and_following"), ctx, {
    now: () => NOW,
    newSeriesId: () => CHILD_SERIES_ID,
    newOccurrenceId: () => "019a0000-0000-7000-8000-000000000701",
  });
  assertEquals(response.status, 200, "split status");
  const args = calls.rpcArgs as Record<string, unknown>;
  assertEquals(args.p_scope, "this_and_following", "split scope");
  const parentPatch = args.p_series_patch as Record<string, unknown>;
  assertEquals(parentPatch.recurrence_effective_through, SELECTED_DATE, "old segment boundary");
  const child = args.p_new_series_record as Record<string, unknown>;
  assertEquals(child.id, CHILD_SERIES_ID, "new child ID");
  assertEquals(child.recurrence_parent_event_id, SERIES_ID, "parent series link");
  assertEquals(child.recurrence_inherited_occurrence_id, SELECTED_OCCURRENCE_ID, "inherited selected occurrence link");
  assertEquals(child.recurrence_effective_from, SELECTED_DATE, "child starts at selected date");
  const rule = child.recurrence_rule as Record<string, unknown>;
  assertEquals(rule.startDate, SELECTED_DATE, "child rule anchor");
  assertEquals(rule.excludedDates, [SELECTED_DATE], "selected occurrence is not duplicated in child");
  const rows = args.p_occurrence_rows as Array<Record<string, unknown>>;
  assertEquals(rows.map((row) => row.original_local_date), [
    "2026-11-26", "2026-11-28",
  ], "child rows begin after selected occurrence");
  assert(rows.every((row) => row.calendar_event_id === CHILD_SERIES_ID), "child occurrences belong to child series");
});

Deno.test("same series-edit key replays before RPC and a changed payload is rejected", async () => {
  const first = mockContext();
  const deps = { now: () => NOW, newOccurrenceId: () => "019a0000-0000-7000-8000-000000000801" };
  const firstResponse = await handleRequest(editRequest("entire_series"), first.ctx, deps);
  assertEquals(firstResponse.status, 200, "first mutation status");
  const hash = (first.calls.rpcArgs as Record<string, unknown>).p_payload_hash_hex;
  const receipt = {
    series_event_id: SERIES_ID,
    payload_version: "recurring-series-edit-v1",
    payload_hash: "\\x" + String(hash),
    response_http_status: 200,
    response_body: { seriesEventId: SERIES_ID, scope: "entire_series", materializedCount: 3 },
  };
  const replay = mockContext({ receipt });
  const replayResponse = await handleRequest(editRequest("entire_series"), replay.ctx, deps);
  assertEquals(replayResponse.status, 200, "replay status");
  assertEquals((await responseBody(replayResponse)).replayed, true, "replay marker");
  assertEquals(replay.calls.rpc, 0, "replay does not call mutation RPC");
  const changed = mockContext({ receipt });
  const changedResponse = await handleRequest(editRequest("entire_series", {
    recurrenceRule: {
      version: 1, frequency: "DAILY", interval: 3, startDate: SELECTED_DATE,
      temporalKind: "all_day", count: 3,
    },
  }), changed.ctx, deps);
  assertEquals(changedResponse.status, 409, "changed payload with same idempotency key");
  assertEquals(changed.calls.rpc, 0, "changed receipt is rejected before write");
});

Deno.test("inactive profile and Protected Time conflict fail closed before the writer RPC", async () => {
  const inactive = mockContext({ profileStatus: "disabled" });
  const inactiveResponse = await handleRequest(editRequest(), inactive.ctx, { now: () => NOW });
  assertEquals(inactiveResponse.status, 403, "inactive profile");
  assertEquals(inactive.calls.rpc, 0, "inactive profile no writer call");

  const block = {
    id: "019a0000-0000-7000-8000-000000000901",
    updated_at: "2026-11-22T10:00:00.000000Z",
    label: "Descanso",
    category: "personal",
    protection_mode: "hard",
    pattern_kind: "one_off",
    time_zone: "America/Havana",
    starts_at: "2026-11-24T05:00:00.000Z",
    ends_at: "2026-11-24T06:00:00.000Z",
    archived_at: null,
    deleted_at: null,
  };
  const conflict = mockContext({ blocks: [block] });
  const conflictResponse = await handleRequest(editRequest(), conflict.ctx, { now: () => NOW });
  assertEquals(conflictResponse.status, 409, "Protected Time conflict");
  assertEquals((await responseBody(conflictResponse)).error, "PROTECTED_TIME_CONFLICTS", "conflict code");
  assertEquals(conflict.calls.rpc, 0, "conflict no writer call");
});
