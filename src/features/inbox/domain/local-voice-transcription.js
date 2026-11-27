const WHISPER_WASM_MODULE = "/vendor/whisper-wasm/0.1.1/index.es.js";
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

export function getLocalVoiceRuntimeCompatibilityError(environment = globalThis) {
  if (environment?.crossOriginIsolated !== true) {
    return 'Whisper.cpp necesita aislamiento de origen cruzado. La pestaña debe abrirse con COOP same-origin y COEP credentialless. Actualiza SimpleLife en una pestaña nueva y vuelve a intentarlo; no borres los datos del sitio.';
  }
  if (typeof environment.SharedArrayBuffer !== 'function') {
    return 'Este navegador no habilitó SharedArrayBuffer, necesario para ejecutar Whisper.cpp. Usa una versión actual de Chrome o Edge.';
  }
  return null;
}

export function getLocalVoiceTestFileError(file) {
  if (!file || typeof file !== "object") return "No se recibió un archivo de audio válido."
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
  const compatibilityError = getLocalVoiceRuntimeCompatibilityError();
  if (compatibilityError) throw new Error('STT_CROSS_ORIGIN_ISOLATION_REQUIRED: ' + compatibilityError);
  if (!globalThis.location?.origin) throw new Error('STT_ORIGIN_UNAVAILABLE');
  const modelUrl = new URL(LOCAL_STT_MODEL.modelUrl, globalThis.location.origin);
  if (modelUrl.origin !== globalThis.location.origin) throw new Error('STT_MODEL_MUST_USE_SAME_ORIGIN_PROXY');

  let stage = 'runtime_import';
  try {
    onStatus?.('Cargando runtime Whisper.cpp local empaquetado…');
    let runtime;
    try {
      runtime = await import(/* @vite-ignore */ WHISPER_WASM_MODULE);
    } catch (error) {
      throw new Error('No se pudo cargar Whisper.cpp: ' + String(error?.message || error).slice(0, 180));
    }
    const { WhisperWasmService, ModelManager } = runtime;
    if (typeof WhisperWasmService !== 'function' || typeof ModelManager !== 'function') throw new Error('STT_RUNTIME_EXPORTS_INVALID');

    const whisper = new WhisperWasmService({ logLevel: 0 });
    stage = 'wasm_simd_check';
    if (!await whisper.checkWasmSupport()) throw new Error('Este navegador no ofrece WebAssembly SIMD, necesario para este motor.');

    const modelManager = new ModelManager({ logLevel: 0 });
    stage = 'model_download';
    onStatus?.('Recuperando o descargando el modelo tiny-q5_1 desde el almacenamiento local…');
    let lastProgress = -1;
    const modelBytes = await modelManager.loadModelByUrl(modelUrl.href, (progress) => {
      const rounded = Math.max(0, Math.min(100, Math.round(progress)));
      if (rounded === lastProgress) return;
      lastProgress = rounded;
      onStatus?.('Modelo tiny-q5_1 · ' + rounded + '% · almacenamiento local del navegador.');
    });

    stage = 'model_integrity_check';
    onStatus?.('Verificando SHA-256 del modelo…');
    const actualHash = await sha256Hex(modelBytes);
    if (actualHash !== LOCAL_STT_MODEL.sha256) {
      await modelManager.clearCache().catch(() => {});
      throw new Error('STT_MODEL_CHECKSUM_MISMATCH: el modelo local no coincide con la revisión fijada.');
    }

    stage = 'wasm_initialization';
    onStatus?.('Inicializando Whisper.cpp en WebAssembly con aislamiento verificado…');
    await whisper.initModel(modelBytes);
    stage = 'session_creation';
    return whisper.createSession();
  } catch (failure) {
    const detail = String(failure?.message || failure || 'unknown failure').slice(0, 220);
    throw new Error('STT_' + stage.toUpperCase() + '_FAILED: ' + detail, { cause: failure });
  }
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
    onStatus?.('Ejecutando Whisper.cpp en este dispositivo…');
    try {
      const stream = session.streaming(samples, {
        language: 'es',
        threads: 2,
        translate: false,
        timeoutMs: 300_000,
        sleepMsBetweenChunks: 80,
      });
      if (!stream || typeof stream[Symbol.asyncIterator] !== 'function') throw new Error('STT_STREAM_NOT_AVAILABLE');
      for await (const segment of stream) {
        if (segment?.text) segments.push(String(segment.text).trim());
        const partial = segments.join(' ').replace(/\s+/g, ' ').trim();
        onStatus?.(partial ? 'Reconociendo: ' + partial : 'Whisper está procesando el audio…');
      }
    } catch (failure) {
      const detail = String(failure?.message || failure || 'unknown failure').slice(0, 220);
      throw new Error('STT_INFERENCE_FAILED: ' + detail, { cause: failure });
    }

    return {
      text: segments.join(" ").replace(/\s+/g, " ").trim(),
      durationSeconds: duration,
    };
  };
}

