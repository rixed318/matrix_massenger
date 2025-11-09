import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  AccountCredentials,
  MatrixClient,
  MatrixSession,
  QrLoginHandle,
  TotpRequiredError,
  createMatrixSessionFromExistingClient,
  generateQrLogin,
  initClient,
  login,
  loginWithToken as coreLoginWithToken,
  resolveHomeserverBaseUrl,
} from '@matrix-messenger/core';

export interface CredentialsPayload {
  homeserverUrl: string;
  username: string;
  password: string;
  totpCode?: string;
  totpSessionId?: string;
}

export interface TokenLoginPayload {
  homeserverUrl: string;
  loginToken: string;
}

export interface SsoLoginPayload {
  homeserverUrl: string;
  redirectUri: string;
}

export interface SsoLoginResult {
  homeserverUrl: string;
  loginUrl: string;
  state: string;
}

export interface MatrixSessionWithAccount extends MatrixSession {
  account: AccountCredentials;
}

export type MfaState =
  | { status: 'idle' }
  | { status: 'verifying'; sessionId?: string; message?: string }
  | {
      status: 'required';
      sessionId?: string;
      message: string;
      flows: Array<{ stages?: string[] }>;
      validationError: boolean;
    };

export type QrLoginStatus =
  | 'idle'
  | 'loading'
  | 'ready'
  | 'polling'
  | 'approved'
  | 'cancelled'
  | 'error'
  | 'expired';

export interface QrLoginState {
  status: QrLoginStatus;
  matrixUri: string | null;
  expiresAt: number | null;
  fallbackUrl: string | null;
  message: string | null;
  error: string | null;
}

interface MatrixSessionContextValue {
  session: MatrixSessionWithAccount | null;
  isLoading: boolean;
  error: string | null;
  mfaState: MfaState;
  qrLoginState: QrLoginState;
  loginWithPassword: (payload: CredentialsPayload) => Promise<void>;
  loginWithToken: (payload: TokenLoginPayload) => Promise<void>;
  loginWithSso: (payload: SsoLoginPayload) => Promise<SsoLoginResult>;
  beginQrLogin: (homeserverUrl: string) => Promise<void>;
  cancelQrLogin: () => Promise<void>;
  logout: () => Promise<void>;
  updateSession: (updater: (session: MatrixSessionWithAccount) => MatrixSessionWithAccount) => void;
  clearError: () => void;
}

const MatrixSessionContext = createContext<MatrixSessionContextValue | undefined>(undefined);

const defaultQrLoginState: QrLoginState = {
  status: 'idle',
  matrixUri: null,
  expiresAt: null,
  fallbackUrl: null,
  message: null,
  error: null,
};

const defaultMfaState: MfaState = { status: 'idle' };

const buildCredentials = (client: MatrixClient, homeserverUrl: string): AccountCredentials => ({
  homeserver_url: homeserverUrl,
  user_id: client.getUserId() ?? '',
  access_token: client.getAccessToken?.() ?? '',
});

type ActiveQrLogin = {
  handle: QrLoginHandle;
  abortController: AbortController;
  homeserverUrl: string;
};

