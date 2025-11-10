import React, { createContext, useContext, useEffect } from 'react';
import { ClientEvent, RoomEvent } from 'matrix-js-sdk';
import { invoke } from '@tauri-apps/api/core';
import { createStore, StoreApi } from 'zustand/vanilla';
import { useStore } from 'zustand';
import { MatrixClient, RoomNotificationMode } from '../types';
import {
  AccountCredentials,
  MatrixSession,
  createMatrixSession,
  createMatrixSessionFromExistingClient,
} from './matrixRuntime';
import {
  collectUnifiedRooms,
  buildQuickFilterSummaries,
  type UnifiedAccountDescriptor,
  type UnifiedRoomSummary,
  type UniversalQuickFilterId,
  type UniversalQuickFilterSummary,
  isUniversalQuickFilterId,
} from '../utils/chatSelectors';
import { SCHEDULED_MESSAGES_EVENT_TYPE, parseScheduledMessagesFromEvent, getCachedScheduledMessages } from './schedulerService';
import { getSuspiciousEvents } from './secureCloudService';
import { bindCallStateStore, CallSessionState, getCallSessionForAccount, subscribeCallState } from './matrixService';

const RESTORE_ERROR_MESSAGE = 'Не удалось восстановить сессии. Авторизуйтесь заново.';

const isTauriAvailable = () =>
  typeof window !== 'undefined' && typeof (window as any).__TAURI_INTERNALS__ !== 'undefined';

const QUICK_FILTER_STORAGE_KEY = 'matrix-active-quick-filter';

const resolveEnv = (key: string, fallback?: string): string | undefined => {
  try {
    const env = (import.meta as any)?.env ?? {};
    const value = env[key];
    if (typeof value === 'string' && value.length > 0) {
      return value;
    }
  } catch {
    /* no-op */
  }
  return fallback;
};

const CALL_SYNC_URL = resolveEnv('VITE_CALL_STATE_WS_URL');

const readStoredQuickFilter = (): UniversalQuickFilterId | null => {
  if (typeof window === 'undefined') {
    return null;
  }
  try {
    const stored = window.localStorage?.getItem(QUICK_FILTER_STORAGE_KEY) ?? null;
    if (stored && isUniversalQuickFilterId(stored)) {
      return stored;
    }
  } catch (error) {
    console.warn('failed to read quick filter preference', error);
  }
  return null;
};

const persistQuickFilterPreference = (id: UniversalQuickFilterId) => {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    window.localStorage?.setItem(QUICK_FILTER_STORAGE_KEY, id);
  } catch (error) {
    console.warn('failed to persist quick filter preference', error);
  }
};

export interface StoredAccount extends AccountCredentials {
  key: string;
}

export interface AccountRuntime {
  creds: StoredAccount;
  client: MatrixClient;
  savedMessagesRoomId: string | null;
  unread: number;
  avatarUrl?: string | null;
  displayName?: string | null;
  roomNotificationModes: Record<string, RoomNotificationMode>;
}

export type InboxViewMode = 'active' | 'all';

export type AggregatedRoomSnapshot = UnifiedRoomSummary;

export interface AccountStoreState {
  accounts: Record<string, AccountRuntime>;
  activeKey: string | null;
  isBooting: boolean;
  error: string | null;
  isAddAccountOpen: boolean;
  aggregatedRooms: AggregatedRoomSnapshot[];
  aggregatedQuickFilters: UniversalQuickFilterSummary[];
  aggregatedUnread: number;
  universalMode: InboxViewMode;
  activeQuickFilterId: UniversalQuickFilterId;
  activeCalls: Record<string, CallSessionState | null>;
  boot: () => Promise<void>;
  addClientAccount: (client: MatrixClient) => Promise<void>;
  removeAccount: (key?: string) => Promise<void>;
  setActiveKey: (key: string | null) => void;
  openAddAccount: () => void;
  closeAddAccount: () => void;
  setError: (value: string | null) => void;
  updateAccountCredentials: (key: string, updater: (creds: StoredAccount) => StoredAccount) => Promise<void>;
  setRoomNotificationMode: (roomId: string, mode: RoomNotificationMode, key?: string | null) => void;
  setRoomNotificationModes: (modes: Record<string, RoomNotificationMode>, key?: string | null) => void;
  refreshAggregatedState: () => void;
  setUniversalMode: (mode: InboxViewMode) => void;
  setActiveQuickFilterId: (id: UniversalQuickFilterId) => void;
}

