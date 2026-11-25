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

test('a verified offline-ready shell has no persistent banner', () => {
  assert.equal(getOfflineShellStatusMessage('ready', false), null);
  assert.equal(getOfflineShellStatusMessage('checking', false), null);
});

test('preparation copy explains the next step when the device is offline', () => {
  const message = getOfflineShellStatusMessage('preparing', false);
  assert.match(message, /aún no ha terminado/i);
  assert.match(message, /Conéctate una vez/i);
  assert.doesNotMatch(message, /Mantén Internet conectado para preparar/i);
});

test('preparation copy is informative while the device is online', () => {
  assert.equal(
    getOfflineShellStatusMessage('preparing', true),
    'Preparando el acceso sin conexión…',
  );
});

test('an unavailable shell gives truthful guidance based on connectivity', () => {
  assert.match(getOfflineShellStatusMessage('unavailable', false), /Conéctate una vez/i);
  assert.match(getOfflineShellStatusMessage('unavailable', true), /No se pudo comprobar/i);
});

test('the status notice stays in document flow instead of covering mobile navigation', async () => {
  const styles = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
  assert.match(styles, /\.offline-shell-status\{position:relative;/);
  assert.doesNotMatch(styles, /\.offline-shell-status\{position:fixed;/);
});
