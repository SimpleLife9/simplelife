const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UUID_V7_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type EventProfileResolutionFailureCode =
  | "unauthenticated"
  | "profile_not_found"
  | "profile_not_active"
  | "profile_lookup_failed"
  | "profile_record_invalid";

export interface EventProfileResolutionSuccess {
  ok: true;
  authUserId: string;
  profileId: string;
}

export interface EventProfileResolutionFailure {
  ok: false;
  status: 401 | 403 | 503;
  code: EventProfileResolutionFailureCode;
}

export type EventProfileResolution =
  | EventProfileResolutionSuccess
  | EventProfileResolutionFailure;

interface ProfileRow {
  id: unknown;
  auth_user_id: unknown;
  account_status: unknown;
}

interface ProfileQueryResult {
  data: ProfileRow | null;
  error: unknown | null;
}

interface ProfileQuery {
  eq(column: string, value: string): {
    maybeSingle(): Promise<ProfileQueryResult>;
  };
}

interface ProfileTableQuery {
  select(columns: string): ProfileQuery;
}

export interface EventProfileLookupClient {
  from(table: string): ProfileTableQuery;
}

export interface EventAuthenticatedContext {
  authMode: string;
  userClaims: { id?: unknown } | null;
  supabase: EventProfileLookupClient;
}

function failure(
  status: EventProfileResolutionFailure["status"],
  code: EventProfileResolutionFailureCode,
): EventProfileResolutionFailure {
  return { ok: false, status, code };
}

/**
 * Resolve the current signed-in user's active SimpleLife profile.
 *
 * The user id is taken only from the verified @supabase/server context.
 * Lookup runs through ctx.supabase, never the service-role/admin client.
 * The returned profile id is the authority for owner/creator/updater fields;
 * never accept those identifiers from an Event request body.
 */
export async function resolveActiveEventProfile(
  ctx: EventAuthenticatedContext,
): Promise<EventProfileResolution> {
  if (ctx.authMode !== "user") {
    return failure(401, "unauthenticated");
  }

  const authUserId = ctx.userClaims?.id;
  if (typeof authUserId !== "string" || !UUID_PATTERN.test(authUserId)) {
    return failure(401, "unauthenticated");
  }

  let result: ProfileQueryResult;
  try {
    result = await ctx.supabase
      .from("user_profile")
      .select("id,auth_user_id,account_status")
      .eq("auth_user_id", authUserId)
      .maybeSingle();
  } catch {
    return failure(503, "profile_lookup_failed");
  }

  if (result.error) {
    return failure(503, "profile_lookup_failed");
  }
  if (!result.data) {
    return failure(403, "profile_not_found");
  }

  const profile = result.data;
  if (profile.auth_user_id !== authUserId
    || typeof profile.id !== "string"
    || !UUID_V7_PATTERN.test(profile.id)) {
    return failure(503, "profile_record_invalid");
  }
  if (profile.account_status !== "active") {
    return failure(403, "profile_not_active");
  }

  return {
    ok: true,
    authUserId,
    profileId: profile.id.toLowerCase(),
  };
}
