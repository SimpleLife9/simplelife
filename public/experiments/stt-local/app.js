const WHISPER_WASM_MODULE = "https://cdn.jsdelivr.net/npm/@timur00kh/whisper.wasm@0.1.1/+esm";
const MODEL_REVISION = "0b364b566045a405be7225ee1e415a073e04da77";
const MODEL_PATH = "ggerganov/whisper.cpp/resolve/" + MODEL_REVISION + "/ggml-tiny-q5_1.bin";
const WHISPER_CPP_MODEL_URL = "/__stt-whisper/" + MODEL_PATH;
const MODEL_SHA256 = "818710568da3ca15689e31a743197b520007872ff9576237bda97bd1b469c3d7";
const MODEL_SIZE_LABEL = "32.2 MB";
const SAMPLE_RATE = 16_000;
const MAX_AUDIO_BYTES = 25 * 1024 * 1024;
const MAX_DURATION_SECONDS = 120;
const ALLOWED_FETCH_HOSTS = new Set([location.hostname, "cdn.jsdelivr.net"]);

const $ = (id) => document.getElementById(id);
const state = {
  whisper: null,
  modelManager: null,
  session: null,
  loading: false,
  transcribing: false,
};

function setStatus(message) {
  $("status").textContent = message;
}

function formatBytes(value) {
  if (!Number.isFinite(value)) return "—";
  return value >= 1024 * 1024
    ? (value / (1024 * 1024)).toFixed(1) + " MiB"
    : (value / 1024).toFixed(1) + " KiB";
}

function refreshMetrics() {
  const memory = navigator.deviceMemory;
  $("device-memory").textContent = Number.isFinite(memory) ? memory + " GiB" : "No expuesta";
  const heap = performance.memory?.usedJSHeapSize;
  $("heap").textContent = Number.isFinite(heap) ? formatBytes(heap) : "No expuesto";
  if (navigator.storage?.estimate) {
    void navigator.storage.estimate().then((estimate) => {
      $("storage").textContent = Number.isFinite(estimate.usage)
        ? formatBytes(estimate.usage) + " / " + formatBytes(estimate.quota)
        : "No disponible";
    }).catch(() => {
      $("storage").textContent = "No disponible";
    });
  }
}

function normalizeWords(value) {
  return String(value || "").toLocaleLowerCase("es")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ").trim().split(/\s+/).filter(Boolean);
}

function wordErrorRate(reference, hypothesis) {
  const a = normalizeWords(reference);
  const b = normalizeWords(hypothesis);
  if (!a.length) return null;
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    let diagonal = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const previous = row[j];
      row[j] = Math.min(
        row[j] + 1,
        row[j - 1] + 1,
        diagonal + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      diagonal = previous;
    }
  }
  return row[b.length] / a.length;
}

