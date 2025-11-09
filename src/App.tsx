import React, { useEffect } from 'react';
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

  useEffect(() => {
    const savedTheme = localStorage.getItem('matrix-theme') || '';
    document.documentElement.className = savedTheme;
  }, []);

  useEffect(() => {
    void boot();
  }, [boot]);

  const active = activeKey ? accounts[activeKey] : null;
  const accountEntries = Object.values(accounts);
  const [isAccountManagerOpen, setAccountManagerOpen] = React.useState(false);
  const [accountManagerAction, setAccountManagerAction] = React.useState<{ key: string; type: 'switch' | 'remove' } | null>(null);
  const [isImportingStoredSessions, setIsImportingStoredSessions] = React.useState(false);

  useEffect(() => {
    if (isAccountManagerOpen && accountEntries.length === 0) {
      setAccountManagerOpen(false);
    }
  }, [isAccountManagerOpen, accountEntries.length]);

  useEffect(() => {
    if (accountManagerAction?.type === 'switch' && accountManagerAction.key === activeKey) {
      setAccountManagerAction(null);
      setAccountManagerOpen(false);
    }
  }, [accountManagerAction, activeKey]);

  useEffect(() => {
    if (accountManagerAction?.type === 'remove' && !accounts[accountManagerAction.key]) {
      setAccountManagerAction(null);
    }
  }, [accountManagerAction, accounts]);

  const handleManagerSwitch = (key: string) => {
    setAccountManagerAction({ key, type: 'switch' });
    setActiveKey(key);
  };

  const handleManagerRemove = async (key: string) => {
    setAccountManagerAction({ key, type: 'remove' });
    try {
      await removeAccount(key);
    } catch (error) {
      console.error('Failed to remove account from manager', error);
    } finally {
      setAccountManagerAction(current => (current?.key === key ? null : current));
    }
  };

  const handleManagerImport = async () => {
    setIsImportingStoredSessions(true);
    try {
      await boot();
    } catch (error) {
      console.error('Failed to import stored sessions', error);
    } finally {
      setIsImportingStoredSessions(false);
    }
  };

  const closeAccountManager = () => {
    setAccountManagerOpen(false);
    setAccountManagerAction(null);
  };

  const openAccountManager = () => {
    setAccountManagerOpen(true);
  };

  if (isBooting) {
    return (
      <div className="flex items-center justify-center h-screen bg-bg-secondary text-text-primary">
        <div className="animate-spin rounded-full h-16 w-16 border-t-2 border-b-2 border-blue-500"></div>
        <span className="ml-4 text-xl">Loading Sessions...</span>
      </div>
    );
  }

  return (
    <div className="relative h-screen w-screen bg-bg-primary text-text-primary font-sans">
      {!active && accountEntries.length > 0 && (
        <button
          type="button"
          onClick={openAccountManager}
          className="absolute top-4 right-4 z-30 rounded-md border border-border-primary bg-bg-primary/90 px-4 py-2 text-sm font-medium shadow-lg hover:border-accent"
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
          <div className="w-full max-w-xl rounded-lg bg-bg-primary p-6 shadow-2xl">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">Управление аккаунтами</h2>
              <button
                type="button"
                onClick={closeAccountManager}
                className="rounded-md p-2 text-text-secondary hover:text-text-primary"
                aria-label="Закрыть управление аккаунтами"
              >
                ✕
              </button>
            </div>
            <div className="mt-4 max-h-[60vh] space-y-3 overflow-y-auto pr-1">
              {accountEntries.map(runtime => {
                const key = runtime.creds.key;
                const isActiveAccount = key === activeKey;
                const isSwitching = accountManagerAction?.key === key && accountManagerAction.type === 'switch';
                const isRemoving = accountManagerAction?.key === key && accountManagerAction.type === 'remove';
                return (
                  <div
                    key={key}
                    className={`flex items-center justify-between gap-4 rounded-md border border-border-primary bg-bg-tertiary/40 px-4 py-3 ${isActiveAccount ? 'ring-1 ring-accent/70' : ''}`}
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-text-primary truncate">{runtime.displayName ?? runtime.creds.user_id}</p>
                      <p className="text-xs text-text-secondary truncate">{runtime.creds.homeserver_url}</p>
                      {isActiveAccount && (
                        <span className="mt-1 inline-block text-[10px] uppercase tracking-wide text-accent">активный</span>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <button
                        type="button"
                        onClick={() => handleManagerSwitch(key)}
                        disabled={isSwitching || isRemoving}
                        className="px-3 py-1 text-xs font-medium rounded-md bg-accent text-text-inverted hover:bg-accent-hover disabled:opacity-60"
                      >
                        {isSwitching ? 'Переключение…' : 'Сделать активным'}
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleManagerRemove(key)}
                        disabled={isRemoving}
                        className="px-3 py-1 text-xs font-medium rounded-md border border-border-primary text-text-secondary hover:text-text-primary hover:border-accent disabled:opacity-60"
                      >
                        {isRemoving ? 'Удаление…' : 'Удалить'}
                      </button>
                    </div>
                  </div>
                );
              })}
              {accountEntries.length === 0 && (
                <p className="text-sm text-text-secondary">Нет сохранённых аккаунтов.</p>
              )}
            </div>
            <div className="mt-6 flex flex-wrap items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => {
                  closeAccountManager();
                  openAddAccount();
                }}
                className="rounded-md border border-border-primary px-4 py-2 text-sm font-medium hover:border-accent"
              >
                Добавить аккаунт
              </button>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void handleManagerImport()}
                  disabled={isImportingStoredSessions || isBooting}
                  className="rounded-md border border-border-primary px-4 py-2 text-sm font-medium text-text-secondary hover:text-text-primary hover:border-accent disabled:opacity-60"
                >
                  {isImportingStoredSessions || isBooting ? 'Импорт...' : 'Импортировать' }
                </button>
                <button
                  type="button"
                  onClick={closeAccountManager}
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
