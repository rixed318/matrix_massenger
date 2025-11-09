import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

interface CacheRecord {
  request: Request;
  response: Response;
}

const createFakeCache = () => {
  const store = new Map<string, CacheRecord>();
  const requestToKey = (request: RequestInfo | URL): string => {
    if (typeof request === 'string') return request;
    if (request instanceof Request) return request.url;
    return String(request);
  };

  const cache: Cache = {
    match: vi.fn(async (request: RequestInfo | URL) => {
      const record = store.get(requestToKey(request));
      return record ? record.response.clone() : undefined;
    }),
    matchAll: vi.fn(async () => []),
    put: vi.fn(async (request: RequestInfo, response: Response) => {
      const key = requestToKey(request);
      const cachedRequest = request instanceof Request ? request.clone() : new Request(String(request));
      store.set(key, { request: cachedRequest, response: response.clone() });
    }),
    delete: vi.fn(async (request: RequestInfo | URL) => {
      const key = requestToKey(request);
      return store.delete(key);
    }),
    keys: vi.fn(async () => Array.from(store.values()).map(record => record.request.clone())),
    add: vi.fn(async () => undefined),
    addAll: vi.fn(async () => undefined),
  };

  return { cache, store };
};

describe('offline service worker media cache', () => {
  const globalAny = globalThis as any;
  let serviceWorkerModule: typeof import('../../src/offline/serviceWorker');

  beforeEach(async () => {
    vi.resetModules();

    globalAny.fetch = vi.fn();
    globalAny.caches = {
      open: vi.fn(),
      keys: vi.fn(),
      delete: vi.fn(),
    } satisfies Partial<CacheStorage>;

    globalAny.self = {
      addEventListener: vi.fn(),
      skipWaiting: vi.fn(),
      clients: {
        claim: vi.fn(),
        matchAll: vi.fn().mockResolvedValue([]),
        openWindow: vi.fn(),
      },
      registration: {
        sync: { register: vi.fn() },
        showNotification: vi.fn(),
      },
    };

    serviceWorkerModule = await import('../../src/offline/serviceWorker');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete globalAny.self;
    delete globalAny.caches;
    delete globalAny.fetch;
  });

  it('stores metadata and evicts oldest entries when limits are exceeded', async () => {
    const { cache, store } = createFakeCache();
    const { handleMediaRequest, __SERVICE_WORKER_TESTING__ } = serviceWorkerModule;
    const limits = { maxItems: 2, maxBytes: 1024 };

    let currentTime = 0;
    vi.spyOn(Date, 'now').mockImplementation(() => {
      currentTime += 1000;
      return currentTime;
    });

    (globalAny.fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(new Response('first', { status: 200, headers: { 'content-type': 'text/plain' } }))
      .mockResolvedValueOnce(new Response('second', { status: 200, headers: { 'content-type': 'text/plain' } }))
      .mockResolvedValueOnce(new Response('third', { status: 200, headers: { 'content-type': 'text/plain' } }));

    await handleMediaRequest(new Request('https://example.com/_matrix/media/one'), { cache, limits });
    await handleMediaRequest(new Request('https://example.com/_matrix/media/two'), { cache, limits });
    await handleMediaRequest(new Request('https://example.com/_matrix/media/three'), { cache, limits });

    expect(store.size).toBe(2);
    const urls = Array.from(store.keys()).sort();
    expect(urls).toEqual([
      'https://example.com/_matrix/media/three',
      'https://example.com/_matrix/media/two',
    ]);

    for (const record of store.values()) {
      expect(record.response.headers.get(__SERVICE_WORKER_TESTING__.TIMESTAMP_HEADER)).toBeTruthy();
      expect(record.response.headers.get(__SERVICE_WORKER_TESTING__.SIZE_HEADER)).toBeTruthy();
    }
  });

  it('removes largest entries when byte limits are exceeded', async () => {
    const { cache, store } = createFakeCache();
    const { prepareCacheEntry, cleanupCache, __SERVICE_WORKER_TESTING__ } = serviceWorkerModule;

    let currentTime = 0;
    vi.spyOn(Date, 'now').mockImplementation(() => {
      currentTime += 1000;
      return currentTime;
    });

    const small = await prepareCacheEntry(new Response('aa', { status: 200, headers: { 'content-type': 'text/plain' } }));
    const medium = await prepareCacheEntry(new Response('bbbb', { status: 200, headers: { 'content-type': 'text/plain' } }));
    const large = await prepareCacheEntry(new Response('cccccccc', { status: 200, headers: { 'content-type': 'text/plain' } }));

    if (!small || !medium || !large) {
      throw new Error('Failed to prepare responses');
    }

    await cache.put(new Request('https://example.com/_matrix/media/small'), small.response);
    await cache.put(new Request('https://example.com/_matrix/media/medium'), medium.response);
    await cache.put(new Request('https://example.com/_matrix/media/large'), large.response);

    await cleanupCache(cache, { maxItems: 5, maxBytes: 6 });

    expect(store.size).toBe(2);
    const remaining = Array.from(store.keys()).sort();
    expect(remaining).toEqual([
      'https://example.com/_matrix/media/medium',
      'https://example.com/_matrix/media/small',
    ]);

    for (const record of store.values()) {
      const sizeHeader = record.response.headers.get(__SERVICE_WORKER_TESTING__.SIZE_HEADER);
      expect(sizeHeader).toBeTruthy();
      expect(Number(sizeHeader)).toBeLessThanOrEqual(4);
    }
  });

  it('falls back to cached response when network request fails', async () => {
    const { cache } = createFakeCache();
    const { handleMediaRequest, prepareCacheEntry } = serviceWorkerModule;
    const request = new Request('https://example.com/_matrix/media/resource');

    vi.spyOn(Date, 'now').mockReturnValue(123456);
    const prepared = await prepareCacheEntry(
      new Response('cached-body', { status: 200, headers: { 'content-type': 'text/plain' } })
    );
    if (!prepared) {
      throw new Error('Failed to prepare cached response');
    }
    await cache.put(request, prepared.response);

    (globalAny.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('offline'));

    const response = await handleMediaRequest(request, { cache });
    expect(await response.text()).toBe('cached-body');
  });
});
