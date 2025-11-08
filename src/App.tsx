import React, { useEffect, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import LoginPage from './components/LoginPage';
import ChatPage from './components/ChatPage';
import AppErrorBoundary from './components/AppErrorBoundary';
import { MatrixClient } from '@matrix-messenger/core';
import { initClient, findOrCreateSavedMessagesRoom, mxcToHttp } from '@matrix-messenger/core';

type StoredCredentials = {
  homeserver_url: string;
  user_id: string;
  access_token: string;
};
type StoredAccount = StoredCredentials & { key: string };

type AccountRuntime = {
  creds: StoredAccount;
  client: MatrixClient;
  savedMessagesRoomId: string | null;
  unread: number;
  avatarUrl?: string | null;
  displayName?: string | null;
};

type AccountsMap = Record<string, AccountRuntime>;

const App: React.FC = () => {
  const [accounts, setAccounts] = useState<AccountsMap>({});
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [isBooting, setIsBooting] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isAddAccountOpen, setAddAccountOpen] = useState(false);

  useEffect(() => {
    const savedTheme = localStorage.getItem('matrix-theme') || '';
    document.documentElement.className = savedTheme;
  }, []);

  const computeUnread = (c: MatrixClient) => {
    try {
      // @ts-ignore
      const rooms = c.getRooms?.() || [];
      const total = rooms.reduce((acc: number, r: any) => {
        const v = (typeof r.getUnreadNotificationCount === 'function')
          ? r.getUnreadNotificationCount()
          : (r?.unreadNotifications?.highlightCount || r?.unreadNotifications?.notificationCount || 0);
        return acc + (Number.isFinite(v) ? v : 0);
      }, 0);
      return total;
    } catch {
      return 0;
    }
  };

  const attachRealtimeCounters = (key: string, client: MatrixClient) => {
    const update = () => {
      setAccounts(prev => {
        const cur = prev[key];
        if (!cur) return prev;
        return { ...prev, [key]: { ...cur, unread: computeUnread(client) } };
      });
    };
    // @ts-ignore
    client.on?.('Room.timeline', update);
    // @ts-ignore
    client.on?.('Room.receipt', update);
    // @ts-ignore
    client.on?.('sync', update);
    update();
  };

  const startOneClient = async (acc: StoredAccount): Promise<AccountRuntime> => {
    const client = initClient(acc.homeserver_url, acc.access_token, acc.user_id);
    await client.startClient({ initialSyncLimit: 10 });
    const savedMessagesRoomId = await findOrCreateSavedMessagesRoom(client);

    const user = client.getUser(client.getUserId());
    const avatarUrl = mxcToHttp(client, user?.avatarUrl);
    const displayName = user?.displayName || acc.user_id;

    const runtime: AccountRuntime = {
      creds: acc,
      client,
      savedMessagesRoomId,
      unread: computeUnread(client),
      avatarUrl,
      displayName
    };
    attachRealtimeCounters(acc.key, client);
    return runtime;
  };

  useEffect(() => {
    const boot = async () => {
      try {
        // Check if Tauri is available (desktop mode)
        if (typeof window.__TAURI_INTERNALS__ !== 'undefined') {
          const stored = await invoke<StoredAccount[]>('load_credentials');
          if (stored && stored.length > 0) {
            const runtimes = await Promise.all(stored.map(startOneClient));
            const map: AccountsMap = Object.fromEntries(runtimes.map(rt => [rt.creds.key, rt]));
            setAccounts(map);
            setActiveKey(stored[0].key);
          }
        } else {
          console.log('Running in browser mode - Tauri features disabled');
        }
      } catch (e: any) {
        console.error('restore failed', e);
        // Don't show error in browser mode
        if (typeof window.__TAURI_INTERNALS__ !== 'undefined') {
          setError('Не удалось восстановить сессии. Авторизуйтесь заново.');
        }
      } finally {
        setIsBooting(false);
      }
    };
    boot();
  }, []);

  const handleLoginSuccess = async (newClient: MatrixClient) => {
    const creds: StoredCredentials = {
      homeserver_url: newClient.getHomeserverUrl(),
      user_id: newClient.getUserId(),
      access_token: newClient.getAccessToken(),
    };
    const key = `${creds.homeserver_url.replace(/\/+$/,'')}/${creds.user_id}`;
    try {
      await invoke('save_credentials', { creds });
    } catch (err) {
      console.warn('persist failed', err);
    }
    const runtime = await startOneClient({ key, ...creds });
    setAccounts(prev => ({ ...prev, [key]: runtime }));
    setActiveKey(key);
    setAddAccountOpen(false);
    setError(null);
  };

  const removeAccount = async (key?: string) => {
    const k = key || activeKey;
    if (!k) return;
    const acc = accounts[k];
    try { await acc.client.logout(); } catch {}
    try { await invoke('clear_credentials', { key: k }); } catch (err) { console.warn('clear store failed', err); }
    setAccounts(prev => {
      const cp: AccountsMap = { ...prev };
      delete cp[k];
      return cp;
    });
    const restKeys = Object.keys(accounts).filter(x => x !== k);
    setActiveKey(restKeys[0] || null);
  };

  const active = activeKey ? accounts[activeKey] : null;

  const accountListForUi = useMemo(() => {
    return Object.values(accounts).map(rt => ({
      key: rt.creds.key,
      userId: rt.creds.user_id,
      avatarUrl: rt.avatarUrl,
      displayName: rt.displayName || rt.creds.user_id,
      unread: rt.unread
    }));
  }, [accounts]);

  if (isBooting) {
    return (
      <div className="flex items-center justify-center h-screen bg-bg-secondary text-text-primary">
        <div className="animate-spin rounded-full h-16 w-16 border-t-2 border-b-2 border-blue-500"></div>
        <span className="ml-4 text-xl">Loading Sessions...</span>
      </div>
    );
  }

  return (
    <div className="h-screen w-screen bg-bg-primary text-text-primary font-sans">
      {active ? (
        <>
          <AppErrorBoundary key={activeKey || 'chat'}>
            <ChatPage
              client={active.client}
              onLogout={() => removeAccount(activeKey || undefined)}
              savedMessagesRoomId={active.savedMessagesRoomId || ''}
            />
          </AppErrorBoundary>
          {isAddAccountOpen && (
            <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
              <div className="w-full max-w-md bg-bg-primary rounded-lg shadow-xl p-4">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-lg font-semibold">Добавить аккаунт</h3>
                  <button className="p-2 hover:bg-bg-terтиary rounded-md" onClick={() => setAddAccountOpen(false)}>✕</button>
                </div>
                <AppErrorBoundary key={`embedded-login-${activeKey || 'new'}`}>
                  <LoginPage
                    onLoginSuccess={handleLoginSuccess}
                    initialError={error}
                    savedAccounts={Object.values(accounts).map(a => a.creds)}
                    isEmbedded
                  />
                </AppErrorBoundary>
              </div>
            </div>
          )}
        </>
      ) : (
        <AppErrorBoundary key="primary-login">
          <LoginPage onLoginSuccess={handleLoginSuccess} initialError={error} savedAccounts={[]} />
        </AppErrorBoundary>
      )}

      <MultiAccountBridge
        accounts={accountListForUi}
        activeKey={activeKey}
        onSwitch={(k) => setActiveKey(k)}
        onAdd={() => setAddAccountOpen(true)}
      />
    </div>
  );
};

const MultiAccountBridge: React.FC<{
  accounts: { key: string; userId: string; displayName?: string | null; avatarUrl?: string | null; unread: number }[];
  activeKey: string | null;
  onSwitch: (k: string) => void;
  onAdd: () => void;
}> = ({ accounts, activeKey, onSwitch, onAdd }) => {
  useEffect(() => {
    const switchHandler = (e: Event) => {
      const k = (e as CustomEvent).detail?.key as string;
      if (k) onSwitch(k);
    };
    const addHandler = () => onAdd();
    window.addEventListener('mm:switch-account', switchHandler as any);
    window.addEventListener('mm:add-account', addHandler as any);
    return () => {
      window.removeEventListener('mm:switch-account', switchHandler as any);
      window.removeEventListener('mm:add-account', addHandler as any);
    };
  }, [onSwitch, onAdd]);

  useEffect(() => {
    (window as any).__MM_ACCOUNTS__ = { accounts, activeKey };
  }, [accounts, activeKey]);

  return null;
};

export default App;
