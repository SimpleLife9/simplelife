export const MAX_BODY_BYTES = 1024;
const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
};

type Dependencies = {
  env?: (name: string) => string | undefined;
  fetcher?: typeof fetch;
};

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function resolveSecretApiKey(env: (name: string) => string | undefined): string | null {
  const secretKeysText = env("SUPABASE_SECRET_KEYS");
  if (secretKeysText) {
    try {
      const keys = JSON.parse(secretKeysText) as Record<string, unknown>;
      const named = keys.default ?? keys.service_role;
      if (typeof named === "string" && named.length > 20) return named;
      const anySecret = Object.values(keys).find((value) =>
        typeof value === "string" && value.startsWith("sb_secret_")
      );
      if (typeof anySecret === "string") return anySecret;
    } catch {
      return null;
    }
  }
  // Local Supabase fallback only. Hosted projects provide SUPABASE_SECRET_KEYS.
  const legacy = env("SUPABASE_SERVICE_ROLE_KEY");
  return legacy && legacy.length > 20 ? legacy : null;
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
      total += value?.byteLength || 0;
      if (total > MAX_BODY_BYTES) {
        try { await reader.cancel(); } catch { /* best effort */ }
        return null;
      }
      if (value) chunks.push(value);
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

/** Vault-token gate for pg_cron. The function itself is not JWT-authenticated. */
export async function handleRequest(
  request: Request,
  dependencies: Dependencies = {},
): Promise<Response> {
  if (request.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405);
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
    return json({ error: "CONTENT_TYPE_MUST_BE_JSON" }, 415);
  }
  let raw: string | null;
  try { raw = await readBoundedBody(request); } catch {
    return json({ error: "REQUEST_BODY_MUST_BE_VALID_UTF8" }, 400);
  }
  if (raw === null) return json({ error: "REQUEST_BODY_TOO_LARGE" }, 413);
  if (raw.trim() && raw.trim() !== "{}") return json({ error: "EMPTY_JSON_OBJECT_REQUIRED" }, 422);

  const env = dependencies.env ?? ((name: string) => Deno.env.get(name));
  const fetcher = dependencies.fetcher ?? fetch;
  const supabaseUrl = env("SUPABASE_URL")?.replace(/\/+$/, "");
  const schedulerToken = request.headers.get("x-inbox-scheduler-token") || "";
  const secretApiKey = resolveSecretApiKey(env);
  let parsedUrl: URL | null = null;
  try { parsedUrl = supabaseUrl ? new URL(supabaseUrl) : null; } catch { parsedUrl = null; }
  const localHttp = parsedUrl?.protocol === "http:"
    && ["127.0.0.1", "localhost", "kong"].includes(parsedUrl.hostname);

  if (!parsedUrl || (parsedUrl.protocol !== "https:" && !localHttp) || !secretApiKey) {
    return json({ error: "SCHEDULER_CONFIGURATION_UNAVAILABLE" }, 503);
  }
  if (schedulerToken.length < 32 || schedulerToken.length > 256) {
    return json({ error: "SCHEDULER_TOKEN_REQUIRED" }, 401);
  }

  let validation: Response;
  try {
    validation = await fetcher(supabaseUrl + "/rest/v1/rpc/validate_inbox_scheduler_token", {
      method: "POST",
      headers: {
        apikey: secretApiKey,
        "content-type": "application/json",
        "cache-control": "no-store",
      },
      body: JSON.stringify({ p_token: schedulerToken }),
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    return json({ error: "SCHEDULER_TOKEN_VALIDATION_UNAVAILABLE" }, 503);
  }
  if (!validation.ok) return json({ error: "SCHEDULER_TOKEN_VALIDATION_UNAVAILABLE" }, 503);
  const isValid = await validation.json().catch(() => false);
  if (isValid !== true) return json({ error: "SCHEDULER_TOKEN_INVALID" }, 401);

  let dispatch: Response;
  try {
    dispatch = await fetcher(supabaseUrl + "/functions/v1/inbox-processing-dispatcher", {
      method: "POST",
      headers: {
        apikey: secretApiKey,
        "content-type": "application/json",
        "cache-control": "no-store",
      },
      body: JSON.stringify({ maxJobs: 10 }),
      signal: AbortSignal.timeout(60000),
    });
  } catch {
    return json({ error: "INBOX_DISPATCHER_UNAVAILABLE" }, 503);
  }
  if (!dispatch.ok) return json({ error: "INBOX_DISPATCHER_REJECTED_REQUEST" }, 502);

  const result = await dispatch.json().catch(() => null);
  if (!result || typeof result !== "object") {
    return json({ error: "INBOX_DISPATCHER_RESPONSE_INVALID" }, 502);
  }
  return json({ accepted: true, dispatcher: result }, 200);
}
