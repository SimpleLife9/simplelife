import test from "node:test";
import assert from "node:assert/strict";
import {
  createLocalVoiceTranscriber,
  getLocalVoiceTestFileError,
  LOCAL_STT_MODEL,
  LOCAL_STT_MAX_AUDIO_BYTES,
  getLocalVoiceRuntimeCompatibilityError,
} from "../src/features/inbox/domain/local-voice-transcription.js";

test("Whisper runtime requires cross-origin isolation and SharedArrayBuffer before loading", () => {
  assert.match(getLocalVoiceRuntimeCompatibilityError({ crossOriginIsolated: false, SharedArrayBuffer: undefined }), /aislamiento de origen cruzado/);
  assert.match(getLocalVoiceRuntimeCompatibilityError({ crossOriginIsolated: true, SharedArrayBuffer: undefined }), /SharedArrayBuffer/);
  assert.equal(getLocalVoiceRuntimeCompatibilityError({ crossOriginIsolated: true, SharedArrayBuffer: class SharedArrayBuffer {} }), null);
});
test("local voice test accepts supported synthetic audio and enforces the 25 MiB limit", () => {
  assert.equal(getLocalVoiceTestFileError({
    name: "synthetic-speech.wav", type: "audio/wav", size: 128,
  }), null);
  assert.equal(getLocalVoiceTestFileError({
    name: "synthetic-speech.mp3", type: "audio/mpeg", size: 128,
  }), null);
  assert.match(getLocalVoiceTestFileError(null), /Selecciona un audio/);
  assert.match(getLocalVoiceTestFileError({
    name: "empty.wav", type: "audio/wav", size: 0,
  }), /vacío/);
  assert.match(getLocalVoiceTestFileError({
    name: "oversized.wav", type: "audio/wav", size: LOCAL_STT_MAX_AUDIO_BYTES + 1,
  }), /25 MiB/);
  assert.match(getLocalVoiceTestFileError({
    name: "document.pdf", type: "application/pdf", size: 128,
  }), /Formato de audio no admitido/);
});

test("Inbox transcriber streams Spanish text from the local session", async () => {
  const seen = { sessionLoads: 0, decoded: 0, statuses: [] };
  const fakeSession = {
    streaming(samples, options) {
      assert.ok(samples instanceof Float32Array);
      assert.equal(options.language, "es");
      assert.equal(options.threads, 2);
      return (async function* () {
        yield { text: "Mañana debo comprar" };
        yield { text: "leche y llamar a Carlos." };
      })();
    },
  };
  const transcribe = createLocalVoiceTranscriber({
    getSession: async () => { seen.sessionLoads += 1; return fakeSession; },
    decodeAudio: async (file) => {
      seen.decoded += 1;
      assert.equal(file.name, "synthetic-speech.wav");
      return { samples: new Float32Array(16000), duration: 1 };
    },
  });

  const result = await transcribe({
    name: "synthetic-speech.wav", type: "audio/wav", size: 128,
  }, { onStatus: (message) => seen.statuses.push(message) });

  assert.deepEqual(result, {
    text: "Mañana debo comprar leche y llamar a Carlos.",
    durationSeconds: 1,
  });
  assert.equal(seen.sessionLoads, 1);
  assert.equal(seen.decoded, 1);
  assert.ok(seen.statuses.some((message) => message.includes("Reconociendo:")));
});

test("invalid local audio is rejected before loading the Whisper model", async () => {
  let loaded = false;
  const transcribe = createLocalVoiceTranscriber({
    getSession: async () => { loaded = true; return { streaming: () => [] }; },
    decodeAudio: async () => ({ samples: new Float32Array(1), duration: 1 }),
  });
  await assert.rejects(
    transcribe({ name: "bad.pdf", type: "application/pdf", size: 22 }),
    /Formato de audio no admitido/,
  );
  assert.equal(loaded, false);
});

test("Inbox uses the same pinned whisper.cpp model revision and hash as the isolated lab", () => {
  assert.equal(LOCAL_STT_MODEL.revision, "0b364b566045a405be7225ee1e415a073e04da77");
  assert.equal(LOCAL_STT_MODEL.modelPath.endsWith("/ggml-tiny-q5_1.bin"), true);
  assert.equal(LOCAL_STT_MODEL.runtimeModule, "/vendor/whisper-wasm/0.1.1/index.es.js");
  assert.equal(LOCAL_STT_MODEL.sha256, "818710568da3ca15689e31a743197b520007872ff9576237bda97bd1b469c3d7");
  assert.equal(LOCAL_STT_MODEL.modelUrl.startsWith("/__stt-whisper/"), true);
});

