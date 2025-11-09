import React, { useEffect, useMemo } from 'react';
import LoginPage from './components/LoginPage';
import ChatPage from './components/ChatPage';
import AppErrorBoundary from './components/AppErrorBoundary';
import { AccountProvider, useAccountStore } from './services/accountManager';

const AppContent: React.FC = () => {
  const boot = useAccountStore(state => state.boot);
  const isBooting = useAccountStore(state => state.isBooting);
  const accounts = useAccountStore(state => state.accounts);
  const activeKey = useAccountStore(state => state.activeKey);
  const isAddAccountOpen = useAccountStore(state => state.isAddAccountOpen);
  const openAddAccount = useAccountStore(state => state.openAddAccount);
  const closeAddAccount = useAccountStore(state => state.closeAddAccount);
  const setActiveKey = useAccountStore(state => state.setActiveKey);

  useEffect(() => {
    const savedTheme = localStorage.getItem('matrix-theme') || '';
    document.documentElement.className = savedTheme;
  }, []);

  useEffect(() => {
    void boot();
  }, [boot]);

  const active = activeKey ? accounts[activeKey] : null;

  const accountListForUi = useMemo(() => {
    return Object.values(accounts).map(rt => ({
      key: rt.creds.key,
      userId: rt.creds.user_id,
      avatarUrl: rt.avatarUrl,
      displayName: rt.displayName || rt.creds.user_id,
      unread: rt.unread,
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
            <ChatPage />
          </AppErrorBoundary>
          {isAddAccountOpen && (
            <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
              <div className="w-full max-w-md bg-bg-primary rounded-lg shadow-xl p-4">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-lg font-semibold">Добавить аккаунт</h3>
                  <button className="p-2 hover:bg-bg-tertiary rounded-md" onClick={closeAddAccount}>✕</button>
                </div>
                <AppErrorBoundary key={`embedded-login-${activeKey || 'new'}`}>
                  <LoginPage isEmbedded />
                </AppErrorBoundary>
              </div>
            </div>
          )}
        </>
      ) : (
        <AppErrorBoundary key="primary-login">
          <LoginPage />
        </AppErrorBoundary>
      )}

      <MultiAccountBridge
        accounts={accountListForUi}
        activeKey={activeKey}
        onSwitch={(k) => setActiveKey(k)}
        onAdd={openAddAccount}
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

const App: React.FC = () => (
  <AccountProvider>
    <AppContent />
  </AccountProvider>
);

export default App;
