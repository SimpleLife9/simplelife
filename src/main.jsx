import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './styles.css';

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  // Register immediately instead of waiting for window.load. The worker
  // installs the complete offline shell while React starts normally.
  window.__SIMPLELIFE_SW_REGISTRATION__ = navigator.serviceWorker
    .register('/sw.js', { updateViaCache: 'none' })
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
