import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  OFFLINE_SHELL_CACHE_NAME,
  getOfflineShellStatusMessage,
} from '../src/lib/offline-shell-readiness.js';


test('the app readiness check uses the active Service Worker cache namespace', async () => {
  const worker = await readFile(new URL('../public/sw.js', import.meta.url), 'utf8');
  assert.ok(worker.includes(`const CACHE_NAME = '${OFFLINE_SHELL_CACHE_NAME}';`));
});

test('the app and isolated Whisper pages receive cross-origin isolation headers', async () => {
  const headers = await readFile(new URL('../public/_headers', import.meta.url), 'utf8');
  const blocks = headers.trim().split(/\n(?=\/)/);
  for (const route of ['/', '/index.html', '/experiments/stt-local/index.html']) {
    const section = blocks.find((value) => value.split('\n')[0] === route);
    assert.ok(section, 'Missing response header section for ' + route);
    assert.match(section, /Cross-Origin-Opener-Policy: same-origin/);
    assert.match(section, /Cross-Origin-Embedder-Policy: credentialless/);
  }

  const vite = await readFile(new URL('../vite.config.js', import.meta.url), 'utf8');
  assert.match(vite, /server:\s*\{[\s\S]*?headers:\s*crossOriginIsolationHeaders/);
  assert.match(vite, /preview:\s*\{\s*headers:\s*crossOriginIsolationHeaders/);
});
test('a verified offline-ready shell has no persistent banner', () => {
  assert.equal(getOfflineShellStatusMessage('ready', false), null);
  assert.equal(getOfflineShellStatusMessage('checking', false), null);
});

test('offline readiness notices never cover the app while internet is available', () => {
  assert.equal(getOfflineShellStatusMessage('preparing', true), null);
  assert.equal(getOfflineShellStatusMessage('unavailable', true), null);
});

test('preparation guidance appears only while offline and the shell is incomplete', () => {
  const message = getOfflineShellStatusMessage('preparing', false);
  assert.match(message, /aún no ha terminado/i);
  assert.match(message, /Conéctate una vez/i);
  assert.doesNotMatch(message, /Mantén Internet conectado para preparar/i);
});

test('an unavailable shell gives offline-only recovery guidance', () => {
  const message = getOfflineShellStatusMessage('unavailable', false);
  assert.match(message, /No se pudo comprobar/i);
  assert.match(message, /Conéctate una vez/i);
});

test('the app entry point explicitly checks for Service Worker updates on every launch', async () => {
  const entry = await readFile(new URL('../src/main.jsx', import.meta.url), 'utf8');
  assert.match(entry, /registration\.update\(\)/);
  assert.match(entry, /updateViaCache:\s*'none'/);
});

test('a newly activated Service Worker reloads the page once so old bundles cannot remain mounted', async () => {
  const entry = await readFile(new URL('../src/main.jsx', import.meta.url), 'utf8');
  assert.match(entry, /addEventListener\('controllerchange'/);
  assert.match(entry, /window\.location\.reload\(\)/);
});

test('the status notice stays in document flow instead of covering mobile navigation', async () => {
  const styles = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
  assert.match(styles, /\.offline-shell-status\{position:relative;/);
  assert.doesNotMatch(styles, /\.offline-shell-status\{position:fixed;/);
});


test('the authenticated application shell does not mount the preparation banner above mobile navigation', async () => {
  const app = await readFile(new URL('../src/App.jsx', import.meta.url), 'utf8');
  const authenticatedBranch = app.slice(app.indexOf('const title = getPageTitle'));
  assert.match(authenticatedBranch, /<AppShell/);
  assert.doesNotMatch(authenticatedBranch, /<OfflinePreparationStatus\s*\/>/);
});

test('Inbox mounts a local transcription action inside each eligible private audio card', async () => {
  const inbox = await readFile(new URL('../src/features/inbox/InboxPage.jsx', import.meta.url), 'utf8');
  const panel = await readFile(new URL('../src/features/inbox/components/LocalVoiceTranscriptionPanel.jsx', import.meta.url), 'utf8');
  const domain = await readFile(new URL('../src/features/inbox/domain/local-voice-transcription.js', import.meta.url), 'utf8');
  const styles = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');

  assert.ok(inbox.includes('<LocalVoiceTranscriptionPanel'));
  assert.ok(inbox.includes('asset={asset}'));
  assert.ok(inbox.includes('voiceAssets.filter((asset) => !asset.capture_id).map'));
  assert.match(panel, /Transcribir localmente/);
  assert.match(panel, /Guardar transcripción como captura/);
  assert.ok(panel.includes("record_inbox_voice_transcription_local"));
  assert.doesNotMatch(panel, /type="file"|Elegir audio de prueba/);
  assert.ok(domain.includes(".download(expectedObjectPath)"));
  assert.ok(domain.includes("sha256Hex(await blob.arrayBuffer())"));
  assert.ok(styles.includes(".inbox-local-stt-panel{"));
});
