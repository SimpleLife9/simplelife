import test from 'node:test';
import assert from 'node:assert/strict';
import worker, { proxyWhisperCppModelFile } from '../src/worker.js';

const ORIGIN = 'https://simplelife-preview.example';
const REVISION = '0b364b566045a405be7225ee1e415a073e04da77';
const MODEL_PATH = 'ggerganov/whisper.cpp/resolve/' + REVISION + '/ggml-tiny-q5_1.bin';
const MODEL_URL = ORIGIN + '/__stt-whisper/' + MODEL_PATH;

test('Whisper.cpp proxy streams only the pinned multilingual q5_1 model', async () => {
  let requestedUrl;
  let requestedInit;
  const body = new Uint8Array([1, 2, 3, 4]);
  const response = await proxyWhisperCppModelFile(
    new Request(MODEL_URL),
    async (url, init) => {
      requestedUrl = String(url);
      requestedInit = init;
      return new Response(body, {
        status: 200,
        headers: { 'content-type': 'application/octet-stream', 'content-length': '4' },
      });
    },
  );

  assert.equal(requestedUrl, 'https://huggingface.co/' + MODEL_PATH);
  assert.equal(requestedInit.method, 'GET');
  assert.equal(requestedInit.redirect, 'follow');
  assert.equal(response.status, 200);
  assert.match(response.headers.get('cache-control'), /max-age=31536000/);
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), body);
});

test('Whisper.cpp proxy preserves byte ranges for the 32 MB model', async () => {
  let observedRange;
  const response = await proxyWhisperCppModelFile(
    new Request(MODEL_URL, { headers: { range: 'bytes=0-63' } }),
    async (_url, init) => {
      observedRange = init.headers.get('range');
      return new Response(new Uint8Array(64), {
        status: 206,
        headers: {
          'content-range': 'bytes 0-63/32200000',
          'accept-ranges': 'bytes',
        },
      });
    },
  );

  assert.equal(observedRange, 'bytes=0-63');
  assert.equal(response.status, 206);
  assert.equal(response.headers.get('content-range'), 'bytes 0-63/32200000');
  assert.equal((await response.arrayBuffer()).byteLength, 64);
});

test('Whisper.cpp proxy permits HEAD and forwards conditional headers', async () => {
  let requestedMethod;
  let observedRange;
  let observedIfRange;
  const response = await proxyWhisperCppModelFile(
    new Request(MODEL_URL, {
      method: 'HEAD',
      headers: { range: 'bytes=0-0', 'if-range': '"model-etag"' },
    }),
    async (_url, init) => {
      requestedMethod = init.method;
      observedRange = init.headers.get('range');
      observedIfRange = init.headers.get('if-range');
      return new Response(null, {
        status: 200,
        headers: { 'content-length': '32200000' },
      });
    },
  );

  assert.equal(requestedMethod, 'HEAD');
  assert.equal(observedRange, 'bytes=0-0');
  assert.equal(observedIfRange, '"model-etag"');
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-length'), '32200000');
});

test('Whisper.cpp proxy rejects writes, arbitrary revisions, other files and query strings', async () => {
  const shouldNotFetch = async () => {
    throw new Error('Upstream must not be called for rejected input.');
  };
  const write = await proxyWhisperCppModelFile(
    new Request(MODEL_URL, { method: 'POST' }),
    shouldNotFetch,
  );
  const mutableRevision = await proxyWhisperCppModelFile(
    new Request(ORIGIN + '/__stt-whisper/ggerganov/whisper.cpp/resolve/main/ggml-tiny-q5_1.bin'),
    shouldNotFetch,
  );
  const otherFile = await proxyWhisperCppModelFile(
    new Request(ORIGIN + '/__stt-whisper/' + MODEL_PATH.replace('ggml-tiny-q5_1.bin', 'ggml-tiny.bin')),
    shouldNotFetch,
  );
  const query = await proxyWhisperCppModelFile(
    new Request(MODEL_URL + '?token=anything'),
    shouldNotFetch,
  );

  assert.equal(write.status, 405);
  assert.equal(mutableRevision.status, 404);
  assert.equal(otherFile.status, 404);
  assert.equal(query.status, 400);
});

