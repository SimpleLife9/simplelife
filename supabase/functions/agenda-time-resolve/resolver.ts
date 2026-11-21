import moment from "moment-timezone";

export const EXPECTED_TZDB_VERSION = "2026f";
export const RESOLVER_VERSION = "agenda-iana-resolver-v1";
export const MAX_GAP_MINUTES = 1440;

type Resolution = "exact" | "ambiguous-first" | "ambiguous-later" | "gap-adjusted-next-valid";
type Input = { localDateTime: string; timeZone: string; disambiguation?: "earlier" | "later" | "reject"; gapStrategy?: "next-valid" | "reject" };
type RangeEndpoint = { localDateTime: string; disambiguation?: "earlier" | "later" | "reject"; gapStrategy?: "next-valid" | "reject" };
type RangeInput = { timeZone: string; start: RangeEndpoint; end: RangeEndpoint };
type NormalizedEndpoint = { input: Input; parsed: { parts: Parts; wall: number } };
type Parts = { year: number; month: number; day: number; hour: number; minute: number; second: number; millisecond: number };
type ZoneData = { name: string; offsets: number[]; utcOffset(timestamp: number): number };
const tz = moment.tz as unknown as { dataVersion: string; zone(name: string): ZoneData | null };
const inputKeys = new Set(["localDateTime", "timeZone", "disambiguation", "gapStrategy"]);
const pattern = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/;

export class TzdbVersionError extends Error {
  constructor(actual: string) {
    super("Expected IANA TZDB " + EXPECTED_TZDB_VERSION + ", received " + (actual || "unknown") + ".");
    this.name = "TzdbVersionError";
  }
}

function toEpoch(p: Parts): number {
  const d = new Date(0);
  d.setUTCFullYear(p.year, p.month - 1, p.day);
  d.setUTCHours(p.hour, p.minute, p.second, p.millisecond);
  return d.getTime();
}
function fromEpoch(epoch: number): Parts {
  const d = new Date(epoch);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate(), hour: d.getUTCHours(), minute: d.getUTCMinutes(), second: d.getUTCSeconds(), millisecond: d.getUTCMilliseconds() };
}
function pad(n: number, width = 2): string { return String(n).padStart(width, "0"); }
function format(p: Parts): string {
  return pad(p.year, 4) + "-" + pad(p.month) + "-" + pad(p.day) + "T" + pad(p.hour) + ":" + pad(p.minute) + ":" + pad(p.second) + "." + pad(p.millisecond, 3);
}
function parse(value: unknown): { parts: Parts; wall: number } {
  if (typeof value !== "string") throw new TypeError("localDateTime must be a local ISO date-time string without an offset.");
  const m = pattern.exec(value);
  if (!m) throw new RangeError("localDateTime must match YYYY-MM-DDTHH:mm[:ss[.SSS]] without an offset.");
  const p: Parts = { year: +m[1], month: +m[2], day: +m[3], hour: +m[4], minute: +m[5], second: +(m[6] || 0), millisecond: +((m[7] || "").padEnd(3, "0") || 0) };
  if (p.year < 1 || p.month < 1 || p.month > 12 || p.day < 1 || p.day > 31 || p.hour > 23 || p.minute > 59 || p.second > 59) throw new RangeError("Invalid local date-time: " + value);
  const wall = toEpoch(p);
  const n = fromEpoch(wall);
  if (format(n) !== format(p)) throw new RangeError("Invalid local date-time: " + value);
  return { parts: p, wall };
}
function candidates(wall: number, zone: ZoneData): number[] {
  const out = new Set<number>();
  for (const offsetWest of new Set(zone.offsets.filter(Number.isFinite))) {
    // IANA Zone offsets are minutes west of UTC: UTC = wall + offset.
    const instant = wall + offsetWest * 60_000;
    if (zone.utcOffset(instant) === offsetWest) out.add(instant);
  }
  return Array.from(out).sort((a, b) => a - b);
}
function resolveResult(input: Input, zone: ZoneData, instant: number, wall: number, resolution: Resolution, adjustmentMinutes: number) {
  return Object.freeze({
    requestedLocalDateTime: input.localDateTime,
    resolvedLocalDateTime: format(fromEpoch(wall)),
    requestedTimeZone: input.timeZone,
    timeZone: zone.name,
    instant: new Date(instant).toISOString(),
    resolution,
    adjustmentMinutes,
    rulesSource: "iana-tzdb",
    rulesVersion: EXPECTED_TZDB_VERSION,
    resolverVersion: RESOLVER_VERSION,
    authoritative: true as const,
  });
}
export function getTzdbVersion(): string { return tz.dataVersion; }
function normalizeEndpoint(value: unknown, timeZone: string, label: "start" | "end"): NormalizedEndpoint {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(label + " must be an object.");
  }
  const endpoint = value as RangeEndpoint;
  const allowed = new Set(["localDateTime", "disambiguation", "gapStrategy"]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new TypeError("Unsupported " + label + " field: " + key);
  }
  const disambiguation = endpoint.disambiguation || "earlier";
  const gapStrategy = endpoint.gapStrategy || "next-valid";
  if (!["earlier", "later", "reject"].includes(disambiguation)) {
    throw new RangeError("Invalid " + label + " fold disambiguation.");
  }
  if (!["next-valid", "reject"].includes(gapStrategy)) {
    throw new RangeError("Invalid " + label + " gap strategy.");
  }
  const input: Input = {
    localDateTime: endpoint.localDateTime,
    timeZone,
    disambiguation,
    gapStrategy,
  };
  return { input, parsed: parse(endpoint.localDateTime) };
}

