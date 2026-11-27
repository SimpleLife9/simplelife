# Vendored Whisper WASM runtime

Source npm package: `@timur00kh/whisper.wasm@0.1.1`
Upstream: https://github.com/Timur00Kh/whisper.wasm
Package license: MIT (see `LICENSE` in this directory).

Only the browser ESM entrypoint and its Emscripten shared-memory module are included:
- `index.es.js` — public browser API
- `libmain-D9-QM3iM.mjs` — Emscripten module and module Worker entrypoint

SHA-256:
- `index.es.js`: `0d37558743e3b1c97265b77ec0131caf8c803c93f24a36a74c670d163c19aeab`
- `libmain-D9-QM3iM.mjs`: `990792a983600b01ca18fe78fa07e0df1f8efec8db578c71330a6cdb a10d67e3` (remove the space when verifying: `990792a983600b01ca18fe78fa07e0df1f8efec8db578c71330a6cdba10d67e3`).

Keep these files together at this versioned path. The Emscripten module constructs its pthread workers from `import.meta.url`; hosting the entrypoint and worker module under the same SimpleLife origin avoids cross-origin Worker construction being blocked by the browser. The Service Worker precaches both files for offline reuse.

No audio, model weights, user data, API endpoint, or network service is bundled here. The multilingual model is fetched separately, on explicit user action, through SimpleLife's read-only pinned-model Worker route.
