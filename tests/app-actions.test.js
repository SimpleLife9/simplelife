import test from 'node:test';
import assert from 'node:assert/strict';
import { createAppActions } from '../src/app/createAppActions.js';

function createHarness() {
  const state = { busy: false, error: '', notice: '', refreshKey: 0 };
  const scheduled = [];
  const actions = createAppActions({
    setBusy: (value) => { state.busy = value; },
    setError: (value) => { state.error = value; },
    setNotice: (value) => {
      state.notice = typeof value === 'function' ? value(state.notice) : value;
    },
    setRefreshKey: (update) => { state.refreshKey = update(state.refreshKey); },
    schedule: (callback, delay) => scheduled.push({ callback, delay }),
  });
  return { state, scheduled, actions };
}

test('runAction completes successfully, refreshes shared data and reports success', async () => {
  const { state, scheduled, actions } = createHarness();
  const result = await actions.runAction(async () => {}, 'Guardado correctamente');

  assert.equal(result, true);
  assert.equal(state.busy, false);
  assert.equal(state.error, '');
  assert.equal(state.notice, 'Guardado correctamente');
  assert.equal(state.refreshKey, 1);
  assert.equal(scheduled.length, 1);
  assert.equal(scheduled[0].delay, 3500);
});

test('runAction reports an operation error and does not refresh on failure', async () => {
  const { state, scheduled, actions } = createHarness();
  const result = await actions.runAction(async () => {
    throw new Error('No se pudo guardar');
  }, 'No debe mostrarse');

  assert.equal(result, false);
  assert.equal(state.busy, false);
  assert.equal(state.error, 'No se pudo guardar');
  assert.equal(state.notice, '');
  assert.equal(state.refreshKey, 0);
  assert.equal(scheduled.length, 0);
});

test('runAction can route errors to a local handler without showing the global banner', async () => {
  const { state, scheduled, actions } = createHarness();
  let inlineError = null;
  const result = await actions.runAction(async () => {
    throw new Error('Network unavailable');
  }, 'No debe mostrarse', {
    onError: (error) => { inlineError = error.message; },
  });

  assert.equal(result, false);
  assert.equal(state.busy, false);
  assert.equal(state.error, '');
  assert.equal(state.notice, '');
  assert.equal(state.refreshKey, 0);
  assert.equal(inlineError, 'Network unavailable');
  assert.equal(scheduled.length, 0);
});

test('notice timeout does not erase a newer notice', () => {
  const { state, scheduled, actions } = createHarness();
  actions.showNotice('Primera operación');
  actions.showNotice('Segunda operación');

  scheduled[0].callback();
  assert.equal(state.notice, 'Segunda operación');
  scheduled[1].callback();
  assert.equal(state.notice, '');
});

test('showError clears a previous notice', () => {
  const { state, actions } = createHarness();
  actions.showNotice('Todo correcto');
  actions.showError('Falló la operación');

  assert.equal(state.error, 'Falló la operación');
  assert.equal(state.notice, '');
});