function resolveParsed(input: Input, zone: ZoneData, parsed: { parts: Parts; wall: number }) {
  const disambiguation = input.disambiguation || "earlier";
  const gapStrategy = input.gapStrategy || "next-valid";
  const exact = candidates(parsed.wall, zone);
  if (exact.length > 2) throw new RangeError("More than two matching instants were found.");
  if (exact.length === 2 && disambiguation === "reject") throw new RangeError("Ambiguous local date-time.");
  if (exact.length) {
    const later = exact.length === 2 && disambiguation === "later";
    return resolveResult(input, zone, exact[later ? 1 : 0], parsed.wall, exact.length === 1 ? "exact" : later ? "ambiguous-later" : "ambiguous-first", 0);
  }
  if (gapStrategy === "reject") throw new RangeError("Nonexistent local date-time.");
  for (let minutes = 1; minutes <= MAX_GAP_MINUTES; minutes++) {
    const nextWall = parsed.wall + minutes * 60_000;
    const found = candidates(nextWall, zone);
    if (found.length > 2) throw new RangeError("More than two matching instants after timezone gap.");
    if (!found.length) continue;
    const later = found.length === 2 && disambiguation === "later";
    return resolveResult(input, zone, found[later ? 1 : 0], nextWall, "gap-adjusted-next-valid", minutes);
  }
  throw new RangeError("Could not resolve a valid local minute within the v1 gap limit.");
}

export function resolveLocalDateTime(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("A JSON object is required.");
  const input = value as Input;
  for (const key of Object.keys(value)) if (!inputKeys.has(key)) throw new TypeError("Unsupported input field: " + key);
  if (typeof input.timeZone !== "string" || !input.timeZone.trim()) throw new TypeError("timeZone must be a non-empty IANA identifier.");
  const disambiguation = input.disambiguation || "earlier";
  const gapStrategy = input.gapStrategy || "next-valid";
  if (!["earlier", "later", "reject"].includes(disambiguation)) throw new RangeError("Invalid fold disambiguation.");
  if (!["next-valid", "reject"].includes(gapStrategy)) throw new RangeError("Invalid gap strategy.");
  if (tz.dataVersion !== EXPECTED_TZDB_VERSION) throw new TzdbVersionError(tz.dataVersion);
  const zone = tz.zone(input.timeZone);
  if (!zone) throw new RangeError("Unsupported IANA time zone: " + input.timeZone);
  const parsed = parse(input.localDateTime);
  return resolveParsed(input, zone, parsed);
}

/**
 * Resolves an Event's start and end together against one already-verified IANA
 * dataset and one canonical timezone object. Each endpoint has independent DST
 * disambiguation, while the range itself is validated using resolved UTC instants.
 */
export function resolveLocalDateTimeRange(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("A JSON object is required.");
  }
  const input = value as RangeInput;
  const allowed = new Set(["timeZone", "start", "end"]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new TypeError("Unsupported range input field: " + key);
  }
  if (typeof input.timeZone !== "string" || !input.timeZone.trim()) {
    throw new TypeError("timeZone must be a non-empty IANA identifier.");
  }

  // Read and verify the TZDB release once for the whole operation. Both
  // endpoints then use this same loaded dataset and the same ZoneData object.
  const rulesVersion = getTzdbVersion();
  if (rulesVersion !== EXPECTED_TZDB_VERSION) throw new TzdbVersionError(rulesVersion);
  const zone = tz.zone(input.timeZone);
  if (!zone) throw new RangeError("Unsupported IANA time zone: " + input.timeZone);

  // Parse both wall times before resolving either endpoint, so malformed input
  // cannot produce a partially meaningful result.
  const start = normalizeEndpoint(input.start, input.timeZone, "start");
  const end = normalizeEndpoint(input.end, input.timeZone, "end");
  const startResult = resolveParsed(start.input, zone, start.parsed);
  const endResult = resolveParsed(end.input, zone, end.parsed);
  const startsAt = Date.parse(startResult.instant);
  const endsAt = Date.parse(endResult.instant);
  if (!Number.isFinite(startsAt) || !Number.isFinite(endsAt) || endsAt <= startsAt) {
    throw new RangeError("Resolved Event end must be after its start.");
  }

  return Object.freeze({
    requestedTimeZone: input.timeZone,
    timeZone: zone.name,
    startsAt: startResult.instant,
    endsAt: endResult.instant,
    start: startResult,
    end: endResult,
    rulesSource: "iana-tzdb",
    rulesVersion,
    resolverVersion: RESOLVER_VERSION,
    authoritative: true as const,
  });
}
