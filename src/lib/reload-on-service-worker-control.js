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

    // A first controller can claim a document that came from an older HTTP
    // cache entry before this tab had a Service Worker controller. Reload once
    // after the new worker takes control so the page uses the current app shell.
    reloaded = true;
    location.reload();
  };

  serviceWorker.addEventListener('controllerchange', onControllerChange);
  return () => serviceWorker.removeEventListener?.('controllerchange', onControllerChange);
};
