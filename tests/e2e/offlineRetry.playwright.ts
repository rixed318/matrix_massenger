import { test, expect } from '@playwright/test';

const createFakeCache = () => {
  const store = new Map<string, Response>();
  return {
    cache: {
      match: async (request: RequestInfo | URL) => {
        const key = typeof request === 'string' ? request : request instanceof Request ? request.url : String(request);
        const response = store.get(key);
        return response ? response.clone() : undefined;
      },
      put: async (request: RequestInfo | URL, response: Response) => {
        const key = typeof request === 'string' ? request : request instanceof Request ? request.url : String(request);
        store.set(key, response.clone());
      },
      addAll: async () => undefined,
    } as unknown as Cache,
  };
};

test.describe('pwa service worker (playwright)', () => {
  test('restores connectivity and requests outbox flush on sync', async () => {
    const listeners = new Map<string, Array<(event: any) => void>>();
    const staticCache = createFakeCache();
    const runtimeCache = createFakeCache();
    const postedMessages: any[] = [];

    (globalThis as any).fetch = async () => new Response('ok');
    (globalThis as any).caches = {
      open: async (name: string) => {
        if (name === 'econix-static-v1') return staticCache.cache;
        if (name === 'econix-runtime-v1') return runtimeCache.cache;
        return runtimeCache.cache;
      },
      keys: async () => [],
      delete: async () => true,
    } as Partial<CacheStorage>;

    (globalThis as any).self = {
      addEventListener: (type: string, handler: (event: any) => void) => {
        const arr = listeners.get(type) ?? [];
        arr.push(handler);
        listeners.set(type, arr);
      },
      skipWaiting: async () => undefined,
      clients: {
        matchAll: async () => [{ postMessage: (msg: any) => postedMessages.push(msg) }],
        claim: async () => undefined,
      },
      registration: {
        sync: { register: async () => undefined },
      },
      location: { origin: 'https://app.example' },
    } as any;

    await import('../../src/pwa/service-worker');

    const messageHandlers = listeners.get('message') ?? [];
    const syncHandlers = listeners.get('sync') ?? [];

    expect(messageHandlers.length).toBeGreaterThan(0);
    expect(syncHandlers.length).toBeGreaterThan(0);

    const waitUntil = async (promise: Promise<any>) => promise;
    await messageHandlers[messageHandlers.length - 1]({ data: { type: 'OUTBOX_PENDING' }, waitUntil });
    await syncHandlers[syncHandlers.length - 1]({ tag: 'matrix-outbox-flush', waitUntil });

    expect(postedMessages).toContainEqual({ type: 'OUTBOX_FLUSH' });

    delete (globalThis as any).self;
    delete (globalThis as any).caches;
    delete (globalThis as any).fetch;
  });
});
