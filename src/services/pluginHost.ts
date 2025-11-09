import {
  PluginHost,
  createBrowserStorageAdapter,
  createMemoryStorageAdapter,
  type AccountMetadata,
  type PluginDefinition,
  type PluginHandle,
} from '@matrix-messenger/sdk';
import type { MatrixClient, MatrixEvent, MatrixRoom } from '../types';

const storage = typeof window !== 'undefined'
  ? createBrowserStorageAdapter('matrix-messenger.plugins')
  : createMemoryStorageAdapter();

export const pluginHost = new PluginHost({ storage });

type AccountRegistration = {
  key: string;
  client: MatrixClient;
  userId: string;
  homeserverUrl: string;
  displayName?: string | null;
  avatarUrl?: string | null;
};

const accountListeners = new Map<string, { timeline: (...args: any[]) => void }>();

const toMetadata = (registration: AccountRegistration): AccountMetadata => ({
  id: registration.key,
  userId: registration.userId,
  homeserverUrl: registration.homeserverUrl,
  displayName: registration.displayName ?? undefined,
  avatarUrl: registration.avatarUrl ?? undefined,
  label: registration.displayName ?? registration.userId,
});

const emitTimeline = (
  accountId: string,
  event: MatrixEvent,
  room?: MatrixRoom | null,
  toStartOfTimeline?: boolean,
  _removed?: boolean,
  data?: Record<string, unknown>,
) => {
  if (!room) {
    return;
  }
  const context = pluginHost.getAccountContext(accountId);
  if (!context) {
    return;
  }
  const payload = {
    account: context.account,
    client: context.client,
    roomId: room.roomId,
    event,
    data,
    isLiveEvent: Boolean((data as any)?.liveEvent ?? (data as any)?.timeline?.getLiveTimeline?.()),
    direction: toStartOfTimeline ? 'backward' as const : 'forward' as const,
  };
  void pluginHost.emit('matrix.room-event', payload);
  if (event.getType?.() === 'm.room.message') {
    const content = event.getContent();
    void pluginHost.emit('matrix.message', {
      ...payload,
      content: content as any,
      messageType: (content?.msgtype ?? 'm.text') as string,
    });
  }
};

export const attachAccountToPluginHost = (registration: AccountRegistration): (() => void) => {
  pluginHost.registerAccount(toMetadata(registration), registration.client);
  const timelineHandler = (
    event: MatrixEvent,
    room?: MatrixRoom,
    toStartOfTimeline?: boolean,
    removed?: boolean,
    data?: Record<string, unknown>,
  ) => emitTimeline(registration.key, event, room, toStartOfTimeline, removed, data);
  (registration.client as any).on?.('Room.timeline', timelineHandler);
  accountListeners.set(registration.key, { timeline: timelineHandler });

  return () => {
    const current = accountListeners.get(registration.key);
    if (current) {
      (registration.client as any).removeListener?.('Room.timeline', current.timeline);
      accountListeners.delete(registration.key);
    }
    pluginHost.unregisterAccount(registration.key);
  };
};

export const updateAccountForPlugins = (registration: AccountRegistration): void => {
  pluginHost.updateAccount(toMetadata(registration));
};

export const registerExternalPlugin = (definition: PluginDefinition) => pluginHost.registerPlugin(definition);

declare global {
  interface Window {
    matrixMessenger?: {
      host: PluginHost;
      registerPlugin: (definition: PluginDefinition) => Promise<PluginHandle>;
    };
  }
}

if (typeof window !== 'undefined') {
  window.matrixMessenger = window.matrixMessenger ?? {
    host: pluginHost,
    registerPlugin: (definition: PluginDefinition) => pluginHost.registerPlugin(definition),
  };
}
