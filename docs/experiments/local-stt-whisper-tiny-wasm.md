# SimpleLife local STT experiment — Whisper Tiny / WASM

**Status:** experimental harness only; not a production feature and not approved for private originals.

## Purpose

Evaluate speech-to-text without sending audio bytes to an inference provider, without using ARIA tokens, and without touching the private Inbox queue. The harness lives at `/experiments/stt-local/` and is deliberately absent from the main product navigation.

## Fixed experimental inputs

- Runtime: `@huggingface/transformers@4.3.2`, imported only after the owner explicitly presses **Descargar y preparar modelo**.
- Model: `onnx-community/whisper-tiny`.
- Model revision: `ff4177021cc41f7db950912b73ea4fdf7d01d8e7`.
- Runtime: WebAssembly on CPU, one thread, Q8 quantized weights.
- The upstream ONNX folder contains a 10.1 MB quantized encoder and a 30.7 MB quantized merged decoder (approximately 40.8 MB combined weights); tokenizer/config and the Transformers/ONNX runtime add more. See [pinned model revision](https://huggingface.co/onnx-community/whisper-tiny/tree/ff4177021cc41f7db950912b73ea4fdf7d01d8e7/onnx).
- Transformers.js browser and WASM caching are enabled with a dedicated cache key. The model is fetched from the pinned Hugging Face revision; the runtime module is loaded from a pinned jsDelivr package version.
- The page contains no microphone integration, no SimpleLife/Supabase client, no ARIA route, and no connection to the transcription worker.

## Processing/privacy boundary

- The user selects a local audio file manually. The harness decodes it in the browser, converts it to mono 16 kHz Float32 samples through Web Audio, and passes only those samples to the in-tab WASM pipeline.
- No audio file is sent via fetch, XHR, form submission, or a provider API. A fetch guard rejects non-GET/HEAD requests and restricts model/runtime downloads to an explicit static-host allowlist.
- The first run requires Internet to download the library, WASM runtime and model weights. The Cache API is enabled for later reloads; cache eviction, quota and cold-start offline behavior must still be verified on each target device.
- The E2E test checks that the page makes no outbound request before the explicit model-load click. It does not claim that a model download or offline inference has passed.
- The lab must only use synthetic/public test audio. Never select, download, or copy the five private original audios into this harness.

## Why Vosklet was not selected for this spike

The published Vosklet build initializes shared WebAssembly memory at 5,040 64-KiB pages (315 MiB) and requires cross-origin isolation headers (COOP `same-origin` and COEP `require-corp`) for SharedArrayBuffer. Adding those headers to the existing PWA would change its isolation and resource compatibility. This is too large a first change without device memory tests. See [Vosklet 1.2.1 source](https://raw.githubusercontent.com/msqr1/Vosklet/1.2.1/Vosklet.js) and [Vosklet requirements](https://github.com/msqr1/Vosklet/blob/main/Documentation.md).

Whisper Tiny Q8 is the smaller first candidate to measure, not a production recommendation. Its runtime memory and speed on the owner's Android device are unknown until physically measured.

## Acceptance sequence

1. Open the lab page from the PR Preview while online.
2. Load the model and confirm download completes; check that no private audio is present.
3. Select a synthetic short Spanish sample and run transcription.
4. Record result text, duration, inference time, browser/device, storage estimate and any memory information available. `performance.memory` is only JS heap, not complete WASM or process memory.
5. Keep the page open, disconnect Internet, repeat with the same synthetic file and confirm inference performs no network writes or new model downloads.
6. Close/reopen the page offline and verify whether runtime plus model cache survive a cold start. This is a separate result from same-tab offline inference.
7. Repeat on the physical Android device and desktop. Stop if browser memory pressure, tab reload, heat or sustained CPU use is unacceptable.
8. Compare word error rate only with a known synthetic reference. The test voice is Latin-American synthetic TTS, not a validation corpus for Cuban speech.

## Release boundary

This experiment changes no production UI, Supabase schema/data/RLS, Edge Functions, secrets, billing, scheduler, worker configuration, audio retention, or STT provider route. The private transcription worker remains disabled/fail-closed. PR #97 remains OPEN/DRAFT; no merge or production deploy is authorized by this experiment.


## Browser CDN and model-download routing fix (26 November 2026)

- The pinned Transformers.js runtime now uses the documented vanilla-browser ES module URL `https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.2` (without jsDelivr's `+esm` transformation). See [official installation instructions](https://huggingface.co/docs/transformers.js/installation).
- The model fetch allowlist explicitly includes the current Hugging Face Hub/Xet endpoints: `cas-server.xethub.hf.co`, `cas-server.xethub-eu.hf.co`, `transfer.xethub.hf.co`, `transfer.xethub-eu.hf.co`, `us.aws.cdn.hf.co`, `us.gcp.cdn.hf.co`, `cdn-lfs-us-1.hf.co`, and `cdn-lfs-eu-1.hf.co`, alongside the existing Hub/CDN domains. Hugging Face documents that model files can redirect to these separate storage/CDN hosts and that allowlisting only `huggingface.co` is insufficient: [official download networking requirements](https://huggingface.co/docs/hub/models-downloading#downloading-behind-a-proxy-or-firewall).
- The fetch guard now checks the initial and final redirect host against that explicit set and reports the failing hostname/path (without query strings or signed tokens).
- The UI distinguishes runtime import failure from model/WASM download failure, so the next diagnostic is actionable.
- This is a targeted compatibility fix, not a broad wildcard allowlist. The browser must still be able to reach the listed HTTPS endpoints; the actual model download remains unverified until the user repeats the explicit load action.


## Same-origin model-download relay (26 November 2026)

- The browser now fetches model files from `/__stt-model/` on the same origin as the laboratory. The existing Cloudflare Worker performs a read-only server-to-server fetch of the public Hugging Face snapshot and streams the bytes to the browser.
- This specifically avoids requiring the owner's browser/network to connect directly to `huggingface.co` or the Hub's redirected Xet/CDN hosts. Hugging Face documents that model files are served by separate storage/CDN hosts and that restrictive networks can fail even when the Hub hostname itself is reachable ([official networking guidance](https://huggingface.co/docs/hub/models-downloading#downloading-behind-a-proxy-or-firewall)).
- The Worker is not an open proxy. It permits only GET/HEAD, rejects query strings, and serves a closed file list from `onnx-community/whisper-tiny` at revision `ff4177021cc41f7db950912b73ea4fdf7d01d8e7`. Redirect destinations are checked against the documented Hugging Face Hub/Xet/CDN host set.
- Cloudflare Worker response streaming avoids buffering the 40.8 MB Q8 model weights in Worker memory. The upstream response is edge-cacheable for one day; the browser/Transformers cache remains enabled.
- No audio is sent to this Worker. The request contract only exposes static model artifacts; the audio still decodes and runs in-tab on WebAssembly.
- Preview CI now probes the live same-origin proxy against the actual pinned Hugging Face `config.json`, in addition to the browser regression proving that an attempted direct Hub URL is rewritten to the same-origin Worker path.
- This remains an isolated experiment. No new Worker, project, secret, hosted Supabase change, inference endpoint or paid provider is introduced. The existing Worker will route the proxy path only in this PR Preview until a separate production authorization.


## Same-origin Whisper runtime package and offline Worker fix (27 November 2026)

- CI on the prior revision exposed the browser error: `Failed to construct 'Worker'` for `libmain-D9-QM3iM.mjs` while it was served by `cdn.jsdelivr.net`. The module creates its Emscripten pthread Worker using `new Worker(new URL("", import.meta.url), { type: "module" })`; browsers reject that cross-origin Worker from the SimpleLife Preview.
- The pinned upstream `@timur00kh/whisper.wasm@0.1.1` browser ESM entrypoint and its Emscripten module are now vendored under `public/vendor/whisper-wasm/0.1.1/`, with the upstream MIT license and SHA-256 provenance. The module and its Worker entrypoint resolve to the SimpleLife origin.
- Both Inbox and the isolated laboratory load `/vendor/whisper-wasm/0.1.1/index.es.js`; runtime imports and the model download use only the same origin. The browser no longer needs jsDelivr for Whisper execution.
- The existing Worker adds immutable JavaScript caching for exactly the two versioned runtime files; it remains a closed asset path, not a general proxy.
- PWA shell v11 precaches the laboratory document/controller plus the two runtime files. The service worker retains offline launch, and the offline regression now verifies both runtime files can be read from Cache Storage after clearing HTTP cache and disconnecting the browser.
- CI adds Preview checks for the JavaScript MIME type, immutable cache headers and same-origin bundle paths, followed by the hosted synthetic-audio inference test. Do not mark the STT task PASS until the hosted test completes actual inference.
- No Supabase-hosted data, private Inbox audio, audio queue, production Worker or production deployment is involved. The model remains downloaded only after an explicit user action, via the fixed read-only model route.
