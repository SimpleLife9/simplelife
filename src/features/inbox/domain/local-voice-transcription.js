const WHISPER_WASM_MODULE = "https://cdn.jsdelivr.net/npm/@timur00kh/whisper.wasm@0.1.1/+esm";
const MODEL_REVISION = "0b364b566045a405be7225ee1e415a073e04da77";
const MODEL_PATH = "ggerganov/whisper.cpp/resolve/" + MODEL_REVISION + "/ggml-tiny-q5_1.bin";

export const LOCAL_STT_MODEL = Object.freeze({
  runtimeModule: WHISPER_WASM_MODULE,
  revision: MODEL_REVISION,
  modelPath: MODEL_PATH,
  modelUrl: "/__stt-whisper/" + MODEL_PATH,
  sha256: "818710568da3ca15689e31a743197b520007872ff9576237bda97bd1b469c3d7",
});

export const LOCAL_STT_MAX_AUDIO_BYTES = 25 * 1024 * 1024;
export const LOCAL_STT_MAX_DURATION_SECONDS = 120;
const SAMPLE_RATE = 16_000;
const ALLOWED_AUDIO_TYPES = new Set([
  "audio/webm", "audio/ogg", "audio/mp4", "audio/wav",
  "audio/x-wav", "audio/mpeg",
]);

let sessionPromise = null;

export function getLocalVoiceTestFileError(file) {
  if (!file || typeof file !== "object") return "Selecciona un audio sintético o público para la prueba.";
  if (!Number.isFinite(file.size) || file.size < 1) return "El archivo de audio está vacío.";
  if (file.size > LOCAL_STT_MAX_AUDIO_BYTES) return "El audio supera el límite de 25 MiB.";
  const mimeType = String(file.type || "").split(";")[0].trim().toLowerCase();
  const extensionAllowed = /\.(wav|mp3|m4a|ogg|webm)$/i.test(String(file.name || ""));
  if (!ALLOWED_AUDIO_TYPES.has(mimeType) && !(mimeType === "" && extensionAllowed)) {
    return "Formato de audio no admitido. Usa WAV, MP3, M4A, OGG o WebM.";
  }
  return null;
}

async function decodeMono16k(file) {
  const AudioContextCtor = globalThis.AudioContext || globalThis.webkitAudioContext;
  const OfflineAudioContextCtor = globalThis.OfflineAudioContext || globalThis.webkitOfflineAudioContext;
  if (!AudioContextCtor || !OfflineAudioContextCtor) {
    throw new Error("Este navegador no ofrece decodificación de audio compatible.");
  }
  const context = new AudioContextCtor();
  try {
    const decoded = await context.decodeAudioData(await file.arrayBuffer());
    if (!Number.isFinite(decoded.duration) || decoded.duration <= 0
      || decoded.duration > LOCAL_STT_MAX_DURATION_SECONDS) {
      throw new Error("El audio debe durar entre 1 segundo y 2 minutos.");
    }
    const frames = Math.ceil(decoded.duration * SAMPLE_RATE);
    const offline = new OfflineAudioContextCtor(1, frames, SAMPLE_RATE);
    const source = offline.createBufferSource();
    source.buffer = decoded;
    source.connect(offline.destination);
    source.start(0);
    const rendered = await offline.startRendering();
    return { samples: rendered.getChannelData(0), duration: decoded.duration };
  } finally {
    await context.close().catch(() => {});
  }
}

async function sha256Hex(bytes) {
  if (!globalThis.crypto?.subtle) throw new Error("STT_SHA256_UNAVAILABLE");
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("");
}

