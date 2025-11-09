import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

if ('serviceWorker' in navigator) {
  const swUrl = new URL('./offline/serviceWorker.ts', import.meta.url);
  const registerServiceWorker = async () => {
    try {
      const registration = await navigator.serviceWorker.register(swUrl, { type: 'module' });
      const logStateChange = (worker: ServiceWorker | null) => {
        if (!worker) {
          return;
        }
        worker.addEventListener('statechange', () => {
          if (worker.state === 'installed' && navigator.serviceWorker.controller) {
            console.info('[service-worker] update installed');
          }
          if (worker.state === 'redundant') {
            console.warn('[service-worker] worker became redundant');
          }
        });
      };
      logStateChange(registration.installing ?? null);
      registration.addEventListener('updatefound', () => {
        logStateChange(registration.installing ?? null);
      });
    } catch (error) {
      console.error('Failed to register service worker', error);
    }
  };
  void registerServiceWorker();

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    console.info('[service-worker] controller changed');
  });
}
