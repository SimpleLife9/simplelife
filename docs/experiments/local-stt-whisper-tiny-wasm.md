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
