import { assertEquals } from "jsr:@std/assert@1.0.14";
import {
  resolveActiveEventProfile,
  type EventAuthenticatedContext,
  type EventProfileLookupClient,
} from "../supabase/functions/_shared/agenda-event-profile.ts";

const AUTH_USER_ID = "00000000-0000-4000-8000-000000000001";
const PROFILE_ID = "0190f47a-7b2c-7abc-8def-0123456789ac";

interface QueryCapture {
  table: string | null;
  columns: string | null;
  filterColumn: string | null;
  filterValue: string | null;
  maybeSingleCalls: number;
}

function makeContext({
  authMode = "user",
  userId = AUTH_USER_ID,
  data = { id: PROFILE_ID, auth_user_id: AUTH_USER_ID, account_status: "active" },
  error = null,
  throws = false,
}: {
  authMode?: string;
  userId?: unknown;
  data?: Record<string, unknown> | null;
  error?: unknown;
  throws?: boolean;
} = {}): { ctx: EventAuthenticatedContext; capture: QueryCapture } {
  const capture: QueryCapture = {
    table: null,
    columns: null,
    filterColumn: null,
    filterValue: null,
    maybeSingleCalls: 0,
  };
  const client: EventProfileLookupClient = {
    from(table) {
      capture.table = table;
      return {
        select(columns) {
          capture.columns = columns;
          return {
            eq(column, value) {
              capture.filterColumn = column;
              capture.filterValue = value;
              return {
                async maybeSingle() {
                  capture.maybeSingleCalls += 1;
                  if (throws) throw new Error("synthetic transport failure");
                  return {
                    data: data as never,
                    error,
                  };
                },
              };
            },
          };
        },
      };
    },
  };
  return {
    ctx: {
      authMode,
      userClaims: userId === null ? null : { id: userId },
      supabase: client,
    },
    capture,
  };
}

Deno.test("resolves the active profile through the verified user's RLS-scoped client", async () => {
  const { ctx, capture } = makeContext();
  const result = await resolveActiveEventProfile(ctx);

  assertEquals(result, {
    ok: true,
    authUserId: AUTH_USER_ID,
    profileId: PROFILE_ID,
  });
  assertEquals(capture, {
    table: "user_profile",
    columns: "id,auth_user_id,account_status",
    filterColumn: "auth_user_id",
    filterValue: AUTH_USER_ID,
    maybeSingleCalls: 1,
  });
});

Deno.test("refuses non-user auth modes before making a profile query", async () => {
  const { ctx, capture } = makeContext({ authMode: "secret" });
  const result = await resolveActiveEventProfile(ctx);

  assertEquals(result, {
    ok: false,
    status: 401,
    code: "unauthenticated",
  });
  assertEquals(capture.maybeSingleCalls, 0);
});

Deno.test("refuses absent or malformed verified JWT subjects", async () => {
  for (const userId of [null, "", "not-a-uuid", 42]) {
    const { ctx, capture } = makeContext({ userId });
    const result = await resolveActiveEventProfile(ctx);

    assertEquals(result, {
      ok: false,
      status: 401,
      code: "unauthenticated",
    });
    assertEquals(capture.maybeSingleCalls, 0);
  }
});

Deno.test("returns profile_not_found when the verified user has no SimpleLife profile", async () => {
  const { ctx } = makeContext({ data: null });
  const result = await resolveActiveEventProfile(ctx);

  assertEquals(result, {
    ok: false,
    status: 403,
    code: "profile_not_found",
  });
});

Deno.test("refuses profiles that are not active", async () => {
  for (const account_status of ["deletion_pending", "disabled", null]) {
    const { ctx } = makeContext({
      data: { id: PROFILE_ID, auth_user_id: AUTH_USER_ID, account_status },
    });
    const result = await resolveActiveEventProfile(ctx);

    assertEquals(result, {
      ok: false,
      status: 403,
      code: "profile_not_active",
    });
  }
});

Deno.test("refuses a mismatched auth-user mapping or malformed profile UUIDv7", async () => {
  for (const data of [
    { id: PROFILE_ID, auth_user_id: "00000000-0000-4000-8000-000000000002", account_status: "active" },
    { id: "not-a-uuid", auth_user_id: AUTH_USER_ID, account_status: "active" },
    { id: "0190f47a-7b2c-4abc-8def-0123456789ac", auth_user_id: AUTH_USER_ID, account_status: "active" },
  ]) {
    const { ctx } = makeContext({ data });
    const result = await resolveActiveEventProfile(ctx);

    assertEquals(result, {
      ok: false,
      status: 503,
      code: "profile_record_invalid",
    });
  }
});

Deno.test("fails closed on profile query errors and transport exceptions", async () => {
  const withError = makeContext({ error: { code: "XX000" } });
  assertEquals(await resolveActiveEventProfile(withError.ctx), {
    ok: false,
    status: 503,
    code: "profile_lookup_failed",
  });

  const throws = makeContext({ throws: true });
  assertEquals(await resolveActiveEventProfile(throws.ctx), {
    ok: false,
    status: 503,
    code: "profile_lookup_failed",
  });
});
