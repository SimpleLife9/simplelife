import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './styles.css';

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  // If an already-installed PWA receives a newer worker while this document
  // is open, reload once under the new controller. Fresh installs already
  // fetched the current hashed bundle and do not need an extra reload.
  const controllerAtStartup = navigator.serviceWorker.controller;
  if (controllerAtStartup) {
    let reloadingForControllerChange = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloadingForControllerChange) return;
      reloadingForControllerChange = true;
      window.location.reload();
    });
  }

  // Register immediately instead of waiting for window.load. Then explicitly
  // check the script on every app launch: browsers may otherwise throttle
  // automatic update checks for an installed PWA.
  window.__SIMPLELIFE_SW_REGISTRATION__ = navigator.serviceWorker
    .register('/sw.js', { updateViaCache: 'none' })
    .then(async (registration) => {
      try {
        await registration.update();
      } catch (error) {
        // Offline launches must remain usable even when an update check fails.
        console.info('Service Worker update check deferred:', error);
      }
      return registration;
    })
    .catch((error) => {
      console.warn('Service worker registration failed:', error);
      return null;
    });
}

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
