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
function request(event: Record<string, unknown>, key = KEY, conflictDecisions?: unknown): Request {
  const body = conflictDecisions === undefined ? { event } : { event, conflictDecisions };
  return new Request("https://local.test/agenda-event-create", {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": key },
    body: JSON.stringify(body),
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
  protectedBlocks = [] as Array<Record<string, unknown>>,
}: {
  profileStatus?: string;
  existing?: Record<string, unknown> | null;
  lookupError?: unknown;
  rpcResult?: unknown;
  rpcError?: unknown;
  protectedBlocks?: Array<Record<string, unknown>>;
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
      if (table === "protected_time_block") {
        const query: Record<string, unknown> = {};
        query.select = () => query;
        query.eq = () => query;
        query.is = () => query;
        query.order = () => query;
        query.limit = async () => ({ data: protectedBlocks, error: null });
        return query;
      }
      if (table === "user_preference") {
        const query: Record<string, unknown> = {};
        query.select = () => query;
        query.eq = () => query;
        query.maybeSingle = async () => ({ data: { time_zone: "America/Havana" }, error: null });
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
  assertEquals(calls.rpcName, "create_calendar_event_with_protected_time_once", "Protected Time atomic RPC");
  const args = calls.rpcArgs as Record<string, unknown>;
  assertEquals(args.p_protected_time_snapshot, [], "empty Protected Time snapshot");
  assertEquals(args.p_conflict_decisions, [], "no conflict decisions");
  assertEquals(args.p_owner_user_id, PROFILE_ID, "owner from verified profile");
  assertEquals(args.p_idempotency_key, KEY, "normalized key");
  const record = args.p_event_record as Record<string, unknown>;
  assertEquals(record.owner_user_id, PROFILE_ID, "record owner");
  assertEquals(record.created_by_user_id, PROFILE_ID, "record creator");
  assertEquals(record.updated_by_user_id, PROFILE_ID, "record updater");
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


const HARD_BLOCK = {
  id: "0190f47a-7b2c-7abc-8def-0123456789b1",
  label: "Descanso",
  category: "Personal",
  protection_mode: "hard",
  pattern_kind: "one_off",
  time_zone: "America/Havana",
  starts_at: "2026-12-25T15:00:00.000Z",
  ends_at: "2026-12-25T16:00:00.000Z",
  start_date: null,
  end_date_exclusive: null,
  weekdays: null,
  start_time_local: null,
  end_time_local: null,
  ends_next_day: null,
  updated_at: "2026-11-22T18:00:00.123456Z",
};

Deno.test("returns a conflict preview before any Event write when a hard Protected Time block overlaps", async () => {
  const { ctx, calls } = mockContext({ protectedBlocks: [HARD_BLOCK] });
  const response = await handleRequest(request(allDayEvent()), ctx);
  assertEquals(response.status, 409, "conflict preview status");
  const result = await body(response);
  assertEquals(result.error, "PROTECTED_TIME_CONFLICTS", "conflict code");
  const conflicts = result.conflicts as Array<Record<string, unknown>>;
  assertEquals(conflicts.length, 1, "one overlapping block");
  assertEquals(conflicts[0].blockId, HARD_BLOCK.id, "conflicting block identity");
  assertEquals(conflicts[0].protectionMode, "hard", "hard protection");
  assertEquals(calls.rpc, 0, "no Event or audit write before explicit consent");
});

Deno.test("binds explicit hard override consent to the create receipt and current Protected Time snapshot", async () => {
  const decisions = [{
    blockId: HARD_BLOCK.id,
    blockUpdatedAt: HARD_BLOCK.updated_at,
    protectionMode: "hard",
    decision: "override",
  }];
  const { ctx, calls } = mockContext({ protectedBlocks: [HARD_BLOCK] });
  const response = await handleRequest(request(allDayEvent(), KEY, decisions), ctx);
  assertEquals(response.status, 201, "accepted create status");
  assertEquals(calls.rpcName, "create_calendar_event_with_protected_time_once", "guarded create RPC");
  const args = calls.rpcArgs as Record<string, unknown>;
  assertEquals(args.p_protected_time_snapshot, [{
    id: HARD_BLOCK.id,
    updatedAt: HARD_BLOCK.updated_at,
  }], "snapshot is tied to the version reviewed");
  assertEquals(args.p_conflict_decisions, decisions, "explicit consent forwarded");
  assertEquals(args.p_payload_hash_hex, (await (await import("../src/features/agenda/domain/event-idempotency.js"))
    .hashEventCreateIntent(
      (await import("../src/features/agenda/domain/event.js")).createEventDraft(allDayEvent()),
      globalThis.crypto,
      decisions,
    )).payloadHash, "consent participates in the idempotency hash");
});
