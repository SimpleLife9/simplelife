import { authenticatedHandler } from "../supabase/functions/agenda-time-resolve/index.ts";

const URL = "http://127.0.0.1/agenda-time-resolve";
const SUPABASE_URL = "https://abcdefghijklmnopqrst.supabase.co";
const PUBLISHABLE_KEY = "sb_publishable_agenda_auth_ci_mock_key_0123456789";
const SECRET_KEY = "sb_secret_agenda_auth_ci_mock_key_0123456789";
const USER_ID = "00000000-0000-4000-8000-000000000001";
const KEY_ID = "agenda-auth-ci-rs256";

function equal<T>(actual: T, expected: T, label: string): void {
  if (actual !== expected) {
    throw new Error(label + ": expected " + String(expected) + ", received " + String(actual));
  }
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function createUserJwt(): Promise<{ token: string; publicJwk: JsonWebKey }> {
  const pair = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  ) as CryptoKeyPair;

  const exported = await crypto.subtle.exportKey("jwk", pair.publicKey);
  const publicJwk = {
    ...exported,
    alg: "RS256",
    use: "sig",
    kid: KEY_ID,
  } as JsonWebKey & { kid: string };
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(new TextEncoder().encode(JSON.stringify({
    alg: "RS256",
    typ: "JWT",
    kid: KEY_ID,
  })));
  const payload = base64Url(new TextEncoder().encode(JSON.stringify({
    iss: SUPABASE_URL + "/auth/v1",
    aud: "authenticated",
    exp: now + 300,
    iat: now,
    sub: USER_ID,
    role: "authenticated",
    email: "agenda-auth-ci@example.invalid",
    phone: "",
    app_metadata: {},
    user_metadata: {},
    aal: "aal1",
    session_id: "00000000-0000-4000-8000-000000000002",
    is_anonymous: false,
  })));
  const signingInput = header + "." + payload;
  const signature = new Uint8Array(await crypto.subtle.sign(
    { name: "RSASSA-PKCS1-v1_5" },
    pair.privateKey,
    new TextEncoder().encode(signingInput),
  ));
  return { token: signingInput + "." + base64Url(signature), publicJwk };
}

Deno.test("user auth wrapper accepts a signed user JWT and rejects API keys or invalid JWTs as Bearer", async () => {
  const envNames = [
    "SUPABASE_URL",
    "SUPABASE_PUBLISHABLE_KEYS",
    "SUPABASE_SECRET_KEYS",
    "SUPABASE_JWKS",
  ];
  const previous = new Map(envNames.map((name) => [name, Deno.env.get(name)]));

  try {
    const { token, publicJwk } = await createUserJwt();
    Deno.env.set("SUPABASE_URL", SUPABASE_URL);
    Deno.env.set("SUPABASE_PUBLISHABLE_KEYS", JSON.stringify({ default: PUBLISHABLE_KEY }));
    Deno.env.set("SUPABASE_SECRET_KEYS", JSON.stringify({ default: SECRET_KEY }));
    Deno.env.set("SUPABASE_JWKS", JSON.stringify({ keys: [publicJwk] }));

    const payload = JSON.stringify({
      localDateTime: "2026-11-01T01:30",
      timeZone: "America/Havana",
    });

    const valid = await authenticatedHandler(new Request(URL, {
      method: "POST",
      headers: {
        authorization: "Bearer " + token,
        apikey: PUBLISHABLE_KEY,
        "content-type": "application/json",
      },
      body: payload,
    }));
    equal(valid.status, 200, "valid user JWT status");
    const resolved = await valid.json() as Record<string, unknown>;
    equal(resolved.instant, "2026-11-01T05:30:00.000Z", "valid user JWT reaches resolver");

    const batchPayload = JSON.stringify({
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
    });
    const validBatch = await authenticatedHandler(new Request(URL, {
      method: "POST",
      headers: {
        authorization: "Bearer " + token,
        apikey: PUBLISHABLE_KEY,
        "content-type": "application/json",
      },
      body: batchPayload,
    }));
    equal(validBatch.status, 200, "valid user JWT batch status");
    const batchResult = await validBatch.json() as {
      count: number;
      results: Array<{ startsAt: string; endsAt: string }>;
      rulesVersion: string;
      authoritative: boolean;
    };
    equal(batchResult.count, 2, "authenticated batch count");
    equal(batchResult.results[0].startsAt, "2026-10-30T13:00:00.000Z", "authenticated batch first start");
    equal(batchResult.results[0].endsAt, "2026-10-30T14:00:00.000Z", "authenticated batch first end");
    equal(batchResult.results[1].startsAt, "2026-11-02T14:00:00.000Z", "authenticated batch second start");
    equal(batchResult.results[1].endsAt, "2026-11-02T15:30:00.000Z", "authenticated batch second end");
    equal(batchResult.rulesVersion, "2026f", "authenticated batch TZDB version");
    equal(batchResult.authoritative, true, "authenticated batch authoritative flag");

    const apiKeyAsBearer = await authenticatedHandler(new Request(URL, {
      method: "POST",
      headers: {
        authorization: "Bearer " + PUBLISHABLE_KEY,
        apikey: PUBLISHABLE_KEY,
        "content-type": "application/json",
      },
      body: payload,
    }));
    equal(apiKeyAsBearer.status, 401, "publishable key cannot impersonate a user JWT");

    const invalidJwt = await authenticatedHandler(new Request(URL, {
      method: "POST",
      headers: {
        authorization: "Bearer not.a.valid.jwt",
        apikey: PUBLISHABLE_KEY,
        "content-type": "application/json",
      },
      body: payload,
    }));
    equal(invalidJwt.status, 401, "invalid JWT status");
  } finally {
    for (const [name, value] of previous) {
      if (value === undefined) Deno.env.delete(name);
      else Deno.env.set(name, value);
    }
  }
});
