import {
  findProtectedTimeConflicts,
  normalizeProtectedTimeDecisions,
} from "../../../src/features/agenda/domain/protected-time-conflicts.js";
import { resolveLocalDateTimeRange } from "../agenda-time-resolve/resolver.ts";

export const DEFAULT_AGENDA_TIME_ZONE = "America/Havana";
export const MAX_ACTIVE_PROTECTED_TIME_BLOCKS = 500;

type AdminClient = {
  from(table: string): any;
};

type EventRecord = {
  temporal_kind: "all_day" | "zoned_civil" | "fixed_instant";
  start_date?: string | null;
  end_date_exclusive?: string | null;
  starts_at?: string | null;
  ends_at?: string | null;
};

export type ProtectedTimeDecisionInput = {
  blockId: string;
  blockUpdatedAt: string;
  occurrenceStartsAt: string;
  decision: "override_hard" | "keep_flexible";
};

export type ProtectedTimeAssessment = {
  decisions: readonly Record<string, unknown>[];
  snapshot: readonly { id: string; updated_at: string }[];
  conflicts: readonly Record<string, unknown>[];
  calendarTimeZone: string;
};

/**
 * Read the complete owner-scoped active block set and calculate only the
 * occurrences overlapping the candidate Event. The caller must persist both
 * decisions and snapshot through the same Event writer RPC.
 */
export async function assessOwnerProtectedTimeConflicts({
  supabaseAdmin,
  ownerProfileId,
  event,
  suppliedDecisions,
  now,
}: {
  supabaseAdmin: AdminClient;
  ownerProfileId: string;
  event: EventRecord;
  suppliedDecisions?: unknown;
  now: string;
}): Promise<{ ok: true; assessment: ProtectedTimeAssessment } | {
  ok: false;
  code: "PROTECTED_TIME_CONFLICTS" | "PROTECTED_TIME_CONFLICTS_CHANGED";
  conflicts: readonly Record<string, unknown>[];
  snapshot: readonly { id: string; updated_at: string }[];
}> {
  let calendarTimeZone = DEFAULT_AGENDA_TIME_ZONE;
  if (event.temporal_kind === "all_day") {
    const preference = await supabaseAdmin
      .from("user_preference")
      .select("time_zone")
      .eq("user_id", ownerProfileId)
      .maybeSingle();
    if (preference.error) throw new Error("AGENDA_TIME_ZONE_LOOKUP_FAILED");
    if (typeof preference.data?.time_zone === "string" && preference.data.time_zone.trim()) {
      calendarTimeZone = preference.data.time_zone;
    }
  }

  const result = await supabaseAdmin
    .from("protected_time_block")
    .select("id,updated_at,label,category,protection_mode,pattern_kind,time_zone,starts_at,ends_at,start_date,end_date_exclusive,weekdays,start_time_local,end_time_local,ends_next_day,archived_at,deleted_at")
    .eq("owner_user_id", ownerProfileId)
    .is("archived_at", null)
    .is("deleted_at", null)
    .order("id", { ascending: true })
    .limit(MAX_ACTIVE_PROTECTED_TIME_BLOCKS + 1);
  if (result.error) throw new Error("PROTECTED_TIME_CONFLICT_LOOKUP_FAILED");
  const blocks = Array.isArray(result.data) ? result.data : [];
  if (blocks.length > MAX_ACTIVE_PROTECTED_TIME_BLOCKS) {
    throw new RangeError("The owner has more than 500 active Protected Time blocks; conflict analysis cannot safely truncate the set.");
  }

  const analyzed = findProtectedTimeConflicts({
    event,
    protectedBlocks: blocks,
    calendarTimeZone,
    resolveRange: resolveLocalDateTimeRange,
  });
  if (suppliedDecisions !== undefined && !Array.isArray(suppliedDecisions)) {
    throw new RangeError("PROTECTED_TIME_DECISIONS_MUST_BE_AN_ARRAY");
  }
  const normalized = normalizeProtectedTimeDecisions(
    analyzed.conflicts,
    suppliedDecisions === undefined ? [] : suppliedDecisions,
    now,
  );

  if (!normalized.ok) {
    return {
      ok: false,
      code: analyzed.conflicts.length > 0
        ? "PROTECTED_TIME_CONFLICTS"
        : "PROTECTED_TIME_CONFLICTS_CHANGED",
      conflicts: analyzed.conflicts,
      snapshot: analyzed.snapshot,
    };
  }

  return {
    ok: true,
    assessment: {
      decisions: normalized.decisions,
      snapshot: analyzed.snapshot,
      conflicts: analyzed.conflicts,
      calendarTimeZone,
    },
  };
}