import { createHash } from "node:crypto";
import { transcribeLocalVoiceAsset } from "../src/features/inbox/domain/local-voice-transcription.js";

const PRIVATE_AUDIO_BYTES = Buffer.from("synthetic private Inbox voice bytes");
const PRIVATE_AUDIO_SHA256 = createHash("sha256").update(PRIVATE_AUDIO_BYTES).digest("hex");

function makePrivateVoiceAsset(overrides = {}) {
  const ownerUserId = "019b7200-0000-7000-8000-000000000001";
  const assetId = "019b7200-0000-7000-8000-000000000101";
  return {
    id: assetId,
    owner_user_id: ownerUserId,
    bucket_id: "inbox-voice-private",
    object_path: ownerUserId + "/" + assetId + "/source.webm",
    capture_id: null,
    mime_type: "audio/webm",
    file_size_bytes: PRIVATE_AUDIO_BYTES.byteLength,
    sha256_hex: PRIVATE_AUDIO_SHA256,
    status: "uploaded",
    retention_until: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

function privateAudioClient(bytes = PRIVATE_AUDIO_BYTES, requests = []) {
  return {
    storage: {
      from(bucket) {
        assert.equal(bucket, "inbox-voice-private");
        return {
          async download(path) {
            requests.push(path);
            return { data: new Blob([bytes], { type: "audio/webm" }), error: null };
          },
        };
      },
    },
  };
}

test("selected Inbox audio is owner-scoped, downloaded once, integrity-checked and passed to local Whisper", async () => {
  const asset = makePrivateVoiceAsset();
  const requests = [];
  const statuses = [];
  let localInferenceCalls = 0;
  const result = await transcribeLocalVoiceAsset({
    supabase: privateAudioClient(PRIVATE_AUDIO_BYTES, requests),
    asset,
    ownerUserId: asset.owner_user_id,
    onStatus: (message) => statuses.push(message),
    transcribeFile: async (file, options) => {
      localInferenceCalls += 1;
      assert.equal(file.name, "inbox-audio-" + asset.id + ".webm");
      assert.equal(file.type, "audio/webm");
      assert.deepEqual(Buffer.from(await file.arrayBuffer()), PRIVATE_AUDIO_BYTES);
      options.onStatus("Whisper completó la inferencia local.");
      return { text: "Comprar carne de cerdo y pavo.", durationSeconds: 3.5 };
    },
  });

  assert.deepEqual(requests, [asset.object_path]);
  assert.equal(localInferenceCalls, 1);
  assert.deepEqual(result, { text: "Comprar carne de cerdo y pavo.", durationSeconds: 3.5 });
  assert.ok(statuses.some((message) => message.includes("SHA-256")));
});

test("private audio metadata is rejected before Storage download when owner or lifecycle is invalid", async () => {
  const asset = makePrivateVoiceAsset();
  let downloads = 0;
  const client = {
    storage: {
      from() {
        return { async download() { downloads += 1; return { data: new Blob([PRIVATE_AUDIO_BYTES]), error: null }; } };
      },
    },
  };
  await assert.rejects(
    transcribeLocalVoiceAsset({ supabase: client, asset, ownerUserId: "019b7200-0000-7000-8000-000000000099" }),
    /no pertenece a la cuenta activa/,
  );
  await assert.rejects(
    transcribeLocalVoiceAsset({ supabase: client, asset: makePrivateVoiceAsset({ status: "transcribed" }), ownerUserId: asset.owner_user_id }),
    /ya no está pendiente/,
  );
  await assert.rejects(
    transcribeLocalVoiceAsset({ supabase: client, asset: makePrivateVoiceAsset({ retention_until: new Date(Date.now() - 1000).toISOString() }), ownerUserId: asset.owner_user_id }),
    /retención temporal.*venció/i,
  );
  assert.equal(downloads, 0);
});

test("SHA-256 mismatch blocks local inference and leaves the original source metadata untouched", async () => {
  const asset = makePrivateVoiceAsset();
  let inferenceCalls = 0;
  const wrongBytes = Buffer.from("changed audio bytes");
  await assert.rejects(
    transcribeLocalVoiceAsset({
      supabase: privateAudioClient(wrongBytes),
      asset,
      ownerUserId: asset.owner_user_id,
      transcribeFile: async () => { inferenceCalls += 1; return { text: "no", durationSeconds: 1 }; },
    }),
    /SHA-256.*no coincide/,
  );
  assert.equal(inferenceCalls, 0);
  assert.equal(asset.sha256_hex, PRIVATE_AUDIO_SHA256);
  assert.equal(asset.status, "uploaded");
});
