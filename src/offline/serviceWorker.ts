
/* eslint-disable no-restricted-globals */
// src/offline/serviceWorker.ts
const CACHE_NAME = 'econix-media-cache-v1';

self.addEventListener('install', (event: any) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event: any) => {
  event.waitUntil(self.clients.claim());
});

// Cache Matrix media responses (/_matrix/media/)
self.addEventListener('fetch', (event: any) => {
  const url = new URL(event.request.url);
  if (url.pathname.includes('/_matrix/media/')) {
    event.respondWith(
      caches.open(CACHE_NAME).then(cache =>
        fetch(event.request).then(resp => {
          cache.put(event.request, resp.clone());
          return resp;
        }).catch(() => cache.match(event.request))
      )
    );
  }
});

// Background sync: trigger outbox flush in clients
self.addEventListener('sync', (event: any) => {
  if (event.tag === 'matrix-outbox-flush') {
    event.waitUntil(
      self.clients.matchAll({ includeUncontrolled: true, type: 'window' }).then((clients: any) => {
        clients.forEach((c: any) => c.postMessage({ type: 'OUTBOX_FLUSH' }));
      })
    );
  }
});

// Push notifications
self.addEventListener('push', (event: any) => {
  let data: any = {};
  try { data = event.data ? event.data.json() : {}; } catch {}
  const title = data.title || 'New message';
  const options: any = {
    body: data.body || '',
    icon: data.icon || '/icon-192.png',
    tag: data.tag || 'econix-msg',
    data: data.data || {}
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event: any) => {
  event.notification.close();
  const target = event.notification.data?.url || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList: any) => {
      for (const client of clientList) {
        if ('focus' in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(target);
    })
  );
});

// Helper to register from app:
// if ('serviceWorker' in navigator) {
//   navigator.serviceWorker.register('/service-worker.js');
//   navigator.serviceWorker.ready.then(reg => {
//     // later: reg.sync.register('matrix-outbox-flush');
//   });
// }
