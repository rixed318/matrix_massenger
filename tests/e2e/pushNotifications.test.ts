import { beforeEach, describe, expect, it, vi } from 'vitest';
import { registerMatrixWebPush } from '../../src/services/pushService';
import { getAccountStore, createAccountKey } from '../../src/services/accountManager';
import type { MatrixClient } from '../../src/types';

const bufferFrom = (values: number[]): ArrayBuffer => Uint8Array.from(values).buffer;

describe('web push integration', () => {
  beforeEach(() => {
    const store = getAccountStore();
    store.setState(state => ({
      ...state,
      accounts: {},
      activeKey: null,
    }));
  });

  it('registers Matrix pusher and persists subscription data', async () => {
    const clientMock = {
      setPusher: vi.fn().mockResolvedValue(undefined),
      enablePushNotifications: vi.fn().mockResolvedValue(undefined),
    } as unknown as MatrixClient;

    const account = {
      homeserver_url: 'https://matrix.example.org',
      user_id: '@user:example.org',
      access_token: 'token',
      key: createAccountKey({
        homeserver_url: 'https://matrix.example.org',
        user_id: '@user:example.org',
        access_token: 'token',
      }),
    };

    const store = getAccountStore();
    store.setState(state => ({
      ...state,
      accounts: {
        ...state.accounts,
        [account.key]: {
          creds: account,
          client: clientMock,
          savedMessagesRoomId: null,
          unread: 0,
        },
      },
      activeKey: account.key,
    }));

    const registration = {
      active: { postMessage: vi.fn() },
      sync: { register: vi.fn().mockResolvedValue(undefined) },
    } as unknown as ServiceWorkerRegistration;

    const subscription = {
      endpoint: 'https://push.example.org/sub',
      expirationTime: null,
      getKey: vi.fn((name: string) => {
        if (name === 'auth') {
          return bufferFrom([1, 2, 3, 4]);
        }
        if (name === 'p256dh') {
          return bufferFrom([5, 6, 7, 8]);
        }
        return null;
      }),
    } as unknown as PushSubscription;

    const result = await registerMatrixWebPush(clientMock, registration, subscription, {
      accountKey: account.key,
      pushGatewayUrl: 'https://push-gateway.example.org',
    });

    expect(clientMock.setPusher).toHaveBeenCalledWith(expect.objectContaining({
      pushkey: subscription.endpoint,
      data: expect.objectContaining({ endpoint: subscription.endpoint }),
    }));
    expect(clientMock.enablePushNotifications).toHaveBeenCalled();
    expect((registration.active as any).postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'PUSH_SUBSCRIPTION_UPDATED',
      subscription: expect.objectContaining({ endpoint: subscription.endpoint }),
    }));
    expect(registration.sync.register).toHaveBeenCalledWith('matrix-outbox-flush');

    const updated = store.getState().accounts[account.key]?.creds.push_subscription;
    expect(updated).toBeTruthy();
    expect(updated).toMatchObject({
      endpoint: subscription.endpoint,
      push_key: subscription.endpoint,
      auth: expect.any(String),
      p256dh: expect.any(String),
    });
    expect(result).toMatchObject({ endpoint: subscription.endpoint, push_key: subscription.endpoint });
  });
});

describe('service worker push handling', () => {
  const listeners: Record<string, Array<(event: any) => void>> = {};
  let registrationMock: any;

  beforeEach(async () => {
    vi.resetModules();
    listeners.install = [];
    listeners.activate = [];
    listeners.fetch = [];
    listeners.push = [];
    listeners.message = [];
    listeners.sync = [];

    registrationMock = {
      showNotification: vi.fn().mockResolvedValue(undefined),
      sync: { register: vi.fn().mockResolvedValue(undefined) },
    };

    const cachesMock = {
      open: vi.fn().mockResolvedValue({
        put: vi.fn().mockResolvedValue(undefined),
        match: vi.fn().mockResolvedValue(undefined),
      }),
    };

    (globalThis as any).caches = cachesMock;

    (globalThis as any).self = {
      addEventListener: (type: string, listener: (event: any) => void) => {
        listeners[type] = listeners[type] || [];
        listeners[type].push(listener);
      },
      clients: {
        matchAll: vi.fn().mockResolvedValue([]),
        claim: vi.fn().mockResolvedValue(undefined),
        openWindow: vi.fn(),
      },
      registration: registrationMock,
      skipWaiting: vi.fn().mockResolvedValue(undefined),
    };

    await import('../../src/offline/serviceWorker');
  });

  it('updates sync registration on subscription update and shows push notification', async () => {
    const waiters: Promise<unknown>[] = [];

    const messageEvent = {
      data: { type: 'PUSH_SUBSCRIPTION_UPDATED', subscription: { endpoint: 'https://push.example' } },
      waitUntil: (promise: Promise<unknown>) => {
        waiters.push(promise);
      },
    };

    listeners.message.forEach(handler => handler(messageEvent));
    await Promise.all(waiters);
    expect(registrationMock.sync.register).toHaveBeenCalledWith('matrix-outbox-flush');

    const pushWaiters: Promise<unknown>[] = [];
    const pushEvent = {
      data: { json: () => ({ title: 'Hello', body: 'World', data: { url: '/room' } }) },
      waitUntil: (promise: Promise<unknown>) => {
        pushWaiters.push(promise);
      },
    };

    listeners.push.forEach(handler => handler(pushEvent));
    await Promise.all(pushWaiters);
    expect(registrationMock.showNotification).toHaveBeenCalledWith('Hello', expect.objectContaining({ body: 'World' }));
  });
});
