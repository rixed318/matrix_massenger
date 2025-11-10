/* eslint-disable no-restricted-globals */
// src/offline/serviceWorker.ts

declare const self: ServiceWorkerGlobalScope;

const CACHE_NAME = 'econix-media-cache-v1';
const MAX_MEDIA_ITEMS = 50;
const MAX_TOTAL_BYTES = 100 * 1024 * 1024; // 100 MB
const TIMESTAMP_HEADER = 'X-Cache-Timestamp';
const SIZE_HEADER = 'X-Cache-Size';

let latestPushSubscription: any = null;
let roomNotificationPreferences: Record<string, 'all' | 'mentions' | 'mute'> = {};

interface CleanupLimits {
  maxItems?: number;
  maxBytes?: number;
}

interface CacheEntryMetadata {
  timestamp: number;
  size: number;
}

interface PreparedCacheEntry {
  response: Response;
  metadata: CacheEntryMetadata;
}

const parseHeaderNumber = (value: string | null): number | null => {
  if (typeof value !== 'string') return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
};

const readMetadataFromResponse = (response: Response): CacheEntryMetadata | null => {
  const timestamp = parseHeaderNumber(response.headers.get(TIMESTAMP_HEADER));
  const size = parseHeaderNumber(response.headers.get(SIZE_HEADER));
  if (timestamp === null || size === null) {
    return null;
  }
  return { timestamp, size };
};

const openCacheSafe = async (): Promise<Cache | null> => {
  try {
    return await caches.open(CACHE_NAME);
  } catch (error) {
    console.warn('Failed to open media cache', error);
    return null;
  }
};

export const prepareCacheEntry = async (response: Response): Promise<PreparedCacheEntry | null> => {
  try {
    const headers = new Headers(response.headers);
    const timestamp = Date.now();
    let size = parseHeaderNumber(headers.get('content-length')) ?? null;
    const bodyBuffer = await response.arrayBuffer();
    if (size === null || size !== bodyBuffer.byteLength) {
      size = bodyBuffer.byteLength;
    }
    headers.set(TIMESTAMP_HEADER, timestamp.toString());
    headers.set(SIZE_HEADER, size.toString());
    headers.set('Content-Length', bodyBuffer.byteLength.toString());
    const cacheResponse = new Response(bodyBuffer, {
      headers,
      status: response.status,
      statusText: response.statusText,
    });
    return {
      response: cacheResponse,
      metadata: { timestamp, size }
    };
  } catch (error) {
    console.warn('Failed to prepare cache entry', error);
    return null;
  }
};

export const cleanupCache = async (cache: Cache, limits: CleanupLimits = {}): Promise<void> => {
  const maxItems = limits.maxItems ?? MAX_MEDIA_ITEMS;
  const maxBytes = limits.maxBytes ?? MAX_TOTAL_BYTES;
  try {
    const requests = await cache.keys();
    const entries: Array<{ request: Request; metadata: CacheEntryMetadata }> = [];

    for (const request of requests) {
      const response = await cache.match(request);
      if (!response) {
        await cache.delete(request).catch(() => undefined);
        continue;
      }
      const metadata = readMetadataFromResponse(response);
      if (!metadata) {
        await cache.delete(request).catch(() => undefined);
        continue;
      }
      entries.push({ request, metadata });
    }

    entries.sort((a, b) => a.metadata.timestamp - b.metadata.timestamp);
    let totalBytes = entries.reduce((sum, entry) => sum + entry.metadata.size, 0);

    const removeEntry = async (entry: { request: Request; metadata: CacheEntryMetadata }) => {
      const deleted = await cache.delete(entry.request);
      if (deleted) {
        totalBytes -= entry.metadata.size;
      }
    };

    while (entries.length > maxItems || totalBytes > maxBytes) {
      let entryToRemove: { request: Request; metadata: CacheEntryMetadata } | undefined;
      if (entries.length > maxItems) {
        entryToRemove = entries.shift();
      } else {
        entryToRemove = entries.reduce((largest, entry) => {
          return entry.metadata.size > largest.metadata.size ? entry : largest;
        }, entries[0]);
        entries.splice(entries.indexOf(entryToRemove), 1);
      }
      if (!entryToRemove) {
        break;
      }
      await removeEntry(entryToRemove);
    }
  } catch (error) {
    console.warn('Failed to cleanup cache', error);
  }
};

const handleActivateEvent = async (): Promise<void> => {
  try {
    const keys = await caches.keys();
    await Promise.all(
      keys.filter(name => name !== CACHE_NAME).map(name => caches.delete(name))
    );
    const cache = await openCacheSafe();
    if (cache) {
      await cleanupCache(cache);
    }
  } catch (error) {
    console.warn('Failed to complete activate handler', error);
  } finally {
    try {
      await self.clients.claim();
    } catch (claimError) {
      console.warn('Failed to claim clients during activate', claimError);
    }
  }
};

