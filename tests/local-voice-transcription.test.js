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
  assert.equal(LOCAL_STT_MODEL.sha256, "818710568da3ca15689e31a743197b520007872ff9576237bda97bd1b469c3d7");
  assert.equal(LOCAL_STT_MODEL.modelUrl.startsWith("/__stt-whisper/"), true);
});
