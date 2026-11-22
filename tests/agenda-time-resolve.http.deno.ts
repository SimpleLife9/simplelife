import { handleRequest, MAX_REQUEST_BYTES } from "../supabase/functions/agenda-time-resolve/handler.ts";

const URL = "http://127.0.0.1/agenda-time-resolve";
const JSON_HEADERS = { "content-type": "application/json" };

function equal<T>(actual: T, expected: T, label: string): void {
  if (actual !== expected) {
    throw new Error(label + ": expected " + String(expected) + ", received " + String(actual));
  }
}

async function json(response: Response): Promise<Record<string, unknown>> {
  return await response.json() as Record<string, unknown>;
}

Deno.test("HTTP OPTIONS preflight is answered without invoking the resolver", async () => {
  const response = await handleRequest(new Request(URL, { method: "OPTIONS" }));
  equal(response.status, 204, "preflight status");
  equal(response.headers.get("access-control-allow-origin"), "*", "CORS origin");
  equal(response.headers.get("access-control-allow-methods"), "POST, OPTIONS", "CORS methods");
});

Deno.test("only POST is accepted", async () => {
  const response = await handleRequest(new Request(URL, { method: "GET" }));
  equal(response.status, 405, "method status");
  equal((await json(response)).error, "Method not allowed.", "method error");
});

Deno.test("JSON content type is mandatory", async () => {
  const response = await handleRequest(new Request(URL, {
    method: "POST",
    headers: { "content-type": "text/plain" },
    body: "{}",
  }));
  equal(response.status, 415, "media type status");
});

Deno.test("malformed JSON is rejected with a stable 400 response", async () => {
  const response = await handleRequest(new Request(URL, {
    method: "POST",
    headers: JSON_HEADERS,
    body: "{broken",
  }));
  equal(response.status, 400, "JSON status");
  equal((await json(response)).error, "Valid JSON is required.", "JSON error");
});

Deno.test("invalid UTF-8 is rejected", async () => {
  const response = await handleRequest(new Request(URL, {
    method: "POST",
    headers: JSON_HEADERS,
    body: new Uint8Array([0xff, 0xfe]),
  }));
  equal(response.status, 400, "UTF-8 status");
});

Deno.test("request body is limited by bytes before JSON parsing", async () => {
  const response = await handleRequest(new Request(URL, {
    method: "POST",
    headers: JSON_HEADERS,
    body: " ".repeat(MAX_REQUEST_BYTES + 1),
  }));
  equal(response.status, 413, "body limit status");
  equal((await json(response)).error, "Request body too large.", "body limit error");
});

Deno.test("a body exactly at the byte limit is not rejected as oversized", async () => {
  const body = " ".repeat(MAX_REQUEST_BYTES - 2) + "{}";
  equal(new TextEncoder().encode(body).byteLength, MAX_REQUEST_BYTES, "test body byte length");
  const response = await handleRequest(new Request(URL, {
    method: "POST",
    headers: JSON_HEADERS,
    body,
  }));
  equal(response.status, 422, "exact limit reaches domain validation");
});

Deno.test("valid HTTP request returns a versioned Cuba resolution", async () => {
  const response = await handleRequest(new Request(URL, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({
      localDateTime: "2026-11-01T01:30",
      timeZone: "America/Havana",
    }),
  }));
  equal(response.status, 200, "success status");
  equal(response.headers.get("cache-control"), "no-store", "cache policy");
  const result = await json(response);
  equal(result.instant, "2026-11-01T05:30:00.000Z", "Cuba instant");
  equal(result.rulesVersion, "2026f", "TZDB release");
  equal(result.authoritative, true, "pinned rules marker");
});

Deno.test("domain validation failures map to 422 without leaking internal exceptions", async () => {
  const response = await handleRequest(new Request(URL, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({
      localDateTime: "2026-11-01T01:30",
      timeZone: "Invalid/Unknown",
    }),
  }));
  equal(response.status, 422, "domain validation status");
  equal((await json(response)).error, "Unsupported IANA time zone: Invalid/Unknown", "domain validation error");
});

Deno.test("DST ambiguity reject policy is surfaced as 422", async () => {
  const response = await handleRequest(new Request(URL, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({
      localDateTime: "2026-11-01T01:30",
      timeZone: "America/New_York",
      disambiguation: "reject",
    }),
  }));
  equal(response.status, 422, "ambiguous time status");
  equal((await json(response)).error, "Ambiguous local date-time.", "ambiguous time error");
});

Deno.test("HTTP accepts an atomic event range and returns both UTC instants", async () => {
  const response = await handleRequest(new Request(URL, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({
      timeZone: "America/New_York",
      start: { localDateTime: "2026-11-02T09:00" },
      end: { localDateTime: "2026-11-02T10:30" },
    }),
  }));
  equal(response.status, 200, "range status");
  const result = await json(response);
  equal(result.startsAt, "2026-11-02T14:00:00.000Z", "range start");
  equal(result.endsAt, "2026-11-02T15:30:00.000Z", "range end");
  equal(result.rulesVersion, "2026f", "atomic range rules version");
  equal(result.authoritative, true, "atomic range authoritative flag");
});

Deno.test("HTTP rejects a range whose selected fold endpoints reverse the UTC interval", async () => {
  const response = await handleRequest(new Request(URL, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({
      timeZone: "America/New_York",
      start: { localDateTime: "2026-11-01T01:45", disambiguation: "later" },
      end: { localDateTime: "2026-11-01T01:50", disambiguation: "earlier" },
    }),
  }));
  equal(response.status, 422, "reversed fold range status");
  equal((await json(response)).error, "Resolved Event end must be after its start.", "reversed range error");
});


Deno.test("HTTP resolves a bounded batch of ranges in request order", async () => {
  const response = await handleRequest(new Request(URL, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({
      ranges: [
        {
          timeZone: "America/Havana",
          start: { localDateTime: "2026-10-30T09:00" },
          end: { localDateTime: "2026-10-30T10:00" },
        },
        {
          timeZone: "America/New_York",
          start: { localDateTime: "2026-11-02T09:00" },
          end: { localDateTime: "2026-11-02T10:30" },
        },
      ],
    }),
  }));
  equal(response.status, 200, "batch success status");
  const result = await json(response);
  equal(result.count, 2, "batch count");
  equal(result.rulesVersion, "2026f", "batch TZDB version");
  equal(result.authoritative, true, "batch authoritative marker");
  const results = result.results as Record<string, unknown>[];
  equal(results.length, 2, "batch result count");
  equal(results[0].startsAt, "2026-10-30T13:00:00.000Z", "first range start");
  equal(results[0].endsAt, "2026-10-30T14:00:00.000Z", "first range end");
  equal(results[1].startsAt, "2026-11-02T14:00:00.000Z", "second range start");
  equal(results[1].endsAt, "2026-11-02T15:30:00.000Z", "second range end");
});

Deno.test("HTTP rejects empty, oversized and partially invalid range batches", async () => {
  const baseRange = {
    timeZone: "America/Havana",
    start: { localDateTime: "2026-10-30T09:00" },
    end: { localDateTime: "2026-10-30T10:00" },
  };
  for (const [ranges, label] of [
    [[], "empty"],
    [Array.from({ length: 26 }, () => baseRange), "oversized"],
    [[baseRange, { ...baseRange, end: { localDateTime: "2026-10-30T09:00" } }], "partially invalid"],
  ] as const) {
    const response = await handleRequest(new Request(URL, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ ranges }),
    }));
    equal(response.status, 422, label + " batch status");
    const body = await json(response);
    equal(typeof body.error, "string", label + " batch error");
  }
});
