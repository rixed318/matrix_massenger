import { MatrixClient } from '../types';
import { findOrCreateSavedMessagesRoom, initClient, mxcToHttp } from './matrixService';

export interface AccountCredentials {
  homeserver_url: string;
  user_id: string;
  access_token: string;
}

export interface MatrixSession {
  client: MatrixClient;
  savedMessagesRoomId: string | null;
  unread: number;
  avatarUrl?: string | null;
  displayName?: string | null;
  dispose: () => void;
}

export const computeUnread = (client: MatrixClient): number => {
  try {
    const rooms = (client as any).getRooms?.() || [];
    return rooms.reduce((acc: number, room: any) => {
      const value = typeof room?.getUnreadNotificationCount === 'function'
        ? room.getUnreadNotificationCount()
        : (room?.unreadNotifications?.highlightCount ?? room?.unreadNotifications?.notificationCount ?? 0);
      return acc + (Number.isFinite(value) ? Number(value) : 0);
    }, 0);
  } catch {
    return 0;
  }
};

export const attachRealtimeCounters = (
  client: MatrixClient,
  onUnreadChange: (count: number) => void,
): (() => void) => {
  const update = () => {
    try {
      onUnreadChange(computeUnread(client));
    } catch {
      onUnreadChange(0);
    }
  };

  const bindings: Array<[string, (...args: any[]) => void]> = [
    ['Room.timeline', update],
    ['Room.receipt', update],
    ['sync', update],
  ];

  bindings.forEach(([event, handler]) => {
    (client as any).on?.(event, handler);
  });

  update();

  return () => {
    bindings.forEach(([event, handler]) => {
      (client as any).off?.(event, handler);
      (client as any).removeListener?.(event, handler);
    });
  };
};

const buildSession = async (
  client: MatrixClient,
  account: AccountCredentials,
  onUnreadChange: (count: number) => void,
  shouldStart: boolean,
): Promise<MatrixSession> => {
  if (shouldStart) {
    await client.startClient({ initialSyncLimit: 10 });
  }

  const savedMessagesRoomId = await findOrCreateSavedMessagesRoom(client);
  const dispose = attachRealtimeCounters(client, onUnreadChange);
  const unread = computeUnread(client);

  const user = client.getUser?.(client.getUserId?.() ?? '') ?? null;
  const avatarUrl = user ? mxcToHttp(client, (user as any).avatarUrl) : undefined;
  const displayName = (user as any)?.displayName ?? account.user_id;

  return {
    client,
    savedMessagesRoomId,
    unread,
    avatarUrl,
    displayName,
    dispose,
  };
};

export const createMatrixSession = async (
  account: AccountCredentials,
  onUnreadChange: (count: number) => void,
): Promise<MatrixSession> => {
  const client = await initClient(account.homeserver_url, account.access_token, account.user_id);
  return buildSession(client, account, onUnreadChange, true);
};

export const createMatrixSessionFromExistingClient = async (
  client: MatrixClient,
  account: AccountCredentials,
  onUnreadChange: (count: number) => void,
): Promise<MatrixSession> => buildSession(client, account, onUnreadChange, false);
