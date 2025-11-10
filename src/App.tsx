import React, { useEffect } from 'react';
import LoginPage from './components/LoginPage';
import ChatPage from './components/ChatPage';
import AppErrorBoundary from './components/AppErrorBoundary';
import { AccountProvider, useAccountStore } from './services/accountManager';
import { bootstrapStoredPlugins } from './services/pluginHost';

const AppContent: React.FC = () => {
  const boot = useAccountStore(state => state.boot);
  const isBooting = useAccountStore(state => state.isBooting);
  const accounts = useAccountStore(state => state.accounts);
  const activeKey = useAccountStore(state => state.activeKey);
  const isAddAccountOpen = useAccountStore(state => state.isAddAccountOpen);
  const closeAddAccount = useAccountStore(state => state.closeAddAccount);
  const universalMode = useAccountStore(state => state.universalMode);
  const setUniversalMode = useAccountStore(state => state.setUniversalMode);
  const aggregatedUnread = useAccountStore(state => state.aggregatedUnread);
  const aggregatedRooms = useAccountStore(state => state.aggregatedRooms);

  useEffect(() => {
    const savedTheme = localStorage.getItem('matrix-theme') || '';
    document.documentElement.className = savedTheme;
  }, []);

  useEffect(() => {
    void boot();
  }, [boot]);

  useEffect(() => {
    void bootstrapStoredPlugins();
  }, []);

  const active = activeKey ? accounts[activeKey] : null;
  const canUseUniversal = active && (Object.keys(accounts).length > 1 || aggregatedRooms.length > 0);

  const modeButtonClass = (mode: 'active' | 'all') =>
    `px-3 py-1 text-xs font-semibold rounded-full transition-colors ${
      universalMode === mode ? 'bg-chip-selected text-text-inverted shadow-sm' : 'text-text-secondary hover:text-text-primary'
    }`;

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
      {canUseUniversal && (
        <div className="fixed top-4 right-4 z-40 flex items-center gap-2 bg-bg-primary/90 border border-border-secondary rounded-full px-3 py-1 shadow-lg backdrop-blur">
          <button
            type="button"
            className={modeButtonClass('active')}
            onClick={() => setUniversalMode('active')}
          >
            Текущий аккаунт
          </button>
          <button
            type="button"
            className={`${modeButtonClass('all')} flex items-center gap-1`}
            onClick={() => setUniversalMode('all')}
          >
            Все аккаунты
            {aggregatedUnread > 0 && (
              <span className="inline-flex items-center justify-center rounded-full bg-accent text-text-inverted px-1.5 text-[10px] leading-none">
                {aggregatedUnread}
              </span>
            )}
          </button>
        </div>
      )}
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

    </div>
  );
};

const App: React.FC = () => (
  <AccountProvider>
    <AppContent />
  </AccountProvider>
);

export default App;
