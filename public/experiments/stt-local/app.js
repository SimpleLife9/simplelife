const TRANSFORMERS_MODULE = "https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.2";
const ALLOWED_DOWNLOAD_HOSTS = new Set([
  location.hostname,
  "cdn.jsdelivr.net",
  "huggingface.co",
  "hf.co",
  "cas-server.xethub.hf.co",
  "cas-server.xethub-eu.hf.co",
  "transfer.xethub.hf.co",
  "transfer.xethub-eu.hf.co",
  "us.aws.cdn.hf.co",
  "us.gcp.cdn.hf.co",
  "cdn-lfs-us-1.hf.co",
  "cdn-lfs-eu-1.hf.co",
  "cdn-lfs.huggingface.co",
  "cas-bridge.xethub.hf.co",
]);
const MODEL_ID = "onnx-community/whisper-tiny";
const MODEL_REVISION = "ff4177021cc41f7db950912b73ea4fdf7d01d8e7";
// Transformers.js 4.3.2 performs a metadata preflight without forwarding `revision`.
// Pin the shared URL template as well so every request, including that preflight, uses this exact commit.
const MODEL_REMOTE_PATH_TEMPLATE = "{model}/resolve/{revision}/";
const SAMPLE_RATE = 16_000;
const MAX_AUDIO_BYTES = 25 * 1024 * 1024;
const MAX_DURATION_SECONDS = 180;

const $ = (id) => document.getElementById(id);
const state = { pipeline: null, loading: false, transcribing: false };

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
    }).catch(() => { $("storage").textContent = "No disponible"; });
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
      throw new Error("El audio debe durar entre 1 segundo y 3 minutos.");
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
  $("load-model").disabled = busy || Boolean(state.pipeline);
  $("release-model").disabled = busy || !state.pipeline;
  $("audio-file").disabled = busy || !state.pipeline;
  $("transcribe").disabled = busy || !state.pipeline || !$("audio-file").files?.length;
}
function pinModelRevisionUrl(url) {
  const unpinnedPrefix = "/" + MODEL_ID + "/resolve/main/";
  if (url.origin !== "https://huggingface.co" || !url.pathname.startsWith(unpinnedPrefix)) {
    return url;
  }
  const pinnedUrl = new URL(url.href);
  pinnedUrl.pathname = pinnedUrl.pathname.replace(
    unpinnedPrefix,
    "/" + MODEL_ID + "/resolve/" + MODEL_REVISION + "/",
  );
  return pinnedUrl;
}

function installFetchWriteGuard() {
  if (window.__simpleLifeSttFetchGuardInstalled) return;
  const nativeFetch = window.fetch.bind(window);
  window.fetch = async (input, init = {}) => {
    const method = String(init.method || (input instanceof Request ? input.method : "GET")).toUpperCase();
    if (!["GET", "HEAD"].includes(method)) {
      throw new Error("STT_NETWORK_WRITE_BLOCKED");
    }
    const originalUrl = new URL(input instanceof Request ? input.url : input, location.href);
    if (!ALLOWED_DOWNLOAD_HOSTS.has(originalUrl.hostname)) {
      throw new Error("STT_REMOTE_HOST_NOT_ALLOWLISTED: " + originalUrl.hostname);
    }
    // Transformers.js may issue a metadata preflight with revision="main".
    // Pin that exact repository path before any network request can leave the tab.
    const url = pinModelRevisionUrl(originalUrl);
    if (!ALLOWED_DOWNLOAD_HOSTS.has(url.hostname)) {
      throw new Error("STT_REMOTE_HOST_NOT_ALLOWLISTED: " + url.hostname);
    }
    const fetchInput = url.href !== originalUrl.href
      ? (input instanceof Request ? new Request(url.href, input) : url.href)
      : input;
    try {
      const response = await nativeFetch(fetchInput, init);
      const finalUrl = response.url ? new URL(response.url) : url;
      if (!ALLOWED_DOWNLOAD_HOSTS.has(finalUrl.hostname)) {
        throw new Error("STT_REDIRECT_HOST_NOT_ALLOWLISTED: " + finalUrl.hostname);
      }
      return response;
    } catch (error) {
      const message = String(error?.message || error);
      if (message.startsWith("STT_")) throw error;
      throw new Error(
        "STT_FETCH_FAILED: " + url.hostname + url.pathname + " (" + message.slice(0, 120) + ")",
      );
    }
  };
  window.__simpleLifeSttFetchGuardInstalled = true;
}

