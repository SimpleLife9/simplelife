export function reloadOnServiceWorkerControllerChange(serviceWorker, location) {
  if (typeof serviceWorker?.addEventListener !== 'function'
    || typeof location?.reload !== 'function') {
    return () => {};
  }

  const initialController = serviceWorker.controller ?? null;
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