export const createAccountKey = (creds: AccountCredentials) =>
  `${creds.homeserver_url.replace(/\/+$/, '')}/${creds.user_id}`;

export const createAccountStore = () => {
  const sessionCleanup = new Map<string, () => void>();
  const initialQuickFilter = readStoredQuickFilter() ?? 'all';
  let callSyncSocket: WebSocket | null = null;
  let callSyncReady = false;
  const callSyncQueue: string[] = [];

  const ensureCallSyncSocket = () => {
    if (typeof window === 'undefined' || typeof WebSocket === 'undefined' || !CALL_SYNC_URL) {
      return null;
    }
    if (callSyncSocket && (callSyncSocket.readyState === WebSocket.OPEN || callSyncSocket.readyState === WebSocket.CONNECTING)) {
      return callSyncSocket;
    }
    try {
      callSyncSocket = new WebSocket(CALL_SYNC_URL);
      callSyncSocket.onopen = () => {
        callSyncReady = true;
        while (callSyncQueue.length > 0) {
          const payload = callSyncQueue.shift();
          if (!payload) {
            continue;
          }
          try {
            callSyncSocket?.send(payload);
          } catch (error) {
            console.warn('call sync socket send failed', error);
            callSyncQueue.unshift(payload);
            break;
          }
        }
      };
      callSyncSocket.onclose = () => {
        callSyncReady = false;
        callSyncSocket = null;
      };
      callSyncSocket.onerror = (event) => {
        console.warn('call sync socket error', event);
        callSyncReady = false;
        try { callSyncSocket?.close(); } catch { /* no-op */ }
        callSyncSocket = null;
      };
    } catch (error) {
      console.warn('call sync socket init failed', error);
      callSyncSocket = null;
    }
    return callSyncSocket;
  };

  const broadcastCallSession = (accountKey: string, session: CallSessionState | null) => {
    if (typeof navigator !== 'undefined' && navigator.serviceWorker?.controller) {
      try {
        navigator.serviceWorker.controller.postMessage({
          type: 'CALL_SESSION_UPDATE',
          accountKey,
          session,
        });
      } catch (error) {
        console.debug('Failed to post call session update to service worker', error);
      }
    }

    if (typeof window === 'undefined' || typeof WebSocket === 'undefined' || !CALL_SYNC_URL) {
      return;
    }

    const payload = JSON.stringify({
      type: 'call_session',
      accountKey,
      session,
    });

    const socket = ensureCallSyncSocket();
    if (socket && callSyncReady && socket.readyState === WebSocket.OPEN) {
      try {
        socket.send(payload);
        return;
      } catch (error) {
        console.warn('call sync send failed', error);
      }
    }
    callSyncQueue.push(payload);
  };

  const persistAccount = async (account: StoredAccount) => {
    if (!isTauriAvailable()) {
      return;
    }
    try {
      const { key: _key, ...payload } = account;
      await invoke('save_credentials', { creds: payload });
    } catch (error) {
      console.warn('persist failed', error);
    }
  };

  const cleanupSession = (key: string) => {
    const disposer = sessionCleanup.get(key);
    if (disposer) {
      try { disposer(); } catch (error) { console.warn('cleanup failed', error); }
      sessionCleanup.delete(key);
    }
  };

  const store = createStore<AccountStoreState>((set, get) => {
    const refreshAggregatedState = () => {
      const { accounts, activeQuickFilterId: currentFilter } = get();
      const descriptors: UnifiedAccountDescriptor[] = Object.values(accounts).map(runtime => {
        const scheduledEvent = runtime.client.getAccountData(SCHEDULED_MESSAGES_EVENT_TYPE);
        const scheduledMessages = scheduledEvent
          ? parseScheduledMessagesFromEvent(scheduledEvent).messages
          : getCachedScheduledMessages(runtime.client);
        const scheduledCountByRoom = scheduledMessages.reduce<Record<string, number>>((acc, message) => {
          if (!message || typeof message.roomId !== 'string' || message.roomId.length === 0) {
            return acc;
          }
          if (message.status === 'sent') {
            return acc;
          }
          acc[message.roomId] = (acc[message.roomId] ?? 0) + 1;
          return acc;
        }, {});

        const secureAlertCountByRoom = getSuspiciousEvents(runtime.client).reduce<Record<string, number>>(
          (acc, notice) => {
            if (!notice?.roomId) {
              return acc;
            }
            acc[notice.roomId] = (acc[notice.roomId] ?? 0) + 1;
            return acc;
          },
          {},
        );

        return {
          key: runtime.creds.key,
          client: runtime.client,
          savedMessagesRoomId: runtime.savedMessagesRoomId,
          roomNotificationModes: runtime.roomNotificationModes,
          userId: runtime.creds.user_id,
          displayName: runtime.displayName,
          avatarUrl: runtime.avatarUrl,
          homeserverUrl: runtime.creds.homeserver_url,
          scheduledCountByRoom,
          secureAlertCountByRoom,
        } satisfies UnifiedAccountDescriptor;
      });

      const aggregatedRooms = collectUnifiedRooms(descriptors);
      const aggregatedQuickFilters = buildQuickFilterSummaries(aggregatedRooms);
      const aggregatedUnread = aggregatedQuickFilters.find(filter => filter.id === 'all')?.unreadCount ?? 0;
      const availableFilterIds = new Set(aggregatedQuickFilters.map(filter => filter.id));
      const nextFilter: UniversalQuickFilterId = availableFilterIds.has(currentFilter) ? currentFilter : 'all';

      set({
        aggregatedRooms,
        aggregatedQuickFilters,
        aggregatedUnread,
        activeQuickFilterId: nextFilter,
      });
      if (nextFilter !== currentFilter) {
        persistQuickFilterPreference(nextFilter);
      }
    };

    const attachAggregatedListeners = (key: string, client: MatrixClient) => {
      const handleRefresh = () => {
        refreshAggregatedState();
      };

      client.on(RoomEvent.Timeline, handleRefresh as any);
      client.on(RoomEvent.Receipt, handleRefresh as any);
      client.on(ClientEvent.Sync, handleRefresh as any);
      client.on(ClientEvent.Room, handleRefresh as any);

      return () => {
        client.removeListener(RoomEvent.Timeline, handleRefresh as any);
        client.removeListener(RoomEvent.Receipt, handleRefresh as any);
        client.removeListener(ClientEvent.Sync, handleRefresh as any);
        client.removeListener(ClientEvent.Room, handleRefresh as any);
      };
    };

    const attachCallStateListeners = (key: string) => {
      const accountKey = key;
      const unsubscribe = subscribeCallState(accountKey, (session) => {
        set(state => {
          const current = state.activeCalls[accountKey];
          const currentStamp = current?.updatedAt ?? null;
          const nextStamp = session?.updatedAt ?? null;
          if (currentStamp === nextStamp && current === session) {
            return {};
          }
          return {
            activeCalls: {
              ...state.activeCalls,
              [accountKey]: session,
            },
          };
        });
        broadcastCallSession(accountKey, session ?? null);
      });

      return () => {
        try { unsubscribe(); } catch (error) { console.warn('call state unsubscribe failed', error); }
        set(state => {
          if (!(accountKey in state.activeCalls)) {
            return {};
          }
          const next = { ...state.activeCalls };
          delete next[accountKey];
          return { activeCalls: next };
        });
      };
    };

    const toRuntime = async (
      account: StoredAccount,
      existingClient?: MatrixClient,
    ): Promise<AccountRuntime> => {
      const updateUnread = (count: number) => {
        set(state => {
          const current = state.accounts[account.key];
          if (!current) {
            return {};
          }
          return {
            accounts: {
              ...state.accounts,
              [account.key]: { ...current, unread: count },
            },
          };
        });
        refreshAggregatedState();
      };

      const session: MatrixSession = existingClient
        ? await createMatrixSessionFromExistingClient(existingClient, account, updateUnread)
        : await createMatrixSession(account, updateUnread);

      cleanupSession(account.key);
      const detachAggregated = attachAggregatedListeners(account.key, session.client);
      const detachCallStateSubscription = attachCallStateListeners(account.key);
      let detachCallStateBinding: (() => void) | null = null;
      try {
        detachCallStateBinding = bindCallStateStore(session.client);
      } catch (error) {
        console.warn('bindCallStateStore failed', error);
      }

      sessionCleanup.set(account.key, () => {
        try { detachAggregated(); } catch (error) { console.warn('aggregation detach failed', error); }
        try { detachCallStateSubscription(); } catch (error) { console.warn('call state subscription detach failed', error); }
        try { detachCallStateBinding?.(); } catch (error) { console.warn('call state detach failed', error); }
        try { session.dispose(); } catch (error) { console.warn('dispose failed', error); }
        try { session.client.stopClient?.(); } catch (error) { console.warn('stopClient failed', error); }
      });

      return {
        creds: account,
        client: session.client,
        savedMessagesRoomId: session.savedMessagesRoomId,
        unread: session.unread,
        avatarUrl: session.avatarUrl,
        displayName: session.displayName,
        roomNotificationModes: {},
      };
    };

    const boot: AccountStoreState['boot'] = async () => {
      if (get().isBooting) return;
      set({ isBooting: true, error: null });

      if (!isTauriAvailable()) {
        set({ accounts: {}, activeKey: null, isBooting: false, activeCalls: {} });
        refreshAggregatedState();
        return;
      }

      try {
        const stored = await invoke<StoredAccount[]>('load_credentials');
        if (!stored || stored.length === 0) {
        set({ accounts: {}, activeKey: null, activeCalls: {} });
          refreshAggregatedState();
          return;
        }

        const runtimes: Array<[string, AccountRuntime]> = [];
        for (const account of stored) {
          try {
            const runtime = await toRuntime(account);
            runtimes.push([account.key, runtime]);
          } catch (error) {
            console.error('Failed to restore account', error);
          }
        }

        const accounts = runtimes.reduce<Record<string, AccountRuntime>>((acc, [key, runtime]) => {
          acc[key] = runtime;
          return acc;
        }, {});

        const firstKey = stored.find(item => accounts[item.key])?.key ?? null;
        set({
          accounts,
          activeKey: firstKey,
          error: runtimes.length === 0 ? RESTORE_ERROR_MESSAGE : null,
        });
        refreshAggregatedState();
      } catch (error) {
        console.error('restore failed', error);
        set({ accounts: {}, activeKey: null, error: RESTORE_ERROR_MESSAGE, activeCalls: {} });
        refreshAggregatedState();
      } finally {
        set({ isBooting: false });
      }
    };

    const addClientAccount: AccountStoreState['addClientAccount'] = async (client) => {
      const creds: AccountCredentials = {
        homeserver_url: client.getHomeserverUrl?.() ?? '',
        user_id: client.getUserId?.() ?? '',
        access_token: client.getAccessToken?.() ?? '',
      };
      const key = createAccountKey(creds);
      const storedAccount: StoredAccount = { ...creds, key };

      if (!creds.homeserver_url || !creds.user_id || !creds.access_token) {
        throw new Error('Недостаточно данных для сохранения аккаунта');
      }

      await persistAccount(storedAccount);

      const runtime = await toRuntime(storedAccount, client);
      set(state => ({
        accounts: { ...state.accounts, [key]: runtime },
        activeKey: key,
        isAddAccountOpen: false,
        error: null,
      }));
      refreshAggregatedState();
    };

    const removeAccount: AccountStoreState['removeAccount'] = async (key) => {
      const targetKey = key ?? get().activeKey;
      if (!targetKey) return;
      const current = get().accounts[targetKey];
      if (!current) return;

      cleanupSession(targetKey);

      try { await current.client.logout?.(); } catch (error) { console.warn('logout failed', error); }
      try { current.client.stopClient?.(); } catch (error) { console.warn('stopClient failed', error); }

      if (isTauriAvailable()) {
        try {
          await invoke('clear_credentials', { key: targetKey });
        } catch (error) {
          console.warn('clear store failed', error);
        }
      }

      set(state => {
        const nextAccounts = { ...state.accounts };
        delete nextAccounts[targetKey];
        const remainingKeys = Object.keys(nextAccounts);
        const nextActiveCalls = { ...state.activeCalls };
        delete nextActiveCalls[targetKey];
        return {
          accounts: nextAccounts,
          activeKey: state.activeKey === targetKey ? (remainingKeys[0] ?? null) : state.activeKey,
          activeCalls: nextActiveCalls,
        };
      });
      refreshAggregatedState();
    };

    const setActiveKey: AccountStoreState['setActiveKey'] = (key) => {
      if (!key) {
        set({ activeKey: null });
        return;
      }
      const runtime = get().accounts[key];
      if (runtime) {
        set({ activeKey: key });
      }
    };

    const openAddAccount = () => set({ isAddAccountOpen: true, error: null });
    const closeAddAccount = () => set({ isAddAccountOpen: false, error: null });

    const updateAccountCredentials: AccountStoreState['updateAccountCredentials'] = async (key, updater) => {
      const current = get().accounts[key];
      if (!current) {
        return;
      }
      const updatedCreds = updater(current.creds);
      set(state => ({
        accounts: {
          ...state.accounts,
          [key]: { ...current, creds: updatedCreds },
        },
      }));
      await persistAccount(updatedCreds);
      refreshAggregatedState();
    };

    const setError: AccountStoreState['setError'] = (value) => set({ error: value });

    const setRoomNotificationModes: AccountStoreState['setRoomNotificationModes'] = (modes, key = get().activeKey) => {
      if (!key) {
        return;
      }
      const current = get().accounts[key];
      if (!current) {
        return;
      }
      set(state => ({
        accounts: {
          ...state.accounts,
          [key]: {
            ...current,
            roomNotificationModes: {
              ...current.roomNotificationModes,
              ...modes,
            },
          },
        },
      }));
      refreshAggregatedState();
    };

    const setRoomNotificationMode: AccountStoreState['setRoomNotificationMode'] = (roomId, mode, key = get().activeKey) => {
      if (!roomId) {
        return;
      }
      setRoomNotificationModes({ [roomId]: mode }, key);
    };

    return {
      accounts: {},
      activeKey: null,
      isBooting: false,
      error: null,
      isAddAccountOpen: false,
      aggregatedRooms: [],
      aggregatedQuickFilters: buildQuickFilterSummaries([]),
      aggregatedUnread: 0,
      universalMode: 'active',
      activeQuickFilterId: initialQuickFilter,
      activeCalls: {},
      boot,
      addClientAccount,
      removeAccount,
      setActiveKey,
      openAddAccount,
      closeAddAccount,
      setError,
      updateAccountCredentials,
      setRoomNotificationMode,
      setRoomNotificationModes,
      refreshAggregatedState,
      setUniversalMode: (mode) => set({ universalMode: mode }),
      setActiveQuickFilterId: (id) => {
        set({ activeQuickFilterId: id });
        persistQuickFilterPreference(id);
      },
    };
  });

  return store;
};