test('Whisper.cpp proxy rejects redirects outside the explicit Hugging Face CDN allowlist', async () => {
  const response = await proxyWhisperCppModelFile(
    new Request(MODEL_URL),
    async () => {
      const upstream = new Response('unexpected');
      Object.defineProperty(upstream, 'url', { value: 'https://unexpected.example/model.bin' });
      return upstream;
    },
  );

  assert.equal(response.status, 502);
  assert.equal(await response.text(), 'STT_MODEL_UPSTREAM_HOST_REJECTED');
});


test('Worker marks mutable STT lab HTML and JavaScript as no-store', async () => {
  const cachedAssetFetch = async (request) => new Response('current lab asset', {
    status: 200,
    headers: { 'cache-control': 'public, max-age=604800' },
  });

  const document = await worker.fetch(
    new Request(ORIGIN + '/experiments/stt-local/index.html', {
      headers: { 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'document' },
    }),
    { ASSETS: { fetch: cachedAssetFetch } },
  );
  const canonicalDirectory = await worker.fetch(
    new Request(ORIGIN + '/experiments/stt-local/'),
    { ASSETS: { fetch: cachedAssetFetch } },
  );
  const extensionlessDirectory = await worker.fetch(
    new Request(ORIGIN + '/experiments/stt-local'),
    { ASSETS: { fetch: cachedAssetFetch } },
  );
  const script = await worker.fetch(
    new Request(ORIGIN + '/experiments/stt-local/app.js'),
    { ASSETS: { fetch: cachedAssetFetch } },
  );

  assert.equal(document.status, 200);
  assert.equal(canonicalDirectory.status, 200);
  assert.equal(extensionlessDirectory.status, 200);
  assert.equal(script.status, 200);
  assert.equal(document.headers.get('cache-control'), 'no-store');
  assert.equal(canonicalDirectory.headers.get('cache-control'), 'no-store');
  assert.equal(extensionlessDirectory.headers.get('cache-control'), 'no-store');
  assert.equal(script.headers.get('cache-control'), 'no-store');
});


test('Worker serves the pinned Whisper WASM runtime as immutable same-origin JavaScript', async () => {
  const expectedPaths = [
    '/vendor/whisper-wasm/0.1.1/index.es.js',
    '/vendor/whisper-wasm/0.1.1/libmain-D9-QM3iM.mjs',
  ];
  for (const path of expectedPaths) {
    let requestedPath;
    const response = await worker.fetch(
      new Request(ORIGIN + path),
      {
        ASSETS: {
          fetch: async (request) => {
            requestedPath = new URL(request.url).pathname;
            return new Response('/* pinned same-origin runtime asset */', {
              status: 200,
              headers: { 'content-type': 'application/octet-stream' },
            });
          },
        },
      },
    );
    assert.equal(requestedPath, path);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('cache-control'), /max-age=31536000/);
    assert.match(response.headers.get('cache-control'), /immutable/);
    assert.match(response.headers.get('content-type'), /javascript/);
    assert.equal(response.headers.get('cross-origin-embedder-policy'), 'credentialless');
    assert.equal(response.headers.get('cross-origin-resource-policy'), 'same-origin');
    assert.match(await response.text(), /pinned same-origin runtime asset/);
  }
});

test('Worker app navigation documents are no-store so existing PWAs can discover updates', async () => {
  const response = await worker.fetch(
    new Request(ORIGIN + '/', {
      headers: {
        'sec-fetch-mode': 'navigate',
        'sec-fetch-dest': 'document',
      },
    }),
    {
      ASSETS: {
        fetch: async () => new Response('<!doctype html><title>SimpleLife current build</title>', {
          status: 200,
          headers: { 'content-type': 'text/html; charset=utf-8' },
        }),
      },
    },
  );

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.match(await response.text(), /SimpleLife current build/);
});
