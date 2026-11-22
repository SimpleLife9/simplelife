import { handleRequest } from "../supabase/functions/agenda-event-mutate/handler.ts";
import type { EventAuthenticatedContext } from "../supabase/functions/_shared/agenda-event-profile.ts";

const AUTH_USER_ID = "00000000-0000-4000-8000-000000000001";
const PROFILE_ID = "0190f47a-7b2c-7abc-8def-0123456789ac";
const EVENT_ID = "0190f47a-7b2c-7abc-8def-0123456789ad";
const INITIAL_UPDATED_AT = "2026-11-20T10:00:00.000Z";

function assertEquals(actual: unknown, expected: unknown, label: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(label + ": expected " + JSON.stringify(expected) + ", received " + JSON.stringify(actual));
  }
}
function request(payload: Record<string, unknown>): Request {
  return new Request("https://local.test/agenda-event-mutate", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}
function eventInput(overrides: Record<string, unknown> = {}) {
  return {
    title: "Updated event",
    description: "Edited from the detail view",
    locationLabel: null,
    locationKind: null,
    temporalKind: "all_day",
    startDate: "2026-12-24",
    endDateExclusive: "2026-12-26",
    ...overrides,
  };
}
function initialEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: EVENT_ID,
    owner_user_id: PROFILE_ID,
    created_by_user_id: PROFILE_ID,
    updated_by_user_id: PROFILE_ID,
    title: "Original event",
    description: null,
    location_label: null,
    location_kind: null,
    event_status: "confirmed",
    temporal_kind: "all_day",
    start_date: "2026-12-24",
    end_date_exclusive: "2026-12-25",
    start_local: null,
    end_local: null,
    time_zone: null,
    starts_at: null,
    ends_at: null,
    start_disambiguation: null,
    end_disambiguation: null,
    start_gap_strategy: null,
    end_gap_strategy: null,
    archived_at: null,
    deleted_at: null,
    purge_after: null,
    created_at: "2026-11-19T10:00:00.000Z",
    updated_at: INITIAL_UPDATED_AT,
    ...overrides,
  };
}

function makeContext({
  event = initialEvent(),
  profileStatus = "active",
  authMode = "user",
}: {
  event?: Record<string, unknown> | null;
  profileStatus?: string;
  authMode?: string;
} = {}) {
  let current = event ? structuredClone(event) : null;
  const capture: {
    profileQueries: number;
    eventSelectFilters: Record<string, unknown>[];
    eventUpdateFilters: Record<string, unknown>[];
    updates: Record<string, unknown>[];
    auditRows: number;
  } = {
    profileQueries: 0,
    eventSelectFilters: [],
    eventUpdateFilters: [],
    updates: [],
    auditRows: 0,
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
                  capture.profileQueries += 1;
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
      if (table !== "calendar_event") throw new Error("unexpected admin table " + table);
      return {
        select() {
          const filters: Record<string, unknown> = {};
          const chain = {
            eq(column: string, value: unknown) {
              filters[column] = value;
              return chain;
            },
            async maybeSingle() {
              capture.eventSelectFilters.push({ ...filters });
              if (!current || Object.entries(filters).some(([key, value]) => current?.[key] !== value)) {
                return { data: null, error: null };
              }
              return { data: structuredClone(current), error: null };
            },
          };
          return chain;
        },
        update(patch: Record<string, unknown>) {
          const filters: Record<string, unknown> = {};
          const chain = {
            eq(column: string, value: unknown) {
              filters[column] = value;
              return chain;
            },
            select() {
              return chain;
            },
            async maybeSingle() {
              capture.eventUpdateFilters.push({ ...filters });
              if (!current || Object.entries(filters).some(([key, value]) => current?.[key] !== value)) {
                return { data: null, error: null };
              }
              const changed = Object.entries(patch).some(([key, value]) => current?.[key] !== value);
              current = { ...current, ...patch };
              capture.updates.push({ ...patch });
              // Mirror the DB trigger: only a business/lifecycle mutation adds audit.
              if (changed && Object.keys(patch).some((key) => key !== "updated_at" && key !== "updated_by_user_id")) {
                capture.auditRows += 1;
              }
              return { data: structuredClone(current), error: null };
            },
          };
          return chain;
        },
      };
    },
  };

  const ctx = {
    authMode,
    userClaims: { id: AUTH_USER_ID },
    supabase,
    supabaseAdmin,
  } as unknown as EventAuthenticatedContext & { supabaseAdmin: typeof supabaseAdmin };

  return { ctx, capture, getCurrent: () => current };
}

async function responseBody(response: Response): Promise<Record<string, unknown>> {
  return await response.json() as Record<string, unknown>;
}

