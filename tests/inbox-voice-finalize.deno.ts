import { handleRequest } from "../supabase/functions/inbox-voice-finalize/handler.ts";

const AUTH_USER_ID = "00000000-0000-4000-8000-000000000001";
const OWNER_ID = "0190f47a-7b2c-7abc-8def-0123456789ac";
const ASSET_ID = "0190f47a-7b2c-7abc-8def-0123456789ad";
const PATH = OWNER_ID + "/" + ASSET_ID + "/source.webm";
const AUDIO = new TextEncoder().encode("private voice fixture bytes");
const HEX = (bytes: ArrayBuffer) => [...new Uint8Array(bytes)]
  .map((value) => value.toString(16).padStart(2, "0")).join("");

function copyToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

async function digest(bytes: Uint8Array): Promise<string> {
  return HEX(await crypto.subtle.digest("SHA-256", copyToArrayBuffer(bytes)));
}

function request(payload: unknown = { assetId: ASSET_ID }, headers: Record<string, string> = {}) {
  return new Request("https://local.test/inbox-voice-finalize", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(payload),
  });
}

function context({
  profileStatus = "active",
  assetOverrides = {},
  assetMissing = false,
  downloaded = AUDIO,
  downloadError = null,
}: {
  profileStatus?: string;
  assetOverrides?: Record<string, unknown>;
  assetMissing?: boolean;
  downloaded?: Uint8Array | null;
  downloadError?: unknown;
} = {}) {
  const calls: { tables: string[]; downloadPaths: string[]; rpc: Array<{ name: string; args: Record<string, unknown> }> } = {
    tables: [], downloadPaths: [], rpc: [],
  };
  const asset = {
    id: ASSET_ID,
    owner_user_id: OWNER_ID,
    bucket_id: "inbox-voice-private",
    object_path: PATH,
    mime_type: "audio/webm",
    file_size_bytes: AUDIO.byteLength,
    sha256_hex: "0".repeat(64),
    capture_id: null,
    status: "uploading",
    ...assetOverrides,
  };
  const supabase = {
    from(table: string) {
      calls.tables.push("user:" + table);
      return {
        select() { return this; },
        eq() { return this; },
        async maybeSingle() {
          return { data: { id: OWNER_ID, auth_user_id: AUTH_USER_ID, account_status: profileStatus }, error: null };
        },
      };
    },
  };
  const supabaseAdmin = {
    from(table: string) {
      calls.tables.push("admin:" + table);
      return {
        select() { return this; },
        eq() { return this; },
        async maybeSingle() {
          return { data: assetMissing ? null : asset, error: null };
        },
      };
    },
    storage: {
      from(bucket: string) {
        if (bucket !== "inbox-voice-private") throw new Error("unexpected bucket");
        return {
          async download(path: string) {
            calls.downloadPaths.push(path);
            return {
              data: downloaded === null ? null : new Blob([copyToArrayBuffer(downloaded)]),
              error: downloadError,
            };
          },
        };
      },
    },
    async rpc(name: string, args: Record<string, unknown>) {
      calls.rpc.push({ name, args });
      return { data: true, error: null };
    },
  };
  return {
    ctx: { authMode: "user", userClaims: { id: AUTH_USER_ID }, supabase, supabaseAdmin },
    calls,
  };
}

Deno.test("voice finalizer hashes the downloaded private Storage bytes before the privileged RPC", async () => {
  const sha256 = await digest(AUDIO);
  const fixture = context({ assetOverrides: { sha256_hex: sha256 } });
  const response = await handleRequest(request(), fixture.ctx as never);
  if (response.status !== 200) throw new Error("valid audio finalization failed: " + await response.text());
  const result = await response.json();
  if (result.verified !== true || fixture.calls.downloadPaths[0] !== PATH) {
    throw new Error("finalizer did not verify the database-owned Storage object");
  }
  if (fixture.calls.rpc.length !== 1
    || fixture.calls.rpc[0].name !== "finalize_inbox_audio_upload_verified"
    || fixture.calls.rpc[0].args.p_sha256_hex !== sha256
    || fixture.calls.rpc[0].args.p_file_size_bytes !== AUDIO.byteLength
    || fixture.calls.rpc[0].args.p_owner_profile_id !== OWNER_ID) {
    throw new Error("privileged finalizer did not receive the server-computed digest and owner");
  }
});

