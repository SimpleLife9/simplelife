import test from 'node:test';
import assert from 'node:assert/strict';
import { proxyWhisperModelFile } from '../src/worker.js';

const ORIGIN = 'https://simplelife-preview.example';
const REVISION = 'ff4177021cc41f7db950912b73ea4fdf7d01d8e7';
const MODEL_PATH = 'onnx-community/whisper-tiny/resolve/' + REVISION + '/';

test('Whisper proxy fetches only the pinned config and streams the upstream body', async () => {
  let requestedUrl;
  let requestedInit;
  const response = await proxyWhisperModelFile(
    new Request(ORIGIN + '/__stt-model/' + MODEL_PATH + 'config.json'),
    async (url, init) => {
      requestedUrl = String(url);
      requestedInit = init;
      return new Response('{"model_type":"whisper"}', {
        status: 200,
        headers: { 'content-type': 'application/json', 'etag': '"fixture"' },
      });
    },
  );

  assert.equal(requestedUrl, 'https://huggingface.co/' + MODEL_PATH + 'config.json');
  assert.equal(requestedInit.method, 'GET');
  assert.equal(requestedInit.redirect, 'follow');
  assert.equal(response.status, 200);
  assert.match(response.headers.get('cache-control'), /max-age=86400/);
  assert.equal(await response.text(), '{"model_type":"whisper"}');
});

test('Whisper proxy forwards byte-range headers for large ONNX files', async () => {
  let observedRange;
  const response = await proxyWhisperModelFile(
    new Request(
      ORIGIN + '/__stt-model/' + MODEL_PATH + 'onnx/decoder_model_merged_quantized.onnx',
      { headers: { range: 'bytes=0-0' } },
    ),
    async (_url, init) => {
      observedRange = init.headers.get('range');
      return new Response(new Uint8Array([0]), {
        status: 206,
        headers: { 'content-range': 'bytes 0-0/32100000', 'accept-ranges': 'bytes' },
      });
    },
  );

  assert.equal(observedRange, 'bytes=0-0');
  assert.equal(response.status, 206);
  assert.equal(response.headers.get('content-range'), 'bytes 0-0/32100000');
});

test('Whisper proxy rejects writes, arbitrary snapshots, query strings and unknown model files', async () => {
  const shouldNotFetch = async () => {
    throw new Error('Upstream must not be called for rejected input.');
  };
  const write = await proxyWhisperModelFile(
    new Request(ORIGIN + '/__stt-model/' + MODEL_PATH + 'config.json', { method: 'POST' }),
    shouldNotFetch,
  );
  const differentRevision = await proxyWhisperModelFile(
    new Request(ORIGIN + '/__stt-model/onnx-community/whisper-tiny/resolve/main/config.json'),
    shouldNotFetch,
  );
  const unknownFile = await proxyWhisperModelFile(
    new Request(ORIGIN + '/__stt-model/' + MODEL_PATH + 'private.txt'),
    shouldNotFetch,
  );
  const query = await proxyWhisperModelFile(
    new Request(ORIGIN + '/__stt-model/' + MODEL_PATH + 'config.json?token=anything'),
    shouldNotFetch,
  );

  assert.equal(write.status, 405);
  assert.equal(differentRevision.status, 404);
  assert.equal(unknownFile.status, 404);
  assert.equal(query.status, 400);
});

test('Whisper proxy rejects upstream redirects to hosts outside the explicit allowlist', async () => {
  const response = await proxyWhisperModelFile(
    new Request(ORIGIN + '/__stt-model/' + MODEL_PATH + 'config.json'),
    async () => {
      const upstream = new Response('{"model_type":"whisper"}');
      Object.defineProperty(upstream, 'url', { value: 'https://unexpected.example/config.json' });
      return upstream;
    },
  );

  assert.equal(response.status, 502);
  assert.equal(await response.text(), 'STT_MODEL_UPSTREAM_HOST_REJECTED');
});
