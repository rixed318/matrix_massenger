import { describe, beforeEach, afterEach, it, expect, vi } from 'vitest';
import { webcrypto as nodeWebcrypto } from 'crypto';
import {
  enableAppLock,
  disableAppLock,
  enableTravelMode,
  getTravelModeSnapshot,
  unlockWithPin,
  ensureAppLockConsistency,
} from '../../src/services/appLockService';

declare global {
  // eslint-disable-next-line no-var
  var window: any;
  // eslint-disable-next-line no-var
  var sessionStorage: Storage;
}

const storageImpl = () => {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => {
      store.clear();
    },
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    get length() {
      return store.size;
    },
  } as Storage;
};

describe('appLockService travel mode', () => {
  const originalWindow = global.window;
  const originalSessionStorage = global.sessionStorage;
  const originalCrypto = global.crypto;
  const storage = new Map<string, string>();
  const invokeMock = vi.fn(async (command: string, args: any) => {
    if (!command.startsWith('plugin:secure-storage|')) {
      throw new Error(`Unsupported command ${command}`);
    }
    const action = command.split('|')[1];
    switch (action) {
      case 'set':
        storage.set(args.key, args.value);
        return null;
      case 'get':
        return storage.get(args.key) ?? null;
      case 'delete':
        storage.delete(args.key);
        return null;
      default:
        throw new Error(`Unsupported action ${action}`);
    }
  });

  beforeEach(() => {
    storage.clear();
    global.window = {
      __TAURI__: {
        invoke: invokeMock,
      },
    } as any;
    global.sessionStorage = storageImpl();
    const webcrypto = (globalThis as any).crypto?.subtle ? globalThis.crypto : nodeWebcrypto;
    Object.defineProperty(global, 'crypto', {
      value: webcrypto,
      configurable: true,
    });
  });

  afterEach(async () => {
    await disableAppLock().catch(() => undefined);
    storage.clear();
    if (originalWindow) {
      global.window = originalWindow;
    } else {
      delete (global as any).window;
    }
    if (originalSessionStorage) {
      global.sessionStorage = originalSessionStorage;
    } else {
      delete (global as any).sessionStorage;
    }
    if (originalCrypto) {
      Object.defineProperty(global, 'crypto', {
        value: originalCrypto,
        configurable: true,
      });
    } else {
      delete (global as any).crypto;
    }
    invokeMock.mockClear();
  });

  it('creates temporary PIN windows on repeated unlock', async () => {
    await enableAppLock('1234', false);
    await ensureAppLockConsistency();
    await enableTravelMode({ autoDeactivateTimeoutMs: 60_000 });

    let snapshot = await getTravelModeSnapshot();
    expect(snapshot.enabled).toBe(true);
    expect(snapshot.temporaryPinWindows).toHaveLength(0);

    await unlockWithPin('1234');
    snapshot = await getTravelModeSnapshot();
    expect(snapshot.temporaryPinWindows).toHaveLength(1);
    const firstWindow = snapshot.temporaryPinWindows[0];

    await unlockWithPin('1234');
    snapshot = await getTravelModeSnapshot();
    expect(snapshot.temporaryPinWindows).toHaveLength(2);
    const secondWindow = snapshot.temporaryPinWindows[1];

    expect(secondWindow.start).toBeGreaterThanOrEqual(firstWindow.start);
    expect(secondWindow.expiresAt).toBeGreaterThan(firstWindow.start);
  });
});