async function createVerifiedWhisperSession(onStatus) {
  if (!globalThis.location?.origin) throw new Error("STT_ORIGIN_UNAVAILABLE");
  const modelUrl = new URL(LOCAL_STT_MODEL.modelUrl, globalThis.location.origin);
  if (modelUrl.origin !== globalThis.location.origin) {
    throw new Error("STT_MODEL_MUST_USE_SAME_ORIGIN_PROXY");
  }

  onStatus?.("Cargando runtime Whisper.cpp desde jsDelivr…");
  let runtime;
  try {
    runtime = await import(/* @vite-ignore */ WHISPER_WASM_MODULE);
  } catch (error) {
    throw new Error("No se pudo cargar Whisper.cpp: " + String(error?.message || error).slice(0, 180));
  }

  const { WhisperWasmService, ModelManager } = runtime;
  if (typeof WhisperWasmService !== "function" || typeof ModelManager !== "function") {
    throw new Error("STT_RUNTIME_EXPORTS_INVALID");
  }

  const whisper = new WhisperWasmService({ logLevel: 0 });
  if (!await whisper.checkWasmSupport()) {
    throw new Error("Este navegador no ofrece WebAssembly SIMD, necesario para este motor.");
  }

  const modelManager = new ModelManager({ logLevel: 0 });
  onStatus?.("Recuperando o descargando el modelo tiny-q5_1 desde el almacenamiento local…");
  let lastProgress = -1;
  const modelBytes = await modelManager.loadModelByUrl(modelUrl.href, (progress) => {
    const rounded = Math.max(0, Math.min(100, Math.round(progress)));
    if (rounded === lastProgress) return;
    lastProgress = rounded;
    onStatus?.("Modelo tiny-q5_1 · " + rounded + "% · almacenamiento local del navegador.");
  });

  onStatus?.("Verificando SHA-256 del modelo…");
  const actualHash = await sha256Hex(modelBytes);
  if (actualHash !== LOCAL_STT_MODEL.sha256) {
    await modelManager.clearCache().catch(() => {});
    throw new Error("STT_MODEL_CHECKSUM_MISMATCH: el modelo local no coincide con la revisión fijada.");
  }

  onStatus?.("Inicializando Whisper.cpp en WebAssembly…");
  await whisper.initModel(modelBytes);
  return whisper.createSession();
}

function getVerifiedWhisperSession(onStatus) {
  if (!sessionPromise) {
    sessionPromise = createVerifiedWhisperSession(onStatus).catch((error) => {
      sessionPromise = null;
      throw error;
    });
  }
  return sessionPromise;
}

export function createLocalVoiceTranscriber({
  getSession = getVerifiedWhisperSession,
  decodeAudio = decodeMono16k,
} = {}) {
  if (typeof getSession !== "function" || typeof decodeAudio !== "function") {
    throw new TypeError("Local voice transcription requires a session loader and audio decoder.");
  }

  return async function transcribeLocalVoiceFile(file, { onStatus } = {}) {
    const validationError = getLocalVoiceTestFileError(file);
    if (validationError) throw new Error(validationError);

    onStatus?.("Preparando transcripción local…");
    const session = await getSession(onStatus);
    onStatus?.("Decodificando audio a mono/16 kHz…");
    const { samples, duration } = await decodeAudio(file);
    if (!(samples instanceof Float32Array) || !Number.isFinite(duration) || duration <= 0) {
      throw new Error("STT_AUDIO_DECODE_RESULT_INVALID");
    }

    const segments = [];
    const stream = session.streaming(samples, {
      language: "es",
      threads: 2,
      translate: false,
      timeoutMs: 300_000,
      sleepMsBetweenChunks: 80,
    });
    if (!stream || typeof stream[Symbol.asyncIterator] !== "function") {
      throw new Error("STT_STREAM_NOT_AVAILABLE");
    }

    for await (const segment of stream) {
      if (segment?.text) segments.push(String(segment.text).trim());
      const partial = segments.join(" ").replace(/\s+/g, " ").trim();
      onStatus?.(partial ? "Reconociendo: " + partial : "Whisper está procesando el audio…");
    }

    return {
      text: segments.join(" ").replace(/\s+/g, " ").trim(),
      durationSeconds: duration,
    };
  };
}

export const transcribeLocalVoiceFile = createLocalVoiceTranscriber();
