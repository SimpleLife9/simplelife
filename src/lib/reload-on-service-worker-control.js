export function reloadOnServiceWorkerControllerChange(serviceWorker, location) {
  if (typeof serviceWorker?.addEventListener !== 'function'
    || typeof location?.reload !== 'function') {
    return () => {};
  }

  const initialController = serviceWorker.controller ?? null;
  // A first-time visit has no old controlling worker; its document was loaded
  // directly from the network. Only an already-controlled tab can be running
  // an obsolete worker-cached bundle that needs to be replaced.
  if (!initialController) return () => {};

  let reloaded = false;
  const onControllerChange = () => {
    const nextController = serviceWorker.controller ?? null;
    if (!nextController || nextController === initialController || reloaded) return;
    reloaded = true;
    location.reload();
  };

  serviceWorker.addEventListener('controllerchange', onControllerChange);
  return () => serviceWorker.removeEventListener?.('controllerchange', onControllerChange);
};
