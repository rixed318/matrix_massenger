import React, { useEffect, useState } from 'react';
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
  const closeAddAccount = useAccountStore(state => state.closeAddAccount);
  const openAddAccount = useAccountStore(state => state.openAddAccount);
  const setActiveKey = useAccountStore(state => state.setActiveKey);
  const removeAccount = useAccountStore(state => state.removeAccount);
  const storeError = useAccountStore(state => state.error);

  useEffect(() => {
    const savedTheme = localStorage.getItem('matrix-theme') || '';
    document.documentElement.className = savedTheme;
  }, []);

  useEffect(() => {
    void boot();
  }, [boot]);

  const active = activeKey ? accounts[activeKey] : null;
  const accountEntries = Object.values(accounts);
  const [isAccountManagerOpen, setAccountManagerOpen] = useState(false);
  const [pendingRemovalKey, setPendingRemovalKey] = useState<string | null>(null);
  const [isImportingStoredSessions, setIsImportingStoredSessions] = useState(false);

  if (isBooting) {
    return (
      <div className="flex items-center justify-center h-screen bg-bg-secondary text-text-primary">
        <div className="animate-spin rounded-full h-16 w-16 border-t-2 border-b-2 border-blue-500"></div>
        <span className="ml-4 text-xl">Loading Sessions...</span>
      </div>
    );
  }

  const handleSwitchAccount = (key: string) => {
    setActiveKey(key);
    setAccountManagerOpen(false);
  };

  const handleRemoveAccount = async (key: string) => {
    setPendingRemovalKey(key);
    try {
      await removeAccount(key);
    } catch (error) {
      console.error('Failed to remove account', error);
    } finally {
      setPendingRemovalKey(current => (current === key ? null : current));
    }
  };

  const handleImportStoredSessions = async () => {
    setIsImportingStoredSessions(true);
    try {
      await boot();
    } catch (error) {
      console.error('Failed to import stored sessions', error);
    } finally {
      setIsImportingStoredSessions(false);
    }
  };

  return (
    <div className="relative h-screen w-screen bg-bg-primary text-text-primary font-sans">
      {(active || accountEntries.length > 0) && (
        <button
          type="button"
          onClick={() => setAccountManagerOpen(true)}
          className="absolute top-4 right-4 z-20 rounded-md border border-border-primary bg-bg-primary/90 px-3 py-1.5 text-xs font-medium shadow hover:border-accent"
        >
          Управление аккаунтами
        </button>
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

      {isAccountManagerOpen && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/50 px-4">
          <div className="w-full max-w-lg rounded-lg bg-bg-primary p-6 shadow-2xl">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold text-text-primary">Аккаунты Matrix</h2>
                {storeError && (
                  <p className="mt-1 text-xs text-red-500">{storeError}</p>
                )}
              </div>
              <button
                type="button"
                onClick={() => setAccountManagerOpen(false)}
                className="rounded-md p-2 text-text-secondary hover:text-text-primary"
                aria-label="Закрыть"
              >
                ✕
              </button>
            </div>
            <div className="mt-4 max-h-[60vh] space-y-3 overflow-y-auto pr-1">
              {accountEntries.length === 0 ? (
                <p className="text-sm text-text-secondary">Нет сохранённых аккаунтов. Войдите, чтобы добавить новый профиль.</p>
              ) : (
                accountEntries.map(runtime => {
                  const key = runtime.creds.key;
                  const isActive = key === activeKey;
                  const isRemoving = pendingRemovalKey === key;
                  return (
                    <div
                      key={key}
                      className={`flex items-center justify-between gap-4 rounded-md border px-4 py-3 ${isActive ? 'border-accent bg-accent/10' : 'border-border-primary bg-bg-tertiary/40'}`}
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-text-primary">{runtime.displayName ?? runtime.creds.user_id}</p>
                        <p className="truncate text-xs text-text-secondary">{runtime.creds.homeserver_url}</p>
                        {isActive && <span className="mt-1 inline-block text-[10px] uppercase tracking-wide text-accent">активный профиль</span>}
                      </div>
                      <div className="flex flex-wrap items-center justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => handleSwitchAccount(key)}
                          disabled={isActive || isRemoving}
                          className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-text-inverted hover:bg-accent-hover disabled:opacity-60"
                        >
                          {isActive ? 'Текущий' : 'Использовать'}
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleRemoveAccount(key)}
                          disabled={isRemoving}
                          className="rounded-md border border-border-primary px-3 py-1.5 text-xs font-medium text-text-secondary hover:text-text-primary hover:border-accent disabled:opacity-60"
                        >
                          {isRemoving ? 'Удаление…' : 'Удалить'}
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
            <div className="mt-6 flex flex-wrap items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => {
                  setAccountManagerOpen(false);
                  openAddAccount();
                }}
                className="rounded-md border border-border-primary px-4 py-2 text-sm font-medium hover:border-accent"
              >
                Добавить аккаунт
              </button>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void handleImportStoredSessions()}
                  disabled={isImportingStoredSessions || isBooting}
                  className="rounded-md border border-border-primary px-4 py-2 text-sm font-medium text-text-secondary hover:text-text-primary hover:border-accent disabled:opacity-60"
                >
                  {isImportingStoredSessions || isBooting ? 'Импорт...' : 'Импортировать'}
                </button>
                <button
                  type="button"
                  onClick={() => setAccountManagerOpen(false)}
                  className="rounded-md px-4 py-2 text-sm font-medium text-text-secondary hover:text-text-primary"
                >
                  Закрыть
                </button>
              </div>
            </div>
          </div>
        </div>
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
