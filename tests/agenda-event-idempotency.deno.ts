import {
  applyAuthoritativeEventResolution,
  createEventDraft,
} from "../src/features/agenda/domain/event.js";
import {
  buildEventCreateIntent,
  EVENT_CREATE_INTENT_VERSION,
  hashEventCreateIntent,
  normalizeEventIdempotencyKey,
} from "../src/features/agenda/domain/event-idempotency.js";

const UUID_V7 = "0190f47a-7b2c-7abc-8def-0123456789ab";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertEquals(actual: unknown, expected: unknown, message: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      message + ": expected " + JSON.stringify(expected) + ", received " + JSON.stringify(actual),
    );
  }
}

function allDayDraft(overrides: Record<string, unknown> = {}) {
  return createEventDraft({
    title: "  Viaje familiar  ",
    temporalKind: "all_day",
    startDate: "2026-12-24",
    endDateExclusive: "2026-12-27",
    ...overrides,
  });
}

function fixedDraft(overrides: Record<string, unknown> = {}) {
  return createEventDraft({
    title: "Webinar",
    description: null,
    temporalKind: "fixed_instant",
    startsAt: "2026-11-02T09:00:00-05:00",
    endsAt: "2026-11-02T10:30:00-05:00",
    sourceTimeZone: "America/New_York",
    ...overrides,
  });
}

function resolvedZonedDraft({
  rulesVersion = "2026f",
  resolverVersion = "agenda-iana-resolver-v1",
  startsAt = "2026-11-01T05:15:00.000Z",
  endsAt = "2026-11-01T06:45:00.000Z",
  canonicalTimeZone = "America/New_York",
}: {
  rulesVersion?: string;
  resolverVersion?: string;
  startsAt?: string;
  endsAt?: string;
  canonicalTimeZone?: string;
} = {}) {
  const draft = createEventDraft({
    title: "Consulta médica",
    temporalKind: "zoned_civil",
    timeZone: "US/Eastern",
    startLocalDateTime: "2026-11-01T01:15",
    endLocalDateTime: "2026-11-01T01:45",
    endDisambiguation: "later",
  });
  return applyAuthoritativeEventResolution(draft, {
    requestedTimeZone: "US/Eastern",
    timeZone: canonicalTimeZone,
    startsAt,
    endsAt,
    start: {
      requestedLocalDateTime: "2026-11-01T01:15:00.000",
      timeZone: canonicalTimeZone,
      instant: startsAt,
      resolution: "ambiguous-first",
      rulesSource: "iana-tzdb",
      rulesVersion,
      resolverVersion,
      authoritative: true,
    },
    end: {
      requestedLocalDateTime: "2026-11-01T01:45:00.000",
      timeZone: canonicalTimeZone,
      instant: endsAt,
      resolution: "ambiguous-later",
      rulesSource: "iana-tzdb",
      rulesVersion,
      resolverVersion,
      authoritative: true,
    },
    rulesSource: "iana-tzdb",
    rulesVersion,
    resolverVersion,
    authoritative: true,
  });
}

Deno.test("normalizes a separate UUIDv7 Idempotency-Key", () => {
  assertEquals(normalizeEventIdempotencyKey(UUID_V7.toUpperCase()), UUID_V7, "key must normalize to lowercase");
  let rejected = false;
  try {
    normalizeEventIdempotencyKey("0190f47a-7b2c-4abc-8def-0123456789ab");
  } catch {
    rejected = true;
  }
  assert(rejected, "non-v7 keys must be rejected");
});

Deno.test("builds a versioned canonical all-day intent with normalized defaults", () => {
  const first = buildEventCreateIntent(allDayDraft());
  const second = buildEventCreateIntent(allDayDraft({
    title: "Viaje familiar",
    description: null,
    locationLabel: null,
    locationKind: null,
    eventStatus: "confirmed",
  }));

  assertEquals(first, second, "omitted defaults and explicit defaults must be equivalent");
  assertEquals(JSON.parse(first.canonicalPayload), [
    EVENT_CREATE_INTENT_VERSION,
    "Viaje familiar",
    null,
    null,
    null,
    "confirmed",
    "all_day",
    "2026-12-24",
    "2026-12-27",
  ], "canonical all-day intent must use the fixed positional format");
});

Deno.test("canonicalizes equivalent JSON property orders through the normalized domain draft", () => {
  const left = createEventDraft({
    title: "Reunión",
    temporalKind: "fixed_instant",
    startsAt: "2026-11-02T14:00:00.000Z",
    endsAt: "2026-11-02T15:30:00.000Z",
    sourceTimeZone: "America/New_York",
  });
  const right = createEventDraft({
    sourceTimeZone: "America/New_York",
    endsAt: "2026-11-02T10:30:00-05:00",
    temporalKind: "fixed_instant",
    startsAt: "2026-11-02T09:00:00-05:00",
    title: " Reunión ",
  });
  assertEquals(
    buildEventCreateIntent(left).canonicalPayload,
    buildEventCreateIntent(right).canonicalPayload,
    "JSON input order and equivalent instant offsets must not alter the canonical intent",
  );
});

