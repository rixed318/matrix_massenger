import React, { createContext, useContext, useEffect } from 'react';
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

const RESTORE_ERROR_MESSAGE = 'Не удалось восстановить сессии. Авторизуйтесь заново.';

const isTauriAvailable = () =>
  typeof window !== 'undefined' && typeof (window as any).__TAURI_INTERNALS__ !== 'undefined';

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

export interface AccountStoreState {
  accounts: Record<string, AccountRuntime>;
  activeKey: string | null;
  isBooting: boolean;
  error: string | null;
  isAddAccountOpen: boolean;
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
}

export const createAccountKey = (creds: AccountCredentials) =>
  `${creds.homeserver_url.replace(/\/+$/, '')}/${creds.user_id}`;

export const createAccountStore = () => {
  const sessionCleanup = new Map<string, () => void>();

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
      };

      const session: MatrixSession = existingClient
        ? await createMatrixSessionFromExistingClient(existingClient, account, updateUnread)
        : await createMatrixSession(account, updateUnread);

      cleanupSession(account.key);
      sessionCleanup.set(account.key, () => {
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
        set({ accounts: {}, activeKey: null, isBooting: false });
        return;
      }

      try {
        const stored = await invoke<StoredAccount[]>('load_credentials');
        if (!stored || stored.length === 0) {
          set({ accounts: {}, activeKey: null });
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
      } catch (error) {
        console.error('restore failed', error);
        set({ accounts: {}, activeKey: null, error: RESTORE_ERROR_MESSAGE });
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
        return {
          accounts: nextAccounts,
          activeKey: state.activeKey === targetKey ? (remainingKeys[0] ?? null) : state.activeKey,
        };
      });
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
