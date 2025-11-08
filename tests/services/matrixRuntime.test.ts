import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MatrixClient } from '../../src/types';
import {
  computeUnread,
  attachRealtimeCounters,
  createMatrixSession,
  createMatrixSessionFromExistingClient,
} from '../../src/services/matrixRuntime';
import * as matrixService from '../../src/services/matrixService';

vi.mock('../../src/services/matrixService', () => ({
  initClient: vi.fn(),
  findOrCreateSavedMessagesRoom: vi.fn(),
  mxcToHttp: vi.fn(() => null),
}));

type MockedClient = MatrixClient & {
  __listeners?: Map<string, Set<() => void>>;
  emit?: (event: string) => void;
};

const createMockClient = (): MockedClient => {
  const listeners = new Map<string, Set<() => void>>();
  return {
    getRooms: vi.fn(() => []),
    on: vi.fn((event: string, handler: () => void) => {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(handler);
    }),
    off: vi.fn((event: string, handler: () => void) => {
      listeners.get(event)?.delete(handler);
    }),
    removeListener: vi.fn((event: string, handler: () => void) => {
      listeners.get(event)?.delete(handler);
    }),
    emit(event: string) {
      listeners.get(event)?.forEach(handler => handler());
    },
    startClient: vi.fn(async () => {}),
    getUser: vi.fn(() => ({ avatarUrl: 'mxc://avatar', displayName: 'Display Name' })),
    getUserId: vi.fn(() => '@user:server'),
  } as unknown as MockedClient;
};

const initClientMock = () => vi.mocked(matrixService.initClient);
const savedRoomMock = () => vi.mocked(matrixService.findOrCreateSavedMessagesRoom);
const mxcMock = () => vi.mocked(matrixService.mxcToHttp);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('matrixRuntime', () => {
  it('computes unread notifications across rooms', () => {
    const client = {
      getRooms: () => [
        { getUnreadNotificationCount: () => 2 },
        { unreadNotifications: { highlightCount: 3 } },
        { unreadNotifications: { notificationCount: 5 } },
      ],
    } as unknown as MatrixClient;

    expect(computeUnread(client)).toBe(10);
  });

  it('attaches realtime counters and triggers updates', () => {
    const client = createMockClient();
    (client.getRooms as any) = vi.fn(() => [
      { getUnreadNotificationCount: () => 4 },
    ]);

    const spy = vi.fn();
    const dispose = attachRealtimeCounters(client, spy);

    expect(spy).toHaveBeenCalledWith(4);
    spy.mockReset();

    client.emit?.('Room.timeline');
    expect(spy).toHaveBeenCalledWith(4);

    dispose();
    spy.mockReset();
    client.emit?.('Room.timeline');
    expect(spy).not.toHaveBeenCalled();
  });

  it('creates a matrix session with a new client', async () => {
    const client = createMockClient();
    (client.getRooms as any) = vi.fn(() => [
      { getUnreadNotificationCount: () => 1 },
    ]);

    initClientMock().mockResolvedValue(client);
    savedRoomMock().mockResolvedValue('!saved:room');
    mxcMock().mockReturnValue('https://cdn/avatar.png');

    const unreadSpy = vi.fn();
    const session = await createMatrixSession(
      { homeserver_url: 'https://hs', user_id: '@user:hs', access_token: 'token' },
      unreadSpy,
    );

    expect(matrixService.initClient).toHaveBeenCalledWith('https://hs', 'token', '@user:hs');
    expect(client.startClient).toHaveBeenCalledWith({ initialSyncLimit: 10 });
    expect(matrixService.findOrCreateSavedMessagesRoom).toHaveBeenCalledWith(client);
    expect(session.savedMessagesRoomId).toBe('!saved:room');
    expect(session.avatarUrl).toBe('https://cdn/avatar.png');
    expect(session.displayName).toBe('Display Name');
    expect(unreadSpy).toHaveBeenCalledWith(1);
    session.dispose();
  });

  it('wraps an existing client without reinitialising', async () => {
    const client = createMockClient();
    (client.getRooms as any) = vi.fn(() => []);

    savedRoomMock().mockResolvedValue('!saved:room');

    const session = await createMatrixSessionFromExistingClient(
      client,
      { homeserver_url: 'https://hs', user_id: '@user:hs', access_token: 'token' },
      vi.fn(),
    );

    expect(matrixService.initClient).not.toHaveBeenCalled();
    expect(client.startClient).not.toHaveBeenCalled();
    expect(session.client).toBe(client);
    expect(session.savedMessagesRoomId).toBe('!saved:room');
  });
});