Deno.test("voice finalizer re-verifies uploaded assets and returns an idempotent replay receipt", async () => {
  const sha256 = await digest(AUDIO);
  const fixture = context({ assetOverrides: { sha256_hex: sha256, status: "uploaded" } });
  const response = await handleRequest(request(), fixture.ctx as never);
  if (response.status !== 200) throw new Error("verified retry of an uploaded asset failed");
  const result = await response.json();
  if (result.verified !== true || result.replayed !== true || fixture.calls.rpc.length !== 1) {
    throw new Error("uploaded asset retry was not verified and acknowledged idempotently");
  }
});

Deno.test("voice finalizer rejects bytes whose actual SHA-256 differs from client metadata", async () => {
  const otherBytes = new TextEncoder().encode("different voice fixture bytes");
  const fixture = context({
    assetOverrides: { sha256_hex: await digest(AUDIO), file_size_bytes: otherBytes.byteLength },
    downloaded: otherBytes,
  });
  const response = await handleRequest(request(), fixture.ctx as never);
  if (response.status !== 422 || fixture.calls.rpc.length !== 0) {
    throw new Error("a mismatched Storage digest reached finalization");
  }
  const result = await response.json();
  if (result.error !== "VOICE_UPLOAD_INTEGRITY_CHECK_FAILED") {
    throw new Error("digest mismatch returned an unexpected result");
  }
});

Deno.test("voice finalizer rejects Storage size mismatch before calculating or persisting a digest", async () => {
  const fixture = context({
    assetOverrides: { sha256_hex: await digest(AUDIO), file_size_bytes: AUDIO.byteLength + 1 },
  });
  const response = await handleRequest(request(), fixture.ctx as never);
  if (response.status !== 422 || fixture.calls.rpc.length !== 0) {
    throw new Error("size mismatch reached privileged finalization");
  }
});

Deno.test("voice finalizer never downloads or finalizes another owner's asset", async () => {
  const fixture = context({ assetMissing: true });
  const response = await handleRequest(request(), fixture.ctx as never);
  if (response.status !== 404 || fixture.calls.downloadPaths.length !== 0 || fixture.calls.rpc.length !== 0) {
    throw new Error("owner isolation was not enforced before Storage access");
  }
});

Deno.test("voice finalizer rejects an inactive owner before privileged lookup", async () => {
  const fixture = context({ profileStatus: "disabled" });
  const response = await handleRequest(request(), fixture.ctx as never);
  if (response.status !== 403 || fixture.calls.tables.includes("admin:capture_audio_asset")
    || fixture.calls.rpc.length !== 0) {
    throw new Error("inactive owner reached voice asset finalization");
  }
});

Deno.test("voice finalizer validates method, content type, payload shape and UUID before database access", async () => {
  const fixture = context();
  if ((await handleRequest(new Request("https://local.test", { method: "GET" }), fixture.ctx as never)).status !== 405) {
    throw new Error("non-POST request was accepted");
  }
  const wrongType = new Request("https://local.test", { method: "POST", headers: { "content-type": "text/plain" }, body: "x" });
  if ((await handleRequest(wrongType, fixture.ctx as never)).status !== 415) {
    throw new Error("non-JSON request was accepted");
  }
  if ((await handleRequest(request({ assetId: ASSET_ID, sha256: "f".repeat(64) }), fixture.ctx as never)).status !== 422
    || (await handleRequest(request({ assetId: "not-a-uuid" }), fixture.ctx as never)).status !== 422
    || fixture.calls.tables.length !== 0) {
    throw new Error("invalid payload reached profile or asset lookup");
  }
});
