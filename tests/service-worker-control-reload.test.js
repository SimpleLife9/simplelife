import test from 'node:test';
import assert from 'node:assert/strict';
import { reloadOnServiceWorkerControllerChange } from '../src/lib/reload-on-service-worker-control.js';

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

test('reloads when a new Service Worker takes control after an initially uncontrolled page load', () => {
  const serviceWorker = makeServiceWorkerContainer(null);
  let reloads = 0;
  reloadOnServiceWorkerControllerChange(serviceWorker, { reload: () => { reloads += 1; } });

  serviceWorker.controller = { scriptURL: '/sw.js?v=12' };
  serviceWorker.emit('controllerchange');
  serviceWorker.emit('controllerchange');

  assert.equal(reloads, 1);
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
