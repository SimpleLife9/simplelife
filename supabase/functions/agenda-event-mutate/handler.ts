import {
  applyAuthoritativeEventResolution,
  buildEventTimeResolutionRequest,
  createEventDraft,
} from "../../../src/features/agenda/domain/event.js";
import { buildEventInsertRecord } from "../../../src/features/agenda/domain/event-record.js";
import {
  resolveActiveEventProfile,
  type EventAuthenticatedContext,
} from "../_shared/agenda-event-profile.ts";
import { resolveLocalDateTimeRange, TzdbVersionError } from "../agenda-time-resolve/resolver.ts";

export const MAX_REQUEST_BYTES = 32 * 1024;
const JSON_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, apikey, x-client-info, content-type",
  "access-control-allow-methods": "PATCH, OPTIONS",
  "access-control-max-age": "86400",
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
};
const UUID_V7_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ISO_INSTANT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/i;
const MUTABLE_EVENT_COLUMNS = [
  "title",
  "description",
  "location_label",
  "location_kind",
  "temporal_kind",
  "start_date",
  "end_date_exclusive",
  "start_local",
  "end_local",
  "time_zone",
  "starts_at",
  "ends_at",
  "start_disambiguation",
  "end_disambiguation",
  "start_gap_strategy",
  "end_gap_strategy",
] as const;
type Operation = "update" | "cancel" | "reopen" | "finish" | "archive" | "restore" | "trash";
type AdminClient = { from(table: string): any };
type Context = EventAuthenticatedContext & { supabaseAdmin: AdminClient };
type Dependencies = { now?: () => string };

interface EventRow {
  id: string;
  owner_user_id: string;
  updated_at: string;
  updated_by_user_id: string;
  event_status: string;
  archived_at: string | null;
  deleted_at: string | null;
  purge_after: string | null;
  [key: string]: unknown;
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function parseJson(text: string): unknown {
  return JSON.parse(text);
}

async function readBoundedBody(request: Request): Promise<string | null> {
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > MAX_REQUEST_BYTES) {
        try { await reader.cancel(); } catch { /* best effort */ }
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

function validInstant(value: unknown): value is string {
  return typeof value === "string"
    && ISO_INSTANT_PATTERN.test(value)
    && Number.isFinite(Date.parse(value));
}

function toInstant(value: string): number {
  return Date.parse(value);
}

function publicResult(row: EventRow, replayed: boolean): Record<string, unknown> {
  return {
    eventId: row.id,
    updatedAt: row.updated_at,
    eventStatus: row.event_status,
    archivedAt: row.archived_at,
    deletedAt: row.deleted_at,
    purgeAfter: row.purge_after,
    replayed,
  };
}

async function findOwnedEvent(
  admin: AdminClient,
  eventId: string,
  profileId: string,
): Promise<{ row: EventRow | null; error: unknown | null }> {
  const result = await admin.from("calendar_event")
    .select("*")
    .eq("id", eventId)
    .eq("owner_user_id", profileId)
    .maybeSingle();
  return { row: result.data as EventRow | null, error: result.error };
}

function timestampAfterDays(now: string, days: number): string {
  return new Date(Date.parse(now) + days * 86_400_000).toISOString();
}

function equalField(left: unknown, right: unknown, column: string): boolean {
  if (left == null || right == null) return left === right;
  if (column === "starts_at" || column === "ends_at") {
    return validInstant(left) && validInstant(right)
      ? toInstant(left) === toInstant(right)
      : left === right;
  }
  return left === right;
}

function matchesPatch(row: EventRow, patch: Record<string, unknown>): boolean {
  return Object.entries(patch).every(([key, value]) => equalField(row[key], value, key));
}

function noLifecycleWrite(row: EventRow): boolean {
  return row.archived_at == null && row.deleted_at == null;
}

function operationAlreadySatisfied(
  row: EventRow,
  input: ReturnType<typeof validateBody>,
  patch: Record<string, unknown>,
): boolean {
  switch (input.operation) {
    case "update":
      return matchesPatch(row, patch);
    case "cancel":
      return row.event_status === "cancelled";
    case "reopen":
      return row.event_status === "confirmed";
    case "finish":
      return row.event_status === "finished";
    case "archive":
      return row.archived_at != null && row.deleted_at == null;
    case "restore":
      return row.archived_at == null && row.deleted_at == null && row.purge_after == null;
    case "trash":
      return row.deleted_at != null && row.archived_at == null;
  }
}

function buildEditableDraft(input: unknown) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("EVENT_BODY_REQUIRED");
  }
  const source = input as Record<string, unknown>;
  if (Object.prototype.hasOwnProperty.call(source, "eventStatus")) {
    throw new RangeError("EVENT_STATUS_MUST_USE_A_TRANSITION");
  }
  return createEventDraft({ ...source, eventStatus: "confirmed" });
}

