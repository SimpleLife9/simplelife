import test from 'node:test';
import assert from 'node:assert/strict';
import { reloadOnServiceWorkerControllerChange } from '../src/lib/reload-on-service-worker-control.js';
import { createServiceWorkerScriptUrl, getAppShellBuildIdentity } from '../src/lib/service-worker-registration.js';

function makeServiceWorkerContainer(initialController = null) {
  const listeners = new Map();
  return {
    controller: initialController,
    addEventListener(type, callback) {
      const group = listeners.get(type) || new Set();
      group.add(callback);
      listeners.set(type, group);
    },
    removeEventListener(type, callback) {
      listeners.get(type)?.delete(callback);
    },
    emit(type) {
      for (const callback of listeners.get(type) || []) callback();
    },
  };
}

test('does not force a reload when the first Service Worker claims an unowned page', () => {
  const serviceWorker = makeServiceWorkerContainer(null);
  let reloads = 0;
  reloadOnServiceWorkerControllerChange(serviceWorker, { reload: () => { reloads += 1; } });

  serviceWorker.controller = { scriptURL: '/sw.js?v=12' };
  serviceWorker.emit('controllerchange');
  serviceWorker.emit('controllerchange');

  assert.equal(reloads, 0);
});

test('reloads once when an updated Service Worker replaces the existing controller', () => {
  const serviceWorker = makeServiceWorkerContainer({ scriptURL: '/sw.js?v=11' });
  let reloads = 0;
  reloadOnServiceWorkerControllerChange(serviceWorker, { reload: () => { reloads += 1; } });

  serviceWorker.emit('controllerchange');
  serviceWorker.controller = { scriptURL: '/sw.js?v=12' };
  serviceWorker.emit('controllerchange');
  serviceWorker.emit('controllerchange');

  assert.equal(reloads, 1);
});

test('does not reload when the controller is removed or remains unchanged', () => {
  const originalController = { scriptURL: '/sw.js?v=12' };
  const serviceWorker = makeServiceWorkerContainer(originalController);
  let reloads = 0;
  reloadOnServiceWorkerControllerChange(serviceWorker, { reload: () => { reloads += 1; } });

  serviceWorker.controller = null;
  serviceWorker.emit('controllerchange');
  serviceWorker.controller = originalController;
  serviceWorker.emit('controllerchange');

  assert.equal(reloads, 0);
});


test('build identity changes the Service Worker URL when a compiled JS or CSS asset changes', () => {
  const makeDocument = (scriptSource, stylesheetSource) => ({
    querySelector(selector) {
      assert.equal(selector, 'script[type="module"][src]');
      return { getAttribute: () => scriptSource };
    },
    querySelectorAll(selector) {
      assert.equal(selector, 'link[rel="stylesheet"][href]');
      return [{ getAttribute: () => stylesheetSource }];
    },
  });

  const firstIdentity = getAppShellBuildIdentity(
    makeDocument('/assets/index-old.js', '/assets/index-old.css'),
  );
  const nextIdentity = getAppShellBuildIdentity(
    makeDocument('/assets/index-new.js', '/assets/index-old.css'),
  );
  const cssIdentity = getAppShellBuildIdentity(
    makeDocument('/assets/index-old.js', '/assets/index-new.css'),
  );

  assert.notEqual(firstIdentity, nextIdentity);
  assert.notEqual(firstIdentity, cssIdentity);
  const firstUrl = new URL(createServiceWorkerScriptUrl('https://simplelife.test', firstIdentity));
  const nextUrl = new URL(createServiceWorkerScriptUrl('https://simplelife.test', nextIdentity));
  assert.equal(firstUrl.pathname, '/sw.js');
  assert.equal(firstUrl.searchParams.get('build'), firstIdentity);
  assert.notEqual(firstUrl.href, nextUrl.href);
});

test('keeps a plain same-origin Service Worker URL when no build identity is available', () => {
  assert.equal(createServiceWorkerScriptUrl('https://simplelife.test', ''), 'https://simplelife.test/sw.js');
});
