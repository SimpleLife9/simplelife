import { handleRequest } from "../supabase/functions/agenda-event-create/handler.ts";
import type { EventAuthenticatedContext } from "../supabase/functions/_shared/agenda-event-profile.ts";

const AUTH_USER_ID = "00000000-0000-4000-8000-000000000001";
const PROFILE_ID = "0190f47a-7b2c-7abc-8def-0123456789ac";
const KEY = "0190f47a-7b2c-7abc-8def-0123456789ab";
const EVENT_ID = "0190f47a-7b2c-7abc-8def-0123456789ad";

function assertEquals(actual: unknown, expected: unknown, label: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(label + ": expected " + JSON.stringify(expected) + ", got " + JSON.stringify(actual));
  }
}
async function body(response: Response): Promise<Record<string, unknown>> {
  return await response.json() as Record<string, unknown>;
}
function request(event: Record<string, unknown>, key = KEY, protectedTimeDecisions?: unknown): Request {
  return new Request("https://local.test/agenda-event-create", {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": key },
    body: JSON.stringify({
      event,
      ...(protectedTimeDecisions === undefined ? {} : { protectedTimeDecisions }),
    }),
  });
}
function allDayEvent(overrides: Record<string, unknown> = {}) {
  return {
    title: "Viaje familiar",
    temporalKind: "all_day",
    startDate: "2026-12-24",
    endDateExclusive: "2026-12-27",
    ...overrides,
  };
}
function mockContext({
  profileStatus = "active",
  existing = null as Record<string, unknown> | null,
  lookupError = null as unknown,
  rpcResult = [{ http_status: 201, response_body: { eventId: EVENT_ID, createdAt: "2026-11-22T18:00:00.000Z", eventStatus: "confirmed" }, replayed: false }],
  rpcError = null as unknown,
  protectedBlocks = [] as Record<string, unknown>[],
}: {
  profileStatus?: string;
  existing?: Record<string, unknown> | null;
  lookupError?: unknown;
  rpcResult?: unknown;
  rpcError?: unknown;
  protectedBlocks?: Record<string, unknown>[];
} = {}) {
  const calls: Record<string, unknown> = { rpc: 0, rpcArgs: null, profileLookup: 0, ledgerLookup: 0 };
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
                  return { data: { id: PROFILE_ID, auth_user_id: AUTH_USER_ID, account_status: profileStatus }, error: null };
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
      if (table === "event_create_request") {
        return {
          select() {
            return {
              eq(_column: string, _value: string) {
                return {
                  eq(_key: string, _value: string) {
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
      }
      if (table === "user_preference") {
        return {
          select() {
            return {
              eq() {
                return { async maybeSingle() { return { data: { time_zone: "America/Havana" }, error: null }; } };
              },
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

Deno.test("creates an all-day Event through the atomic RPC with server-derived owner and actor", async () => {
  const { ctx, calls } = mockContext();
  const response = await handleRequest(request(allDayEvent()), ctx, {
    now: () => "2026-11-22T18:00:00.000Z",
    newEventId: () => EVENT_ID,
  });
  assertEquals(response.status, 201, "create status");
  assertEquals(await body(response), {
    eventId: EVENT_ID,
    createdAt: "2026-11-22T18:00:00.000Z",
    eventStatus: "confirmed",
    replayed: false,
  }, "create response");
  assertEquals(calls.rpc, 1, "atomic RPC called once");
  const args = calls.rpcArgs as Record<string, unknown>;
  assertEquals(args.p_owner_user_id, PROFILE_ID, "owner from verified profile");
  assertEquals(args.p_idempotency_key, KEY, "normalized key");
  const record = args.p_event_record as Record<string, unknown>;
  assertEquals(record.owner_user_id, PROFILE_ID, "record owner");
  assertEquals(record.created_by_user_id, PROFILE_ID, "record creator");
  assertEquals(record.updated_by_user_id, PROFILE_ID, "record updater");
  assertEquals(record.protected_time_decisions, [], "no unneeded conflict decisions");
  assertEquals(record.protected_time_snapshot, [], "complete empty owner block snapshot");
  assertEquals(Object.keys(record).length, 28, "exact Event RPC record shape");
});

Deno.test("hard Protected Time overlap returns conflict before creating or claiming the Event", async () => {
  const block = {
    id: "019a0000-0000-7000-8000-000000000111",
    updated_at: "2026-11-20T10:00:00.000000+00:00",
    label: "Sueño",
    category: "salud",
    protection_mode: "hard",
    pattern_kind: "one_off",
    time_zone: "America/Havana",
    starts_at: "2026-12-24T06:00:00.000Z",
    ends_at: "2026-12-24T07:00:00.000Z",
    archived_at: null,
    deleted_at: null,
  };
  const { ctx, calls } = mockContext({ protectedBlocks: [block] });
  const response = await handleRequest(request(allDayEvent()), ctx, {
    now: () => "2026-11-22T18:00:00.000Z",
    newEventId: () => EVENT_ID,
  });
  assertEquals(response.status, 409, "hard overlap status");
  const payload = await body(response);
  assertEquals(payload.error, "PROTECTED_TIME_CONFLICTS", "hard overlap code");
  const conflicts = payload.conflicts as Array<Record<string, unknown>>;
  assertEquals(conflicts.length, 1, "one conflict");
  assertEquals(conflicts[0].requiredDecision, "override_hard", "hard override required");
  assertEquals(calls.rpc, 0, "conflict must not reach create RPC");
});

Deno.test("hard Protected Time overlap can be saved only with the exact occurrence and current block version decision", async () => {
  const block = {
    id: "019a0000-0000-7000-8000-000000000111",
    updated_at: "2026-11-20T10:00:00.000000+00:00",
    label: "Sueño",
    category: "salud",
    protection_mode: "hard",
    pattern_kind: "one_off",
    time_zone: "America/Havana",
    starts_at: "2026-12-24T06:00:00.000Z",
    ends_at: "2026-12-24T07:00:00.000Z",
    archived_at: null,
    deleted_at: null,
  };
  const decisions = [{
    blockId: block.id,
    blockUpdatedAt: block.updated_at,
    occurrenceStartsAt: block.starts_at,
    decision: "override_hard",
  }];
  const { ctx, calls } = mockContext({ protectedBlocks: [block] });
  const response = await handleRequest(request(allDayEvent(), KEY, decisions), ctx, {
    now: () => "2026-11-22T18:00:00.000Z",
    newEventId: () => EVENT_ID,
  });
  assertEquals(response.status, 201, "explicit hard override status");
  const args = calls.rpcArgs as Record<string, unknown>;
  const record = args.p_event_record as Record<string, unknown>;
  assertEquals(record.protected_time_decisions && (record.protected_time_decisions as unknown[]).length, 1,
    "persisted decision count");
  assertEquals((record.protected_time_decisions as Array<Record<string, unknown>>)[0].decision,
    "override_hard", "explicit override stored");
  assertEquals((record.protected_time_snapshot as unknown[]).length, 1, "one block version snapshot");
});

Deno.test("replays an existing receipt before resolver or RPC and returns the original Event", async () => {
  const existing = {
    payload_version: "event-create-v1",
    payload_hash: "\\x" + "0".repeat(64),
    result_event_id: EVENT_ID,
    response_created_at: "2026-11-20T10:00:00.000Z",
    response_event_status: "confirmed",
  };
  // The request hash is computed from the normalized draft; provide the exact
  // expected hash by computing it through the same stable intent helper.
  const { hashEventCreateIntent } = await import("../src/features/agenda/domain/event-idempotency.js");
  const { createEventDraft } = await import("../src/features/agenda/domain/event.js");
  const hash = await hashEventCreateIntent(createEventDraft(allDayEvent()));
  existing.payload_hash = "\\x" + hash.payloadHash;
  const { ctx, calls } = mockContext({ existing });
  const response = await handleRequest(request(allDayEvent()), ctx);
  assertEquals(response.status, 201, "replay status");
  assertEquals((await body(response)).replayed, true, "replay marker");
  assertEquals(calls.rpc, 0, "replay must not call writer RPC");
});

Deno.test("rejects a reused key with a different payload before the write RPC", async () => {
  const existing = {
    payload_version: "event-create-v1",
    payload_hash: "\\x" + "0".repeat(64),
    result_event_id: EVENT_ID,
    response_created_at: "2026-11-20T10:00:00.000Z",
    response_event_status: "confirmed",
  };
  const { ctx, calls } = mockContext({ existing });
  const response = await handleRequest(request(allDayEvent()), ctx);
  assertEquals(response.status, 409, "conflict status");
  assertEquals(calls.rpc, 0, "conflict must not call writer RPC");
});

Deno.test("fails closed when the verified user profile is inactive", async () => {
  const { ctx, calls } = mockContext({ profileStatus: "disabled" });
  const response = await handleRequest(request(allDayEvent()), ctx);
  assertEquals(response.status, 403, "inactive profile status");
  assertEquals(calls.ledgerLookup, 0, "no ledger lookup for inactive profile");
  assertEquals(calls.rpc, 0, "no write for inactive profile");
});

Deno.test("requires a UUIDv7 idempotency key and a bounded JSON body", async () => {
  const { ctx, calls } = mockContext();
  const invalid = await handleRequest(request(allDayEvent(), "not-a-uuid"), ctx);
  assertEquals(invalid.status, 422, "invalid key");
  const wrongMethod = await handleRequest(new Request("https://local.test", { method: "GET" }), ctx);
  assertEquals(wrongMethod.status, 405, "method");
  const oversized = await handleRequest(new Request("https://local.test", {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": KEY },
    body: "x".repeat(32769),
  }), ctx);
  assertEquals(oversized.status, 413, "oversized body");
  assertEquals(calls.rpc, 0, "invalid request never writes");
});
