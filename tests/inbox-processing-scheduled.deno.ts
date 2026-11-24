import { handleRequest } from "../supabase/functions/inbox-processing-scheduled/handler.ts";

const URL = "https://simplelife-dev.example.invalid";
const TOKEN = "t".repeat(64);
const SECRET = "sb_secret_test_only_123456789012345";

function request(token = TOKEN, body = "{}"): Request {
  return new Request("https://local.test/scheduled", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-inbox-scheduler-token": token,
    },
    body,
  });
}

Deno.test("scheduled endpoint validates the Vault token before invoking the dispatcher", async () => {
  const calls: Array<{url:string;headers:Headers;body:string}> = [];
  const response = await handleRequest(request(), {
    env: (name) => {
      const values: Record<string, string> = {
        SUPABASE_URL: URL,
        SUPABASE_SECRET_KEYS: JSON.stringify({ default: SECRET }),
      };
      return values[name];
    },
    fetcher: async (input, init) => {
      const headers = new Headers(init?.headers);
      calls.push({ url: String(input), headers, body: String(init?.body || "") });
      if (calls.length === 1) return new Response("true", { status: 200 });
      return new Response(JSON.stringify({ accepted: true, status: "queue_empty", claimed: 0 }), {
        status: 200, headers: { "content-type": "application/json" },
      });
    },
  });

  if (response.status !== 200) throw new Error("Scheduled dispatch did not complete.");
  const result = await response.json();
  if (result.accepted !== true || calls.length !== 2) {
    throw new Error("Scheduled dispatcher was not invoked exactly once after validation.");
  }
  if (!calls[0].url.endsWith("/rest/v1/rpc/validate_inbox_scheduler_token")
      || JSON.parse(calls[0].body).p_token !== TOKEN) {
    throw new Error("Vault token was not validated using the dedicated RPC.");
  }
  if (calls[0].headers.get("apikey") !== SECRET || calls[0].headers.has("authorization")) {
    throw new Error("Secret API key must use apikey header only, not Bearer Authorization.");
  }
  if (!calls[1].url.endsWith("/functions/v1/inbox-processing-dispatcher")
      || JSON.parse(calls[1].body).maxJobs !== 10
      || calls[1].headers.get("apikey") !== SECRET) {
    throw new Error("Dispatcher call did not use the internal secret API key and bounded batch.");
  }
});

Deno.test("scheduled endpoint refuses invalid tokens without dispatching", async () => {
  let calls = 0;
  const response = await handleRequest(request("x".repeat(64)), {
    env: (name) => {
      const values: Record<string, string> = {
        SUPABASE_URL: URL,
        SUPABASE_SECRET_KEYS: JSON.stringify({ default: SECRET }),
      };
      return values[name];
    },
    fetcher: async () => {
      calls += 1;
      return new Response("false", { status: 200 });
    },
  });
  if (response.status !== 401 || calls !== 1) {
    throw new Error("Invalid scheduler token reached the dispatcher.");
  }
});

Deno.test("scheduled endpoint fails closed for missing secret configuration and oversized payloads", async () => {
  const missing = await handleRequest(request(), {
    env: () => undefined,
    fetcher: async () => { throw new Error("must not run"); },
  });
  if (missing.status !== 503) throw new Error("Missing scheduler config did not fail closed.");

  const oversized = await handleRequest(request(TOKEN, "x".repeat(2048)), {
    env: (name) => {
      const values: Record<string, string> = {
        SUPABASE_URL: URL,
        SUPABASE_SECRET_KEYS: JSON.stringify({ default: SECRET }),
      };
      return values[name];
    },
    fetcher: async () => { throw new Error("must not run"); },
  });
  if (oversized.status !== 413) throw new Error("Oversized scheduler body was not rejected.");
});