Deno.test("updates an owner-scoped Event with optimistic updated_at and the server-derived actor", async () => {
  const { ctx, capture, getCurrent } = makeContext();
  const response = await handleRequest(request({
    eventId: EVENT_ID,
    expectedUpdatedAt: INITIAL_UPDATED_AT,
    operation: "update",
    event: eventInput(),
  }), ctx, { now: () => "2026-11-22T18:00:00.000Z" });

  assertEquals(response.status, 200, "update status");
  const result = await responseBody(response);
  assertEquals(result.eventId, EVENT_ID, "event id");
  assertEquals(result.replayed, false, "first mutation replay flag");
  assertEquals(getCurrent()?.title, "Updated event", "updated title");
  assertEquals(getCurrent()?.owner_user_id, PROFILE_ID, "owner unchanged");
  assertEquals(getCurrent()?.created_by_user_id, PROFILE_ID, "creator unchanged");
  assertEquals(getCurrent()?.updated_by_user_id, PROFILE_ID, "server-derived updater");
  assertEquals(getCurrent()?.start_date, "2026-12-24", "updated all-day start");
  assertEquals(getCurrent()?.end_date_exclusive, "2026-12-26", "updated all-day exclusive end");
  assertEquals(capture.eventSelectFilters[0], { id: EVENT_ID, owner_user_id: PROFILE_ID }, "owner-scoped lookup");
  assertEquals(capture.eventUpdateFilters[0], {
    id: EVENT_ID,
    owner_user_id: PROFILE_ID,
    updated_at: INITIAL_UPDATED_AT,
  }, "owner and optimistic version filters");
  assertEquals(capture.auditRows, 1, "one audit append for business update");
});

Deno.test("replaying an identical Event update is a no-op and does not append a second audit row", async () => {
  const { ctx, capture, getCurrent } = makeContext();
  const payload = {
    eventId: EVENT_ID,
    expectedUpdatedAt: INITIAL_UPDATED_AT,
    operation: "update",
    event: eventInput(),
  };
  const first = await handleRequest(request(payload), ctx, { now: () => "2026-11-22T18:00:00.000Z" });
  const second = await handleRequest(request(payload), ctx, { now: () => "2026-11-22T18:05:00.000Z" });
  assertEquals(first.status, 200, "first update");
  assertEquals(second.status, 200, "identical retry");
  assertEquals((await responseBody(second)).replayed, true, "replay response");
  assertEquals(capture.updates.length, 1, "one database update");
  assertEquals(capture.auditRows, 1, "one audit row");
  assertEquals(getCurrent()?.updated_at, "2026-11-22T18:00:00.000Z", "retry did not move updated_at");
});

Deno.test("rejects stale conflicting Event edits without overwriting the newer version", async () => {
  const { ctx, capture, getCurrent } = makeContext({
    event: initialEvent({ title: "Already changed", updated_at: "2026-11-22T12:00:00.000Z" }),
  });
  const response = await handleRequest(request({
    eventId: EVENT_ID,
    expectedUpdatedAt: INITIAL_UPDATED_AT,
    operation: "update",
    event: eventInput({ title: "Different stale edit" }),
  }), ctx, { now: () => "2026-11-22T18:00:00.000Z" });
  assertEquals(response.status, 409, "stale update status");
  assertEquals((await responseBody(response)).error, "EVENT_CHANGED_RELOAD_AND_RETRY", "stale update code");
  assertEquals(getCurrent()?.title, "Already changed", "newer title preserved");
  assertEquals(capture.updates.length, 0, "no stale write");
  assertEquals(capture.auditRows, 0, "no audit append for rejected write");
});

Deno.test("cancel and reopen are explicit functional transitions and retries are idempotent", async () => {
  const { ctx, capture, getCurrent } = makeContext();
  const cancel = await handleRequest(request({
    eventId: EVENT_ID, expectedUpdatedAt: INITIAL_UPDATED_AT, operation: "cancel",
  }), ctx, { now: () => "2026-11-22T18:00:00.000Z" });
  assertEquals(cancel.status, 200, "cancel status");
  assertEquals(getCurrent()?.event_status, "cancelled", "cancelled state");
  assertEquals(getCurrent()?.start_date, "2026-12-24", "original date preserved");

  const cancelRetry = await handleRequest(request({
    eventId: EVENT_ID, expectedUpdatedAt: INITIAL_UPDATED_AT, operation: "cancel",
  }), ctx, { now: () => "2026-11-22T18:01:00.000Z" });
  assertEquals(cancelRetry.status, 200, "cancel retry status");
  assertEquals((await responseBody(cancelRetry)).replayed, true, "cancel retry replay");

  const afterCancelUpdatedAt = getCurrent()?.updated_at as string;
  const reopen = await handleRequest(request({
    eventId: EVENT_ID, expectedUpdatedAt: afterCancelUpdatedAt, operation: "reopen",
  }), ctx, { now: () => "2026-11-22T18:02:00.000Z" });
  assertEquals(reopen.status, 200, "reopen status");
  assertEquals(getCurrent()?.event_status, "confirmed", "reopened state");
  assertEquals(capture.auditRows, 2, "cancel and reopen each append one audit row");
});

