import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createAccountStore, createAccountKey, StoredAccount } from '../../src/services/accountManager';
import type { MatrixClient } from '../../src/types';
import { createMatrixSession, createMatrixSessionFromExistingClient } from '../../src/services/matrixRuntime';
import { invoke } from '@tauri-apps/api/core';

vi.mock('../../src/services/matrixRuntime', () => ({
  createMatrixSession: vi.fn(),
  createMatrixSessionFromExistingClient: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

const matrixSessionMock = () => vi.mocked(createMatrixSession);
const matrixSessionFromClientMock = () => vi.mocked(createMatrixSessionFromExistingClient);
const invokeMock = () => vi.mocked(invoke);

const fakeClient = (baseUrl: string, userId: string, token: string): MatrixClient => ({
  getHomeserverUrl: vi.fn(() => baseUrl),
  getUserId: vi.fn(() => userId),
  getAccessToken: vi.fn(() => token),
  logout: vi.fn(async () => {}),
  stopClient: vi.fn(async () => {}),
} as unknown as MatrixClient);

beforeEach(() => {
  vi.clearAllMocks();
  const win = (globalThis as any).window ?? {};
  (win as any).__TAURI_INTERNALS__ = {};
  (globalThis as any).window = win;
});

afterEach(() => {
  if ((globalThis as any).window) {
    delete (globalThis as any).window.__TAURI_INTERNALS__;
  }
});

describe('accountManager store', () => {
  it('boots stored accounts when available', async () => {
    const store = createAccountStore();
    const stored: StoredAccount[] = [
      { key: 'https://hs/@user:hs', homeserver_url: 'https://hs', user_id: '@user:hs', access_token: 'token' },
    ];
    invokeMock().mockResolvedValueOnce(stored);

    matrixSessionMock().mockResolvedValue({
      client: fakeClient('https://hs', '@user:hs', 'token'),
      savedMessagesRoomId: '!saved:room',
      unread: 7,
      avatarUrl: 'avatar',
      displayName: 'Display',
      dispose: vi.fn(),
    });

    await store.getState().boot();
    const state = store.getState();

    expect(Object.keys(state.accounts)).toEqual(['https://hs/@user:hs']);
    expect(state.activeKey).toBe('https://hs/@user:hs');
    expect(state.accounts['https://hs/@user:hs'].unread).toBe(7);
    expect(state.isBooting).toBe(false);
    expect(state.error).toBeNull();
  });

  it('adds a new client session and persists credentials', async () => {
    const store = createAccountStore();
    const client = fakeClient('https://hs', '@user:hs', 'token');
    const dispose = vi.fn();

    matrixSessionFromClientMock().mockResolvedValue({
      client,
      savedMessagesRoomId: '!saved:room',
      unread: 0,
      avatarUrl: null,
      displayName: 'Display',
      dispose,
    });

    invokeMock().mockResolvedValue(undefined);

    await store.getState().addClientAccount(client);

    const state = store.getState();
    const key = createAccountKey({ homeserver_url: 'https://hs', user_id: '@user:hs', access_token: 'token' });

    expect(invoke).toHaveBeenCalledWith('save_credentials', {
      creds: { homeserver_url: 'https://hs', user_id: '@user:hs', access_token: 'token' },
    });
    expect(state.accounts[key]).toBeDefined();
    expect(state.activeKey).toBe(key);
    expect(state.isAddAccountOpen).toBe(false);
    expect(state.error).toBeNull();
  });

  it('removes an account and clears persisted credentials', async () => {
    const store = createAccountStore();
    const client = fakeClient('https://hs', '@user:hs', 'token');
    const dispose = vi.fn();

    matrixSessionFromClientMock().mockResolvedValue({
      client,
      savedMessagesRoomId: '!saved:room',
      unread: 0,
      avatarUrl: null,
      displayName: 'Display',
      dispose,
    });

    invokeMock().mockResolvedValue(undefined);

    await store.getState().addClientAccount(client);
    await store.getState().removeAccount();

    const key = createAccountKey({ homeserver_url: 'https://hs', user_id: '@user:hs', access_token: 'token' });

    expect(dispose).toHaveBeenCalled();
    expect(invoke).toHaveBeenCalledWith('clear_credentials', { key });
    expect(store.getState().accounts[key]).toBeUndefined();
  });
});