export const MatrixSessionProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [session, setSession] = useState<MatrixSessionWithAccount | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mfaState, setMfaState] = useState<MfaState>(defaultMfaState);
  const [qrLoginState, setQrLoginState] = useState<QrLoginState>(defaultQrLoginState);
  const qrLoginRef = useRef<ActiveQrLogin | null>(null);

  const finalizeSession = useCallback(
    async (client: MatrixClient, homeserverUrl: string) => {
      const credentials = buildCredentials(client, homeserverUrl);
      const handleUnreadChange = (count: number) => {
        setSession(prev => (prev ? { ...prev, unread: count } : prev));
      };

      const created = await createMatrixSessionFromExistingClient(client, credentials, handleUnreadChange);
      setSession({ ...created, account: credentials });
      setMfaState(defaultMfaState);
    },
    [],
  );

  const cleanupQrLogin = useCallback(
    async (shouldCancel: boolean) => {
      const current = qrLoginRef.current;
      if (!current) return;
      qrLoginRef.current = null;
      current.abortController.abort();
      if (shouldCancel) {
        try {
          await current.handle.cancel();
        } catch (err) {
          console.warn('Failed to cancel QR login flow', err);
        }
      }
    },
    [],
  );

  useEffect(() => {
    return () => {
      void cleanupQrLogin(true);
    };
  }, [cleanupQrLogin]);

  const loginWithPassword = useCallback(
    async ({ homeserverUrl, username, password, totpCode, totpSessionId }: CredentialsPayload) => {
      setIsLoading(true);
      setError(null);
      if (totpCode) {
        setMfaState({ status: 'verifying', sessionId: totpSessionId, message: 'Проверяем одноразовый код…' });
      } else {
        setMfaState(defaultMfaState);
      }

      try {
        const normalizedHomeserver = await resolveHomeserverBaseUrl(homeserverUrl);
        const client = await login(normalizedHomeserver, username, password, {
          totpCode,
          totpSessionId: totpSessionId ?? (mfaState.status === 'required' ? mfaState.sessionId : undefined),
        });
        await finalizeSession(client, normalizedHomeserver);
        setQrLoginState(defaultQrLoginState);
      } catch (err) {
        console.error('password login failed', err);
        if (err instanceof TotpRequiredError) {
          setMfaState({
            status: 'required',
            sessionId: err.sessionId,
            message: err.message,
            flows: err.flows,
            validationError: err.isValidationError,
          });
          setError(err.message);
        } else {
          setMfaState(defaultMfaState);
          setError(err instanceof Error ? err.message : 'Неизвестная ошибка авторизации');
        }
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [finalizeSession, mfaState],
  );

  const loginWithToken = useCallback(
    async ({ homeserverUrl, loginToken }: TokenLoginPayload) => {
      setIsLoading(true);
      setError(null);
      setMfaState(defaultMfaState);
      try {
        const normalizedHomeserver = await resolveHomeserverBaseUrl(homeserverUrl);
        const client = await coreLoginWithToken(normalizedHomeserver, loginToken);
        await finalizeSession(client, normalizedHomeserver);
        setQrLoginState(prev =>
          prev.status === 'polling' || prev.status === 'ready'
            ? {
                ...prev,
                status: 'approved',
                message: 'Токен подтверждён. Загружаем данные…',
                error: null,
              }
            : prev,
        );
      } catch (err) {
        console.error('token login failed', err);
        const message = err instanceof Error ? err.message : 'Не удалось войти по токену.';
        setError(message);
        setQrLoginState(prev =>
          prev.status === 'polling' || prev.status === 'ready'
            ? { ...prev, status: 'error', error: message, message: null }
            : prev,
        );
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [finalizeSession],
  );

  const loginWithSso = useCallback(async ({ homeserverUrl, redirectUri }: SsoLoginPayload): Promise<SsoLoginResult> => {
    try {
      const normalizedHomeserver = await resolveHomeserverBaseUrl(homeserverUrl);
      const client = await initClient(normalizedHomeserver);
      if (!client.getSsoLoginUrl) {
        throw new Error('Homeserver не поддерживает SSO авторизацию.');
      }
      const loginUrl = client.getSsoLoginUrl(redirectUri, 'm.login.sso');
      if (!loginUrl) {
        throw new Error('Не удалось получить ссылку для входа через SSO.');
      }
      const parsed = new URL(loginUrl);
      const state = parsed.searchParams.get('state') ?? '';
      setError(null);
      setMfaState(defaultMfaState);
      return { homeserverUrl: normalizedHomeserver, loginUrl: parsed.toString(), state };
    } catch (err) {
      console.error('sso bootstrap failed', err);
      const message = err instanceof Error ? err.message : 'Не удалось инициализировать вход через SSO.';
      setError(message);
      throw err;
    }
  }, []);

  const beginQrLogin = useCallback(
    async (homeserverUrl: string) => {
      setQrLoginState({
        status: 'loading',
        matrixUri: null,
        expiresAt: null,
        fallbackUrl: null,
        message: 'Запрашиваем QR-код…',
        error: null,
      });
      await cleanupQrLogin(true);
      try {
        const normalizedHomeserver = await resolveHomeserverBaseUrl(homeserverUrl);
        const abortController = new AbortController();
        const handle = await generateQrLogin(normalizedHomeserver, { signal: abortController.signal });
        qrLoginRef.current = { handle, abortController, homeserverUrl: normalizedHomeserver };
        setQrLoginState({
          status: 'ready',
          matrixUri: handle.matrixUri ?? null,
          expiresAt: handle.expiresAt ?? null,
          fallbackUrl: handle.fallbackUrl ?? null,
          message: 'Отсканируйте код или подтвердите вход через доверенное устройство.',
          error: null,
        });

        const pollPromise = handle
          .pollLoginToken({ signal: abortController.signal })
          .then(async token => {
            setQrLoginState(prev => ({
              ...prev,
              status: 'polling',
              message: 'Получен токен подтверждения. Завершаем вход…',
              error: null,
            }));
            await loginWithToken({ homeserverUrl: normalizedHomeserver, loginToken: token });
          })
          .catch(err => {
            if (abortController.signal.aborted) {
              return;
            }
            const message = err instanceof Error ? err.message : 'Не удалось завершить QR-вход.';
            const lowered = message.toLowerCase();
            setQrLoginState(prev => ({
              ...prev,
              status: lowered.includes('истёк') ? 'expired' : 'error',
              error: message,
              message: null,
            }));
          })
          .finally(() => {
            qrLoginRef.current = null;
          });

        void pollPromise;
      } catch (err) {
        qrLoginRef.current = null;
        const message = err instanceof Error ? err.message : 'Не удалось сгенерировать QR-код.';
        setQrLoginState(prev => ({
          ...prev,
          status: 'error',
          matrixUri: null,
          expiresAt: null,
          error: message,
          message: null,
        }));
        throw err;
      }
    },
    [cleanupQrLogin, loginWithToken],
  );

  const cancelQrLogin = useCallback(async () => {
    await cleanupQrLogin(true);
    setQrLoginState(prev => ({
      ...prev,
      status: 'cancelled',
      matrixUri: null,
      expiresAt: null,
      message: 'QR-вход отменён пользователем.',
      error: null,
    }));
  }, [cleanupQrLogin]);

  const logout = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    await cleanupQrLogin(true);
    try {
      if (session) {
        try {
          await session.client.logout?.();
        } catch (err) {
          console.warn('logout failed', err);
        }
        try {
          session.dispose();
        } catch (err) {
          console.warn('dispose failed', err);
        }
        try {
          session.client.stopClient?.();
        } catch (err) {
          console.warn('stop client failed', err);
        }
      }
      setSession(null);
      setQrLoginState(defaultQrLoginState);
      setMfaState(defaultMfaState);
    } finally {
      setIsLoading(false);
    }
  }, [cleanupQrLogin, session]);

  const updateSession = useCallback((updater: (current: MatrixSessionWithAccount) => MatrixSessionWithAccount) => {
    setSession(prev => (prev ? updater(prev) : prev));
  }, []);

  const clearError = useCallback(() => setError(null), []);

  const value = useMemo<MatrixSessionContextValue>(
    () => ({
      session,
      isLoading,
      error,
      mfaState,
      qrLoginState,
      loginWithPassword,
      loginWithToken,
      loginWithSso,
      beginQrLogin,
      cancelQrLogin,
      logout,
      updateSession,
      clearError,
    }),
    [
      session,
      isLoading,
      error,
      mfaState,
      qrLoginState,
      loginWithPassword,
      loginWithToken,
      loginWithSso,
      beginQrLogin,
      cancelQrLogin,
      logout,
      updateSession,
      clearError,
    ],
  );

  return <MatrixSessionContext.Provider value={value}>{children}</MatrixSessionContext.Provider>;
};

export const useMatrixSession = (): MatrixSessionContextValue => {
  const context = useContext(MatrixSessionContext);
  if (!context) {
    throw new Error('useMatrixSession must be used within MatrixSessionProvider');
  }
  return context;
};