Deno.test("excludes authoritative resolver/TZDB outputs from zoned-civil request identity", () => {
  const first = resolvedZonedDraft();
  const replayedUnderNewResolver = resolvedZonedDraft({
    rulesVersion: "2027a",
    resolverVersion: "agenda-iana-resolver-v2",
    startsAt: "2026-11-01T05:15:00.000Z",
    endsAt: "2026-11-01T06:45:00.000Z",
    canonicalTimeZone: "America/New_York",
  });
  assertEquals(
    buildEventCreateIntent(first).canonicalPayload,
    buildEventCreateIntent(replayedUnderNewResolver).canonicalPayload,
    "resolver version metadata must not change user-intent identity",
  );
});

Deno.test("includes all user-visible semantic fields in the request hash", async () => {
  const base = await hashEventCreateIntent(allDayDraft());
  const variants = [
    allDayDraft({ title: "Otro viaje" }),
    allDayDraft({ description: "Fin de semana" }),
    allDayDraft({ eventStatus: "preparing" }),
    allDayDraft({ endDateExclusive: "2026-12-28" }),
  ];

  for (const variant of variants) {
    const candidate = await hashEventCreateIntent(variant);
    assert(candidate.payloadHash !== base.payloadHash, "a changed semantic field must change the hash");
  }
});

Deno.test("binds explicit Protected Time decisions to Event create idempotency", async () => {
  const draft = allDayDraft();
  const base = await hashEventCreateIntent(draft);
  const decisions = [
    {
      blockId: "019a0000-0000-7000-8000-000000000111",
      blockUpdatedAt: "2026-11-20T10:00:00.000000+00:00",
      occurrenceStartsAt: "2026-12-24T06:00:00.000Z",
      decision: "override_hard",
    },
    {
      blockId: "019a0000-0000-7000-8000-000000000112",
      blockUpdatedAt: "2026-11-20T11:00:00.000000+00:00",
      occurrenceStartsAt: "2026-12-24T07:00:00.000Z",
      decision: "keep_flexible",
    },
  ];
  const accepted = await hashEventCreateIntent(draft, undefined, decisions);
  const reordered = await hashEventCreateIntent(draft, undefined, [...decisions].reverse());
  const changedChoice = await hashEventCreateIntent(draft, undefined, [
    decisions[0],
    { ...decisions[1], decision: "keep_flexible" === decisions[1].decision ? "override_hard" : "keep_flexible" },
  ]);

  assertEquals(base.payloadHash, (await hashEventCreateIntent(draft, undefined, [])).payloadHash,
    "empty decisions preserve the historical Event-create intent hash");
  assert(accepted.payloadHash !== base.payloadHash,
    "explicit consent must participate in Event-create idempotency");
  assertEquals(accepted.payloadHash, reordered.payloadHash,
    "decision array order does not change canonical idempotency identity");
  assert(accepted.payloadHash !== changedChoice.payloadHash,
    "a changed consent action cannot reuse the same create idempotency intent");
});

Deno.test("hashes equivalent normalized payloads identically with SHA-256", async () => {
  const a = await hashEventCreateIntent(fixedDraft());
  const b = await hashEventCreateIntent(fixedDraft({
    startsAt: "2026-11-02T14:00:00.000Z",
    endsAt: "2026-11-02T15:30:00.000Z",
  }));

  assertEquals(a.payloadHash, b.payloadHash, "equivalent fixed instants must have identical hashes");
  assertEquals(a.hashAlgorithm, "sha-256", "hash algorithm is explicit");
  assert(/^[0-9a-f]{64}$/.test(a.payloadHash), "SHA-256 must be lowercase 64-character hex");
});

Deno.test("keeps temporal intent kinds distinct", () => {
  const allDay = buildEventCreateIntent(allDayDraft());
  const fixed = buildEventCreateIntent(fixedDraft());
  assert(allDay.canonicalPayload !== fixed.canonicalPayload, "different temporal kinds must not collide");
});

Deno.test("does not accept server-owned identity fields in an Event draft", () => {
  let rejected = false;
  try {
    createEventDraft({
      title: "Forbidden owner override",
      temporalKind: "all_day",
      startDate: "2026-12-24",
      endDateExclusive: "2026-12-25",
      ownerUserId: "0190f47a-7b2c-7abc-8def-0123456789ac",
    });
  } catch {
    rejected = true;
  }
  assert(rejected, "owner identity must not be part of the client Event payload");
});