Deno.test("archive, trash and restore change lifecycle without physical deletion", async () => {
  const { ctx, capture, getCurrent } = makeContext();
  const archive = await handleRequest(request({
    eventId: EVENT_ID, expectedUpdatedAt: INITIAL_UPDATED_AT, operation: "archive",
  }), ctx, { now: () => "2026-11-22T18:00:00.000Z" });
  assertEquals(archive.status, 200, "archive status");
  assertEquals(typeof getCurrent()?.archived_at, "string", "archived timestamp");
  assertEquals(getCurrent()?.deleted_at, null, "archive is not trash");

  const restoreArchive = await handleRequest(request({
    eventId: EVENT_ID, expectedUpdatedAt: getCurrent()?.updated_at as string, operation: "restore",
  }), ctx, { now: () => "2026-11-22T18:01:00.000Z" });
  assertEquals(restoreArchive.status, 200, "restore archive status");
  assertEquals(getCurrent()?.archived_at, null, "archive cleared");

  const trash = await handleRequest(request({
    eventId: EVENT_ID, expectedUpdatedAt: getCurrent()?.updated_at as string, operation: "trash",
  }), ctx, { now: () => "2026-11-22T18:02:00.000Z" });
  assertEquals(trash.status, 200, "trash status");
  assertEquals(typeof getCurrent()?.deleted_at, "string", "deleted timestamp");
  assertEquals(typeof getCurrent()?.purge_after, "string", "30-day recovery timestamp");

  const restoreTrash = await handleRequest(request({
    eventId: EVENT_ID, expectedUpdatedAt: getCurrent()?.updated_at as string, operation: "restore",
  }), ctx, { now: () => "2026-11-22T18:03:00.000Z" });
  assertEquals(restoreTrash.status, 200, "restore trash status");
  assertEquals(getCurrent()?.deleted_at, null, "trash cleared");
  assertEquals(getCurrent()?.purge_after, null, "retention cleared on restore");
  assertEquals(capture.auditRows, 4, "each lifecycle transition appends one audit row");
});

Deno.test("refuses to mutate another owner's Event or an inactive account", async () => {
  const crossOwner = makeContext({ event: initialEvent({ owner_user_id: "0190f47a-7b2c-7abc-8def-0123456789ee" }) });
  const hidden = await handleRequest(request({
    eventId: EVENT_ID, expectedUpdatedAt: INITIAL_UPDATED_AT, operation: "cancel",
  }), crossOwner.ctx);
  assertEquals(hidden.status, 404, "cross-owner result hides Event existence");
  assertEquals(crossOwner.capture.updates.length, 0, "cross-owner no write");

  const inactive = makeContext({ profileStatus: "disabled" });
  const denied = await handleRequest(request({
    eventId: EVENT_ID, expectedUpdatedAt: INITIAL_UPDATED_AT, operation: "cancel",
  }), inactive.ctx);
  assertEquals(denied.status, 403, "inactive profile denied");
  assertEquals(inactive.capture.eventSelectFilters.length, 0, "inactive profile does not query Events");
});

Deno.test("validates request method, fields, body size and Event status boundaries", async () => {
  const { ctx, capture } = makeContext();
  const wrongMethod = await handleRequest(new Request("https://local.test", { method: "GET" }), ctx);
  assertEquals(wrongMethod.status, 405, "method");
  const unknownField = await handleRequest(request({
    eventId: EVENT_ID, expectedUpdatedAt: INITIAL_UPDATED_AT, operation: "cancel", ownerUserId: PROFILE_ID,
  }), ctx);
  assertEquals(unknownField.status, 422, "unknown identity field");
  const statusTampering = await handleRequest(request({
    eventId: EVENT_ID,
    expectedUpdatedAt: INITIAL_UPDATED_AT,
    operation: "update",
    event: eventInput({ eventStatus: "cancelled" }),
  }), ctx);
  assertEquals(statusTampering.status, 422, "status transitions are not editable fields");
  const oversized = await handleRequest(new Request("https://local.test", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: "x".repeat(32769),
  }), ctx);
  assertEquals(oversized.status, 413, "body size");
  assertEquals(capture.updates.length, 0, "invalid requests never write");
});