const accountStoreInstance = createAccountStore();

const AccountStoreContext = createContext<StoreApi<AccountStoreState>>(accountStoreInstance);

export const getAccountStore = () => accountStoreInstance;

export const AccountProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  useEffect(() => {
    return () => {
      const state = accountStoreInstance.getState();
      Object.keys(state.accounts).forEach(key => {
        try {
          state.accounts[key]?.client.stopClient?.();
        } catch (error) {
          console.warn('failed to stop client on unmount', error);
        }
      });
    };
  }, []);

  return (
    <AccountStoreContext.Provider value={accountStoreInstance}>
      {children}
    </AccountStoreContext.Provider>
  );
};

export const useAccountStore = <T,>(selector: (state: AccountStoreState) => T): T => {
  const store = useContext(AccountStoreContext);
  return useStore(store, selector);
};

export interface AccountListItemSnapshot {
  key: string;
  userId: string;
  displayName?: string | null;
  avatarUrl?: string | null;
  unread: number;
}

export const useAccountListSnapshot = () =>
  useAccountStore(state => ({
    accounts: Object.values(state.accounts).map<AccountListItemSnapshot>(runtime => ({
      key: runtime.creds.key,
      userId: runtime.creds.user_id,
      displayName: runtime.displayName ?? runtime.creds.user_id,
      avatarUrl: runtime.avatarUrl ?? null,
      unread: runtime.unread,
    })),
    activeKey: state.activeKey,
    setActiveKey: state.setActiveKey,
    openAddAccount: state.openAddAccount,
  }));