async function decodeMono16k(file) {
  const context = new AudioContext();
  try {
    const decoded = await context.decodeAudioData(await file.arrayBuffer());
    if (!Number.isFinite(decoded.duration) || decoded.duration <= 0
      || decoded.duration > MAX_DURATION_SECONDS) {
      throw new Error("El audio debe durar entre 1 segundo y 2 minutos.");
    }
    const frames = Math.ceil(decoded.duration * SAMPLE_RATE);
    const offline = new OfflineAudioContext(1, frames, SAMPLE_RATE);
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

function setBusy(busy) {
  $("load-model").disabled = busy || Boolean(state.whisper);
  $("release-model").disabled = busy || !state.whisper;
  $("audio-file").disabled = busy || !state.whisper;
  $("transcribe").disabled = busy || !state.whisper || !$("audio-file").files?.length;
}

function installReadOnlyFetchGuard() {
  if (window.__simpleLifeWhisperFetchGuardInstalled) return;
  const nativeFetch = window.fetch.bind(window);
  window.fetch = async (input, init = {}) => {
    const method = String(
      init.method || (input instanceof Request ? input.method : "GET"),
    ).toUpperCase();
    if (method !== "GET" && method !== "HEAD") {
      throw new Error("STT_NETWORK_WRITE_BLOCKED");
    }

    const originalUrl = new URL(
      input instanceof Request ? input.url : input,
      location.href,
    );
    const isModelProxy = originalUrl.origin === location.origin
      && originalUrl.pathname === WHISPER_CPP_MODEL_URL;
    const isRuntimeAsset = originalUrl.hostname === "cdn.jsdelivr.net"
      && originalUrl.protocol === "https:";
    if (!isModelProxy && !isRuntimeAsset) {
      throw new Error("STT_REMOTE_HOST_NOT_ALLOWLISTED: " + originalUrl.hostname);
    }

    try {
      const response = await nativeFetch(input, init);
      const finalUrl = response.url ? new URL(response.url) : originalUrl;
      const finalAllowed = finalUrl.origin === location.origin
        || (finalUrl.protocol === "https:" && ALLOWED_FETCH_HOSTS.has(finalUrl.hostname));
      if (!finalAllowed) {
        throw new Error("STT_REDIRECT_HOST_NOT_ALLOWLISTED: " + finalUrl.hostname);
      }
      return response;
    } catch (error) {
      const message = String(error?.message || error);
      if (message.startsWith("STT_")) throw error;
      throw new Error(
        "STT_FETCH_FAILED: " + originalUrl.hostname + originalUrl.pathname
          + " (" + message.slice(0, 120) + ")",
      );
    }
  };
  window.__simpleLifeWhisperFetchGuardInstalled = true;
}

async function sha256Hex(bytes) {
  if (!crypto?.subtle) throw new Error("STT_SHA256_UNAVAILABLE");
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("");
}

$("load-model").addEventListener("click", async () => {
  if (state.loading || state.whisper) return;
  state.loading = true;
  setBusy(true);
  setStatus("Preparando whisper.cpp WASM. La inferencia se ejecutará localmente en este dispositivo…");
  installReadOnlyFetchGuard();

  try {
    let runtime;
    try {
      runtime = await import(WHISPER_WASM_MODULE);
    } catch (error) {
      throw new Error(
        "STT_RUNTIME_IMPORT_FAILED [cdn.jsdelivr.net]: "
          + String(error?.message || error).slice(0, 180),
      );
    }

    const { WhisperWasmService, ModelManager } = runtime;
    if (typeof WhisperWasmService !== "function" || typeof ModelManager !== "function") {
      throw new Error("STT_RUNTIME_EXPORTS_INVALID");
    }

    const whisper = new WhisperWasmService({ logLevel: 0 });
    if (!await whisper.checkWasmSupport()) {
      throw new Error("Este navegador no ofrece WebAssembly SIMD, necesario para este motor.");
    }

    const persistent = navigator.storage?.persist
      ? await navigator.storage.persist().catch(() => false)
      : false;
    $("storage").textContent = persistent
      ? "Almacenamiento persistente concedido"
      : "Caché IndexedDB del navegador";

    const modelManager = new ModelManager({ logLevel: 0 });
    setStatus("Descargando o recuperando el modelo multilingüe tiny-q5_1 (" + MODEL_SIZE_LABEL + ")…");
    let lastProgress = -1;
    const modelBytes = await modelManager.loadModelByUrl(
      new URL(WHISPER_CPP_MODEL_URL, location.origin).href,
      (progress) => {
        const rounded = Math.max(0, Math.min(100, Math.round(progress)));
        if (rounded === lastProgress) return;
        lastProgress = rounded;
        setStatus("Modelo tiny-q5_1: " + rounded + "% · " + MODEL_SIZE_LABEL
          + " · guardado localmente en IndexedDB.");
      },
    );

    setStatus("Verificando SHA-256 del modelo descargado…");
    const actualHash = await sha256Hex(modelBytes);
    if (actualHash !== MODEL_SHA256) {
      await modelManager.clearCache().catch(() => {});
      throw new Error("STT_MODEL_CHECKSUM_MISMATCH: el archivo descargado no coincide con el modelo oficial.");
    }

    setStatus("Inicializando whisper.cpp en WebAssembly…");
    await whisper.initModel(modelBytes);

    state.modelManager = modelManager;
    state.whisper = whisper;
    state.session = whisper.createSession();
    setStatus("Modelo listo y verificado. Las próximas aperturas lo recuperarán de IndexedDB; no hay cuota por transcripción.");
  } catch (error) {
    state.whisper = null;
    state.modelManager = null;
    state.session = null;
    setStatus("No se pudo preparar el motor: " + String(error?.message || error).slice(0, 240));
  } finally {
    state.loading = false;
    setBusy(false);
    refreshMetrics();
  }
});

$("audio-file").addEventListener("change", () => {
  const file = $("audio-file").files?.[0];
  $("transcribe").disabled = !state.whisper || !file || file.size < 1 || file.size > MAX_AUDIO_BYTES;
  $("transcription").textContent = file
    ? "Archivo seleccionado localmente: " + file.name + " (" + formatBytes(file.size) + "). No se ha enviado."
    : "La transcripción aparecerá aquí.";
  $("duration").textContent = "—";
  $("elapsed").textContent = "—";
  $("wer").textContent = "—";
});

$("transcribe").addEventListener("click", async () => {
  const file = $("audio-file").files?.[0];
  if (!state.session || !file || state.transcribing) return;
  if (file.size > MAX_AUDIO_BYTES) {
    setStatus("El archivo supera 25 MiB.");
    return;
  }

  state.transcribing = true;
  setBusy(true);
  $("transcription").textContent = "Decodificando audio y ejecutando Whisper en el dispositivo…";
  const started = performance.now();

  try {
    const { samples, duration } = await decodeMono16k(file);
    const segments = [];
    const stream = state.session.streaming(samples, {
      language: "es",
      threads: 2,
      translate: false,
      timeoutMs: 300_000,
      sleepMsBetweenChunks: 80,
    });

    for await (const segment of stream) {
      if (segment?.text) segments.push(String(segment.text).trim());
      $("transcription").textContent = segments.join(" ").replace(/\s+/g, " ").trim()
        || "Whisper está procesando el audio…";
    }

    const text = segments.join(" ").replace(/\s+/g, " ").trim();
    $("transcription").textContent = text || "El motor no devolvió texto.";
    $("duration").textContent = duration.toFixed(1) + " s";
    $("elapsed").textContent = ((performance.now() - started) / 1000).toFixed(1) + " s";
    const reference = $("reference").value.trim();
    const wer = reference ? wordErrorRate(reference, text) : null;
    $("wer").textContent = wer === null ? "Sin referencia" : (wer * 100).toFixed(1) + "%";
    setStatus("Prueba terminada en el dispositivo. El audio no se envió a ningún endpoint de inferencia.");
  } catch (error) {
    $("transcription").textContent = "Error de prueba: " + String(error?.message || error).slice(0, 260);
    setStatus("La prueba no se completó. No se hizo fallback remoto.");
  } finally {
    state.transcribing = false;
    setBusy(false);
    refreshMetrics();
  }
});

$("release-model").addEventListener("click", () => {
  if (!state.whisper || state.loading || state.transcribing) return;
  state.session = null;
  state.whisper = null;
  state.modelManager = null;
  $("audio-file").value = "";
  $("transcription").textContent = "Se soltó la instancia del motor. El navegador recuperará la memoria cuando ejecute su limpieza interna.";
  setStatus("Motor desconectado. El modelo verificado permanece en IndexedDB para evitar otra descarga.");
  setBusy(false);
  refreshMetrics();
});

refreshMetrics();