async function buildEditablePatch(
  input: unknown,
  event: EventRow,
  profileId: string,
  now: string,
): Promise<Record<string, unknown>> {
  let draft = buildEditableDraft(input);
  if (draft.temporal.kind === "zoned_civil") {
    const resolution = resolveLocalDateTimeRange(buildEventTimeResolutionRequest(draft));
    draft = applyAuthoritativeEventResolution(draft, resolution);
  }

  const record = buildEventInsertRecord({
    eventDraft: draft,
    eventId: event.id,
    ownerProfileId: profileId,
    now,
  }) as Record<string, unknown>;

  const patch: Record<string, unknown> = {};
  for (const column of MUTABLE_EVENT_COLUMNS) patch[column] = record[column];
  patch.updated_by_user_id = profileId;
  return patch;
}

function transitionPatch(
  operation: Exclude<Operation, "update">,
  row: EventRow,
  now: string,
): Record<string, unknown> | Response {
  switch (operation) {
    case "cancel":
      if (row.event_status === "cancelled") return json(publicResult(row, true), 200);
      if (row.event_status === "finished") return json({ error: "FINISHED_EVENT_CANNOT_BE_CANCELLED" }, 409);
      return { event_status: "cancelled" };
    case "reopen":
      if (row.event_status === "confirmed") return json(publicResult(row, true), 200);
      if (row.event_status !== "cancelled") return json({ error: "ONLY_CANCELLED_EVENTS_CAN_BE_REOPENED" }, 409);
      return { event_status: "confirmed" };
    case "finish":
      if (row.event_status === "finished") return json(publicResult(row, true), 200);
      if (row.event_status !== "confirmed") return json({ error: "ONLY_CONFIRMED_EVENTS_CAN_BE_FINISHED" }, 409);
      return { event_status: "finished" };
    case "archive":
      if (row.archived_at != null) return json(publicResult(row, true), 200);
      if (row.deleted_at != null) return json({ error: "TRASHED_EVENT_CANNOT_BE_ARCHIVED" }, 409);
      return { archived_at: now };
    case "restore":
      if (row.archived_at == null && row.deleted_at == null && row.purge_after == null) {
        return json(publicResult(row, true), 200);
      }
      if (row.purge_after && Date.parse(now) > Date.parse(row.purge_after)) {
        return json({ error: "EVENT_RESTORE_WINDOW_EXPIRED" }, 410);
      }
      return { archived_at: null, deleted_at: null, purge_after: null };
    case "trash":
      if (row.deleted_at != null) return json(publicResult(row, true), 200);
      if (row.archived_at != null) return json({ error: "ARCHIVED_EVENT_MUST_BE_RESTORED_BEFORE_TRASH" }, 409);
      return { deleted_at: now, purge_after: timestampAfterDays(now, 30) };
  }
}

function validateBody(body: unknown): {
  eventId: string;
  expectedUpdatedAt: string;
  operation: Operation;
  event?: unknown;
} {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new TypeError("BODY_MUST_BE_OBJECT");
  }
  const source = body as Record<string, unknown>;
  const allowed = new Set(["eventId", "expectedUpdatedAt", "operation", "event"]);
  if (Object.keys(source).some((key) => !allowed.has(key))) {
    throw new RangeError("UNSUPPORTED_MUTATION_FIELD");
  }
  if (typeof source.eventId !== "string" || !UUID_V7_PATTERN.test(source.eventId)) {
    throw new RangeError("EVENT_ID_MUST_BE_UUIDV7");
  }
  if (!validInstant(source.expectedUpdatedAt)) {
    throw new RangeError("EXPECTED_UPDATED_AT_MUST_BE_ISO_INSTANT");
  }
  const operations: Operation[] = ["update", "cancel", "reopen", "finish", "archive", "restore", "trash"];
  if (!operations.includes(source.operation as Operation)) {
    throw new RangeError("UNSUPPORTED_EVENT_OPERATION");
  }
  const operation = source.operation as Operation;
  if (operation === "update" && !Object.prototype.hasOwnProperty.call(source, "event")) {
    throw new RangeError("EVENT_BODY_REQUIRED");
  }
  if (operation !== "update" && Object.prototype.hasOwnProperty.call(source, "event")) {
    throw new RangeError("EVENT_BODY_NOT_ALLOWED_FOR_TRANSITION");
  }
  return {
    eventId: source.eventId.toLowerCase(),
    expectedUpdatedAt: source.expectedUpdatedAt,
    operation,
    ...(operation === "update" ? { event: source.event } : {}),
  };
}

