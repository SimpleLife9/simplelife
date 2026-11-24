import {
  resolveActiveEventProfile,
  type EventAuthenticatedContext,
} from "../_shared/agenda-event-profile.ts";

export const MAX_REQUEST_BYTES = 2 * 1024;
export const MAX_AUDIO_BYTES = 25 * 1024 * 1024;
const BUCKET = "inbox-voice-private";
const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
};
const UUID_V7_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const MIME_EXTENSIONS: Record<string, string> = {
  "audio/webm": "webm",
  "audio/ogg": "ogg",
  "audio/mp4": "m4a",
  "audio/wav": "wav",
  "audio/mpeg": "mp3",
};

type AudioAsset = {
  id: unknown;
  owner_user_id: unknown;
  bucket_id: unknown;
  object_path: unknown;
  mime_type: unknown;
  file_size_bytes: unknown;
  sha256_hex: unknown;
  capture_id: unknown;
  status: unknown;
};

type AdminClient = {
  from(table: string): any;
  rpc(name: string, args: Record<string, unknown>): Promise<{ data: unknown; error: unknown }>;
  storage?: {
    from(bucket: string): {
      download(path: string): Promise<{ data: Blob | null; error: unknown }>;
    };
  };
};
type Context = EventAuthenticatedContext & { supabaseAdmin: AdminClient };

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
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

function toHex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

function validAsset(asset: AudioAsset, assetId: string, ownerProfileId: string): boolean {
  if (asset.id !== assetId || asset.owner_user_id !== ownerProfileId
    || asset.bucket_id !== BUCKET || asset.capture_id !== null
    || asset.status !== "uploading"
    || typeof asset.object_path !== "string"
    || typeof asset.mime_type !== "string"
    || typeof asset.file_size_bytes !== "number"
    || !Number.isInteger(asset.file_size_bytes)
    || asset.file_size_bytes < 1 || asset.file_size_bytes > MAX_AUDIO_BYTES
    || typeof asset.sha256_hex !== "string"
    || !SHA256_PATTERN.test(asset.sha256_hex)) {
    return false;
  }
  const extension = MIME_EXTENSIONS[asset.mime_type];
  if (!extension) return false;
  return asset.object_path === ownerProfileId + "/" + assetId + "/source." + extension;
}

/**
 * Authenticated voice finalizer. The browser only identifies the staging asset;
 * the server downloads the private object and verifies its actual SHA-256 bytes.
 * Only the server-computed digest can reach the service-role finalization RPC.
 */
export async function handleRequest(request: Request, ctx: Context): Promise<Response> {
  if (request.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405);
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
    return json({ error: "CONTENT_TYPE_MUST_BE_JSON" }, 415);
  }

  let raw: string | null;
  try {
    raw = await readBoundedBody(request);
  } catch {
    return json({ error: "REQUEST_BODY_MUST_BE_VALID_UTF8" }, 400);
  }
  if (raw === null) return json({ error: "REQUEST_BODY_TOO_LARGE" }, 413);

  let body: unknown;
  try { body = JSON.parse(raw); } catch { return json({ error: "VALID_JSON_REQUIRED" }, 400); }
  if (!body || typeof body !== "object" || Array.isArray(body)
    || Object.keys(body).length !== 1 || !("assetId" in body)
    || typeof (body as { assetId?: unknown }).assetId !== "string"
    || !UUID_V7_PATTERN.test((body as { assetId: string }).assetId)) {
    return json({ error: "VOICE_ASSET_ID_INVALID" }, 422);
  }
  const assetId = (body as { assetId: string }).assetId.toLowerCase();

  const profile = await resolveActiveEventProfile(ctx);
  if (!profile.ok) return json({ error: profile.code }, profile.status);

  let lookup: { data: AudioAsset | null; error: unknown };
  try {
    lookup = await ctx.supabaseAdmin
      .from("capture_audio_asset")
      .select("id,owner_user_id,bucket_id,object_path,mime_type,file_size_bytes,sha256_hex,capture_id,status")
      .eq("id", assetId)
      .eq("owner_user_id", profile.profileId)
      .maybeSingle();
  } catch {
    return json({ error: "VOICE_ASSET_LOOKUP_FAILED" }, 503);
  }
  if (lookup.error) return json({ error: "VOICE_ASSET_LOOKUP_FAILED" }, 503);
  if (!lookup.data) return json({ error: "VOICE_ASSET_NOT_AVAILABLE" }, 404);
  if (!validAsset(lookup.data, assetId, profile.profileId)) {
    return json({ error: "VOICE_ASSET_NOT_FINALIZABLE" }, 409);
  }

  if (!ctx.supabaseAdmin.storage?.from) {
    return json({ error: "VOICE_STORAGE_UNAVAILABLE" }, 503);
  }

  let downloaded: { data: Blob | null; error: unknown };
  try {
    downloaded = await ctx.supabaseAdmin.storage.from(BUCKET).download(lookup.data.object_path as string);
  } catch {
    return json({ error: "VOICE_STORAGE_DOWNLOAD_FAILED" }, 503);
  }
  if (downloaded.error || !(downloaded.data instanceof Blob)) {
    return json({ error: "VOICE_STORAGE_DOWNLOAD_FAILED" }, 503);
  }
  if (downloaded.data.size !== lookup.data.file_size_bytes) {
    return json({ error: "VOICE_UPLOAD_SIZE_MISMATCH" }, 422);
  }
  if (downloaded.data.size < 1 || downloaded.data.size > MAX_AUDIO_BYTES) {
    return json({ error: "VOICE_UPLOAD_SIZE_INVALID" }, 422);
  }

  let actualSha256: string;
  try {
    actualSha256 = toHex(await crypto.subtle.digest("SHA-256", await downloaded.data.arrayBuffer()));
  } catch {
    return json({ error: "VOICE_UPLOAD_INTEGRITY_CHECK_UNAVAILABLE" }, 503);
  }
  if (actualSha256 !== (lookup.data.sha256_hex as string).toLowerCase()) {
    return json({ error: "VOICE_UPLOAD_INTEGRITY_CHECK_FAILED" }, 422);
  }

  let finalized: { data: unknown; error: unknown };
  try {
    finalized = await ctx.supabaseAdmin.rpc("finalize_inbox_audio_upload_verified", {
      p_owner_profile_id: profile.profileId,
      p_asset_id: assetId,
      p_file_size_bytes: downloaded.data.size,
      p_sha256_hex: actualSha256,
    });
  } catch {
    return json({ error: "VOICE_UPLOAD_FINALIZATION_FAILED" }, 503);
  }
  if (finalized.error) return json({ error: "VOICE_UPLOAD_FINALIZATION_FAILED" }, 503);
  if (finalized.data !== true) return json({ error: "VOICE_UPLOAD_FINALIZATION_NOT_CONFIRMED" }, 409);

  return json({ assetId, verified: true }, 200);
}