export const transcribeLocalVoiceFile = createLocalVoiceTranscriber();

const VOICE_ASSET_EXTENSIONS = Object.freeze({
  "audio/webm": "webm",
  "audio/ogg": "ogg",
  "audio/mp4": "m4a",
  "audio/wav": "wav",
  "audio/mpeg": "mp3",
});

let activeVoiceAssetTranscription = false;

/** Download one explicitly selected private Inbox recording and verify it before local inference. */
export async function transcribeLocalVoiceAsset({
  supabase,
  asset,
  ownerUserId,
  onStatus,
  transcribeFile = transcribeLocalVoiceFile,
  now = () => Date.now(),
} = {}) {
  if (activeVoiceAssetTranscription) {
    throw new Error("Ya hay otra transcripción local en curso. Termina esa primero.");
  }
  activeVoiceAssetTranscription = true;
  try {
    if (!supabase?.storage?.from || typeof transcribeFile !== "function") {
      throw new Error("No está disponible la conexión privada necesaria para recuperar este audio.");
    }
    if (!ownerUserId || !asset || asset.owner_user_id !== ownerUserId) {
      throw new Error("Este audio no pertenece a la cuenta activa.");
    }
    if (asset.bucket_id !== "inbox-voice-private" || asset.capture_id != null
      || asset.status !== "uploaded") {
      throw new Error("Este audio ya no está pendiente o no está disponible para transcripción local.");
    }

    const mimeType = String(asset.mime_type || "").toLowerCase();
    const extension = VOICE_ASSET_EXTENSIONS[mimeType];
    if (!extension) throw new Error("El formato del audio guardado no es compatible con Whisper local.");

    const expectedObjectPath = ownerUserId + "/" + asset.id + "/source." + extension;
    if (asset.object_path !== expectedObjectPath) {
      throw new Error("La ruta privada del audio no coincide con sus metadatos. No se descargó.");
    }
    if (!Number.isSafeInteger(asset.file_size_bytes) || asset.file_size_bytes < 1
      || asset.file_size_bytes > LOCAL_STT_MAX_AUDIO_BYTES) {
      throw new Error("El tamaño registrado del audio no es válido o supera 25 MiB.");
    }
    if (typeof asset.sha256_hex !== "string" || !/^[0-9a-f]{64}$/.test(asset.sha256_hex)) {
      throw new Error("El audio no tiene una huella SHA-256 válida. No se descargó.");
    }
    const retention = Date.parse(asset.retention_until || "");
    if (!Number.isFinite(retention) || retention <= now()) {
      throw new Error("La retención temporal de este audio venció. No se descargó.");
    }

    onStatus?.("Descargando únicamente este audio desde el almacenamiento privado…");
    const { data: blob, error } = await supabase.storage
      .from("inbox-voice-private")
      .download(expectedObjectPath);
    if (error) throw new Error("No se pudo descargar el audio privado: " + String(error.message || error).slice(0, 180));
    if (!(blob instanceof Blob) || blob.size !== asset.file_size_bytes) {
      throw new Error("El tamaño del archivo descargado no coincide con el registro. No se ejecutó Whisper.");
    }

    onStatus?.("Verificando la integridad SHA-256 del audio original…");
    const actualHash = await sha256Hex(await blob.arrayBuffer());
    if (actualHash !== asset.sha256_hex) {
      throw new Error("La huella SHA-256 del audio no coincide con el original registrado. No se ejecutó Whisper.");
    }

    onStatus?.("Audio verificado. La transcripción se ejecutará dentro de este dispositivo…");
    const file = new File(
      [blob],
      "inbox-audio-" + asset.id + "." + extension,
      { type: mimeType, lastModified: Date.parse(asset.created_at || "") || now() },
    );
    const result = await transcribeFile(file, { onStatus });
    if (!result || typeof result.text !== "string"
      || !Number.isFinite(result.durationSeconds) || result.durationSeconds <= 0) {
      throw new Error("Whisper devolvió un resultado de audio no válido.");
    }
    return result;
  } finally {
    activeVoiceAssetTranscription = false;
  }
}