const shouldHandleRequest = (url: URL): boolean => url.pathname.includes('/_matrix/media/');

export const handleMediaRequest = async (
  request: Request,
  options: { cache?: Cache; limits?: CleanupLimits } = {}
): Promise<Response> => {
  const cache = options.cache ?? (await openCacheSafe());
  const limits = options.limits;

  if (!cache) {
    return fetch(request);
  }

  try {
    const networkResponse = await fetch(request);

    if (!networkResponse || !networkResponse.ok) {
      const cached = await cache.match(request);
      if (cached) {
        return cached;
      }
      return networkResponse;
    }

    const prepared = await prepareCacheEntry(networkResponse.clone());
    if (prepared) {
      try {
        await cache.put(request, prepared.response);
        await cleanupCache(cache, limits);
      } catch (error) {
        console.warn('Failed to cache media response', error);
      }
    }

    return networkResponse;
  } catch (error) {
    const cached = await cache.match(request);
    if (cached) {
      return cached;
    }
    throw error;
  }
};

self.addEventListener('install', (event: any) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event: any) => {
  event.waitUntil(handleActivateEvent());
});

// Cache Matrix media responses (/_matrix/media/)
self.addEventListener('fetch', (event: any) => {
  if (event.request.method !== 'GET') {
    return;
  }
  const url = new URL(event.request.url);
  if (!shouldHandleRequest(url)) {
    return;
  }
  event.respondWith(handleMediaRequest(event.request));
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

self.addEventListener('message', (event: any) => {
  if (!event?.data || typeof event.data !== 'object') {
    return;
  }
  if (event.data.type === 'PUSH_SUBSCRIPTION_UPDATED') {
    latestPushSubscription = event.data.subscription ?? null;
    const registerSync = async () => {
      try {
        await self.registration?.sync?.register?.('matrix-outbox-flush');
      } catch (error) {
        console.debug('Failed to register background sync after subscription update', error);
      }
    };
    if (typeof event.waitUntil === 'function') {
      event.waitUntil(registerSync());
    } else {
      void registerSync();
    }
    return;
  }
  if (event.data.type === 'ROOM_NOTIFICATION_PREFERENCES') {
    roomNotificationPreferences = { ...(event.data.preferences || {}) };
  }
});

// Push notifications
self.addEventListener('push', (event: any) => {
  let data: any = {};
  try { data = event.data ? event.data.json() : {}; } catch {}
  const options: any = {
    body: data.body || '',
    icon: data.icon || '/icon-192.png',
    tag: data.tag || 'econix-msg',
    data: { ...(data.data || {}) }
  };
  const eventType = options.data?.type ?? data.type;
  const isStory = eventType === 'story';
  const authorLabel = options.data?.authorDisplayName ?? data.authorDisplayName ?? data.author;
  let title = data.title || (isStory ? (authorLabel ? `${authorLabel} обновил(а) сторис` : 'Новая сторис') : 'New message');
  let body = data.body || options.body || (isStory ? 'Откройте, чтобы посмотреть историю.' : '');
  if (isStory) {
    const storyId = options.data?.storyId ?? data.storyId ?? `story-${Date.now()}`;
    options.tag = data.tag || `econix-story-${storyId}`;
    options.data = {
      ...options.data,
      type: 'story',
      storyId,
      authorId: options.data?.authorId ?? data.authorId,
      url: options.data?.url || data.url || `/?story=${encodeURIComponent(storyId)}`,
    };
  }
  const roomId = isStory ? undefined : (options.data?.roomId || data.roomId);
  const isMention = Boolean(options.data?.isMention ?? data.isMention ?? data.highlight);
  if (roomId) {
    const preference = roomNotificationPreferences[roomId];
    if (preference === 'mute') {
      return;
    }
    if (preference === 'mentions' && !isMention) {
      return;
    }
  }
  if (latestPushSubscription && typeof options.data === 'object' && options.data) {
    options.data.subscription = options.data.subscription || latestPushSubscription;
  }
  options.body = body;
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

export const __SERVICE_WORKER_TESTING__ = {
  CACHE_NAME,
  MAX_MEDIA_ITEMS,
  MAX_TOTAL_BYTES,
  TIMESTAMP_HEADER,
  SIZE_HEADER,
  prepareCacheEntry,
  cleanupCache,
  handleMediaRequest,
};

// Helper to register from app:
// if ('serviceWorker' in navigator) {
//   navigator.serviceWorker.register('/service-worker.js');
//   navigator.serviceWorker.ready.then(reg => {
//     // later: reg.sync.register('matrix-outbox-flush');
//   });
// }