async function writeOwnedEvent(
  admin: AdminClient,
  row: EventRow,
  profileId: string,
  patch: Record<string, unknown>,
): Promise<{ row: EventRow | null; error: unknown | null }> {
  const result = await admin.from("calendar_event")
    .update(patch)
    .eq("id", row.id)
    .eq("owner_user_id", profileId)
    .eq("updated_at", row.updated_at)
    .select("*")
    .maybeSingle();
  return { row: result.data as EventRow | null, error: result.error };
}

/**
 * Authenticated Event mutations. Every lookup/update is owner filtered even
 * though the admin client bypasses RLS. updated_at is the optimistic lock.
 * The database trigger appends the audit record in the same transaction.
 */
export async function handleRequest(
  request: Request,
  ctx: Context,
  dependencies: Dependencies = {},
): Promise<Response> {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: JSON_HEADERS });
  if (request.method !== "PATCH") return json({ error: "METHOD_NOT_ALLOWED" }, 405);
  const contentType = request.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
  if (contentType !== "application/json") return json({ error: "CONTENT_TYPE_MUST_BE_JSON" }, 415);

  const profile = await resolveActiveEventProfile(ctx);
  if (!profile.ok) return json({ error: profile.code }, profile.status);

  let raw: string | null;
  try {
    raw = await readBoundedBody(request);
  } catch {
    return json({ error: "REQUEST_BODY_MUST_BE_VALID_UTF8" }, 400);
  }
  if (raw === null) return json({ error: "REQUEST_BODY_TOO_LARGE" }, 413);

  let parsed: unknown;
  try { parsed = parseJson(raw); } catch { return json({ error: "VALID_JSON_REQUIRED" }, 400); }
  let input: ReturnType<typeof validateBody>;
  try { input = validateBody(parsed); } catch (error) {
    return json({ error: error instanceof Error ? error.message : "INVALID_MUTATION_REQUEST" }, 422);
  }

  try {
    const found = await findOwnedEvent(ctx.supabaseAdmin, input.eventId, profile.profileId);
    if (found.error) return json({ error: "EVENT_LOOKUP_FAILED" }, 503);
    if (!found.row) return json({ error: "EVENT_NOT_FOUND" }, 404);
    const current = found.row;
    const now = (dependencies.now ?? (() => new Date().toISOString()))();

    let patch: Record<string, unknown> | Response;
    if (input.operation === "update") {
      if (!noLifecycleWrite(current)) return json({ error: "RESTORE_EVENT_BEFORE_EDITING" }, 409);
      patch = await buildEditablePatch(input.event, current, profile.profileId, now);
      if (matchesPatch(current, patch)) return json(publicResult(current, true), 200);
    } else {
      patch = transitionPatch(input.operation, current, now);
      if (patch instanceof Response) return patch;
    }

    // Postgres timestamps may carry microseconds; Date.parse truncates to
    // milliseconds. Compare the exact server-returned value to avoid accepting
    // a stale version that differs only below millisecond precision.
    if (current.updated_at !== input.expectedUpdatedAt) {
      return json({ error: "EVENT_CHANGED_RELOAD_AND_RETRY" }, 409);
    }

    const updated = await writeOwnedEvent(ctx.supabaseAdmin, current, profile.profileId, {
      ...patch,
      updated_at: now,
      updated_by_user_id: profile.profileId,
    });
    if (updated.error) return json({ error: "EVENT_MUTATION_FAILED" }, 503);
    if (updated.row) return json(publicResult(updated.row, false), 200);

    // A concurrent retry may have applied the exact same intent first. Return
    // replay success only when the current row already matches every field;
    // otherwise expose the optimistic-concurrency conflict.
    const latest = await findOwnedEvent(ctx.supabaseAdmin, input.eventId, profile.profileId);
    if (latest.error) return json({ error: "EVENT_LOOKUP_FAILED" }, 503);
    if (latest.row && operationAlreadySatisfied(latest.row, input, patch)) {
      return json(publicResult(latest.row, true), 200);
    }
    return json({ error: "EVENT_CHANGED_RELOAD_AND_RETRY" }, 409);
  } catch (error) {
    if (error instanceof TzdbVersionError) return json({ error: "TIMEZONE_RULES_UNAVAILABLE" }, 503);
    if (error instanceof TypeError || error instanceof RangeError) {
      return json({ error: error.message }, 422);
    }
    return json({ error: "EVENT_MUTATION_FAILED" }, 500);
  }
}
