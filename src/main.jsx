import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import { reloadOnServiceWorkerControllerChange } from './lib/reload-on-service-worker-control.js';
import './styles.css';

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  // Listen even when the page initially has no controller. A first-time
  // activation can otherwise claim this tab after React loaded the old shell.
  reloadOnServiceWorkerControllerChange(navigator.serviceWorker, window.location);

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
