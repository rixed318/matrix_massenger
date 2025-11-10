/// <reference lib="webworker" />

import '../offline/serviceWorker';

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST?: Array<{ url: string }>;
};

const STATIC_CACHE_NAME = 'econix-static-v1';
const RUNTIME_CACHE_NAME = 'econix-runtime-v1';
const OUTBOX_SYNC_TAG = 'matrix-outbox-flush';

const CORE_ASSETS = Array.from(
  new Set(
    [
      '/',
      '/index.html',
      '/manifest.webmanifest',
      ...(self.__WB_MANIFEST?.map(entry => entry.url) ?? []),
    ].filter(Boolean),
  ),
);

let hasPendingOutbox = false;

const openCacheSafely = async (name: string): Promise<Cache | null> => {
  try {
    return await caches.open(name);
  } catch (error) {
    console.debug('[pwa-sw] failed to open cache', name, error);
    return null;
  }
};

const precacheCoreAssets = async (): Promise<void> => {
  const cache = await openCacheSafely(STATIC_CACHE_NAME);
  if (!cache) return;
  try {
    await cache.addAll(CORE_ASSETS);
  } catch (error) {
    console.debug('[pwa-sw] failed to precache assets', error);
  }
};

const cleanupLegacyCaches = async (): Promise<void> => {
  try {
    const cacheNames = await caches.keys();
    await Promise.all(
      cacheNames
        .filter(name => name !== STATIC_CACHE_NAME && name !== RUNTIME_CACHE_NAME)
        .map(name => caches.delete(name)),
    );
  } catch (error) {
    console.debug('[pwa-sw] failed to cleanup caches', error);
  }
};

const staticAssetDestinations = new Set<RequestDestination>([
  'style',
  'script',
  'font',
  'image',
  'worker',
  'manifest',
]);

const STATIC_ASSET_PATTERN = /\.(?:css|js|mjs|cjs|ts|tsx|jsx|woff2?|ttf|otf|png|webp|jpe?g|gif|svg|ico|json|txt)$/i;

const isStaticAssetRequest = (request: Request, url: URL): boolean => {
  if (staticAssetDestinations.has(request.destination)) {
    return true;
  }
  if (STATIC_ASSET_PATTERN.test(url.pathname)) {
    return true;
  }
  if (url.pathname.startsWith('/assets/')) {
    return true;
  }
  return false;
};

const fetchAndCacheRuntimeAsset = async (request: Request): Promise<Response> => {
  const cache = await openCacheSafely(RUNTIME_CACHE_NAME);
  const networkFetch = async () => {
    const response = await fetch(request);
    if (cache && response && response.ok) {
      try {
        await cache.put(request, response.clone());
      } catch (error) {
        console.debug('[pwa-sw] failed to populate runtime cache', error);
      }
    }
    return response;
  };

  if (!cache) {
    return networkFetch();
  }

  const cached = await cache.match(request);
  if (cached) {
    void networkFetch().catch(() => undefined);
    return cached;
  }
  return networkFetch();
};

const handleNavigationRequest = async (request: Request): Promise<Response> => {
  try {
    return await fetch(request);
  } catch (error) {
    const cache = await openCacheSafely(STATIC_CACHE_NAME);
    if (!cache) throw error;
    const fallback = (await cache.match('/index.html')) ?? (await cache.match('/'));
    if (fallback) {
      return fallback;
    }
    throw error;
  }
};

const registerOutboxSync = async (): Promise<void> => {
  try {
    await self.registration?.sync?.register?.(OUTBOX_SYNC_TAG);
  } catch (error) {
    console.debug('[pwa-sw] failed to register background sync', error);
  }
};

const notifyClientsToFlushOutbox = async (): Promise<void> => {
  try {
    const clients = await self.clients.matchAll({ includeUncontrolled: true, type: 'window' });
    clients.forEach(client => {
      try {
        client.postMessage({ type: 'OUTBOX_FLUSH' });
      } catch (error) {
        console.debug('[pwa-sw] failed to notify client', error);
      }
    });
  } catch (error) {
    console.debug('[pwa-sw] failed to broadcast outbox flush', error);
  }
};

self.addEventListener('install', event => {
  event.waitUntil(
    (async () => {
      await precacheCoreAssets();
      if (typeof self.skipWaiting === 'function') {
        try {
          await self.skipWaiting();
        } catch (error) {
          console.debug('[pwa-sw] failed to skip waiting', error);
        }
      }
    })(),
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    (async () => {
      await cleanupLegacyCaches();
      try {
        await self.clients.claim();
      } catch (error) {
        console.debug('[pwa-sw] failed to claim clients', error);
      }
    })(),
  );
});

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') {
    return;
  }

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) {
    return;
  }
  if (url.pathname.startsWith('/_matrix/media/')) {
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(handleNavigationRequest(request));
    return;
  }

  if (isStaticAssetRequest(request, url)) {
    event.respondWith(fetchAndCacheRuntimeAsset(request));
  }
});

self.addEventListener('message', event => {
  const data = event?.data;
  if (!data || typeof data !== 'object') {
    return;
  }
  if (data.type === 'OUTBOX_PENDING') {
    hasPendingOutbox = true;
    const promise = registerOutboxSync();
    if (typeof event.waitUntil === 'function') {
      event.waitUntil(promise);
    }
    return;
  }
  if (data.type === 'OUTBOX_IDLE') {
    hasPendingOutbox = false;
    return;
  }
});

self.addEventListener('sync', event => {
  if (event.tag !== OUTBOX_SYNC_TAG) {
    return;
  }
  event.waitUntil(
    (async () => {
      if (!hasPendingOutbox) {
        await notifyClientsToFlushOutbox();
        return;
      }
      await notifyClientsToFlushOutbox();
      if (hasPendingOutbox) {
        await registerOutboxSync();
      }
    })(),
  );
});

export const __PWA_SERVICE_WORKER_TESTING__ = {
  STATIC_CACHE_NAME,
  RUNTIME_CACHE_NAME,
  OUTBOX_SYNC_TAG,
  CORE_ASSETS,
  hasPendingOutbox: () => hasPendingOutbox,
  isStaticAssetRequest,
  fetchAndCacheRuntimeAsset,
};
