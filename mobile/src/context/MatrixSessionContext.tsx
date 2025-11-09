import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import {
  AccountCredentials,
  MatrixClient,
  MatrixSession,
  createMatrixSessionFromExistingClient,
  login,
  resolveHomeserverBaseUrl,
} from '@matrix-messenger/core';

export interface CredentialsPayload {
  homeserverUrl: string;
  username: string;
  password: string;
}

export interface MatrixSessionWithAccount extends MatrixSession {
  account: AccountCredentials;
}

interface MatrixSessionContextValue {
  session: MatrixSessionWithAccount | null;
  isLoading: boolean;
  error: string | null;
  loginWithPassword: (payload: CredentialsPayload) => Promise<void>;
  logout: () => Promise<void>;
  updateSession: (updater: (session: MatrixSessionWithAccount) => MatrixSessionWithAccount) => void;
}

const MatrixSessionContext = createContext<MatrixSessionContextValue | undefined>(undefined);

const buildCredentials = (client: MatrixClient, homeserverUrl: string): AccountCredentials => ({
  homeserver_url: homeserverUrl,
  user_id: client.getUserId() ?? '',
  access_token: client.getAccessToken?.() ?? '',
});

export const MatrixSessionProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [session, setSession] = useState<MatrixSessionWithAccount | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loginWithPassword = useCallback(async ({ homeserverUrl, username, password }: CredentialsPayload) => {
    setIsLoading(true);
    setError(null);
    try {
      const normalizedHomeserver = await resolveHomeserverBaseUrl(homeserverUrl);
      const client = await login(normalizedHomeserver, username, password);
      const credentials = buildCredentials(client, normalizedHomeserver);

      const handleUnreadChange = (count: number) => {
        setSession(prev => (prev ? { ...prev, unread: count } : prev));
      };

      const created = await createMatrixSessionFromExistingClient(client, credentials, handleUnreadChange);
      setSession({ ...created, account: credentials });
    } catch (err) {
      console.error('login failed', err);
      setError(err instanceof Error ? err.message : 'Неизвестная ошибка авторизации');
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const logout = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      if (session) {
        try { await session.client.logout?.(); } catch (err) { console.warn('logout failed', err); }
        try { session.dispose(); } catch (err) { console.warn('dispose failed', err); }
        try { session.client.stopClient?.(); } catch (err) { console.warn('stop client failed', err); }
      }
      setSession(null);
    } finally {
      setIsLoading(false);
    }
  }, [session]);

  const updateSession = useCallback((updater: (current: MatrixSessionWithAccount) => MatrixSessionWithAccount) => {
    setSession(prev => (prev ? updater(prev) : prev));
  }, []);

  const value = useMemo<MatrixSessionContextValue>(() => ({
    session,
    isLoading,
    error,
    loginWithPassword,
    logout,
    updateSession,
  }), [session, isLoading, error, loginWithPassword, logout, updateSession]);

  return <MatrixSessionContext.Provider value={value}>{children}</MatrixSessionContext.Provider>;
};

export const useMatrixSession = (): MatrixSessionContextValue => {
  const context = useContext(MatrixSessionContext);
  if (!context) {
    throw new Error('useMatrixSession must be used within MatrixSessionProvider');
  }
  return context;
};