$("load-model").addEventListener("click", async () => {
  if (state.loading || state.pipeline) return;
  state.loading = true;
  setBusy(true);
  setStatus("Descargando runtime Transformers.js 4.3.2 desde cdn.jsdelivr.net…");
  installFetchWriteGuard();
  try {
    let runtime;
    try {
      runtime = await import(TRANSFORMERS_MODULE);
    } catch (error) {
      throw new Error("STT_RUNTIME_IMPORT_FAILED [cdn.jsdelivr.net]: " + String(error?.message || error).slice(0, 180));
    }
    const { env, pipeline } = runtime;
    setStatus("Runtime listo. Descargando modelo y archivos WASM desde los hosts estáticos permitidos…");
    env.remotePathTemplate = MODEL_REMOTE_PATH_TEMPLATE;
    env.useBrowserCache = true;
    env.useWasmCache = true;
    env.cacheKey = "simplelife-local-stt-whisper-tiny-v1";
    env.allowRemoteModels = true;
    env.allowLocalModels = false;
    env.backends.onnx.wasm.numThreads = 1;
    const persistent = navigator.storage?.persist
      ? await navigator.storage.persist().catch(() => false)
      : false;
    $("storage").textContent = persistent ? "Persistente concedida" : "Caché del navegador";
    try {
      state.pipeline = await pipeline("automatic-speech-recognition", MODEL_ID, {
        device: "wasm",
        dtype: "q8",
        revision: MODEL_REVISION,
        progress_callback: (event) => {
          const name = typeof event.file === "string" ? event.file.split("/").pop() : "archivo del modelo";
          const progress = Number.isFinite(event.progress) ? " · " + event.progress.toFixed(0) + "%" : "";
          setStatus("Preparando " + name + progress);
        },
      });
    } catch (error) {
      throw new Error("STT_MODEL_OR_WASM_LOAD_FAILED: " + String(error?.message || error).slice(0, 200));
    }
    setStatus("Modelo listo. Ya puedes elegir un audio de prueba; no se ha accedido a micrófono ni a Storage privado.");
  } catch (error) {
    state.pipeline = null;
    setStatus("No se pudo preparar el modelo: " + String(error?.message || error).slice(0, 220));
  } finally {
    state.loading = false;
    setBusy(false);
    refreshMetrics();
  }
});

$("audio-file").addEventListener("change", () => {
  const file = $("audio-file").files?.[0];
  $("transcribe").disabled = !state.pipeline || !file || file.size < 1 || file.size > MAX_AUDIO_BYTES;
  $("transcription").textContent = file
    ? "Archivo seleccionado localmente: " + file.name + " (" + formatBytes(file.size) + "). No se ha enviado."
    : "La transcripción aparecerá aquí.";
  $("duration").textContent = "—";
  $("elapsed").textContent = "—";
  $("wer").textContent = "—";
});

$("transcribe").addEventListener("click", async () => {
  const file = $("audio-file").files?.[0];
  if (!state.pipeline || !file || state.transcribing) return;
  if (file.size > MAX_AUDIO_BYTES) {
    setStatus("El archivo supera 25 MiB.");
    return;
  }
  state.transcribing = true;
  setBusy(true);
  $("transcription").textContent = "Decodificando y transcribiendo localmente…";
  const started = performance.now();
  try {
    const { samples, duration } = await decodeMono16k(file);
    const result = await state.pipeline(samples, {
      sampling_rate: SAMPLE_RATE,
      language: "spanish",
      task: "transcribe",
      chunk_length_s: 30,
      stride_length_s: 5,
    });
    const text = String(result?.text || "").trim();
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

$("release-model").addEventListener("click", async () => {
  if (!state.pipeline || state.loading || state.transcribing) return;
  try {
    await state.pipeline.dispose?.();
  } catch { /* best-effort release */ }
  state.pipeline = null;
  $("audio-file").value = "";
  $("transcription").textContent = "Motor liberado.";
  setStatus("Se liberó la instancia del modelo. Los pesos permanecen en caché hasta que el navegador los elimine.");
  setBusy(false);
  refreshMetrics();
});

refreshMetrics();
