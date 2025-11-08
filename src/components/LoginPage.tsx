import React, { useState, FormEvent, useEffect } from 'react';
import { MatrixClient } from '../types';
import { login, resolveHomeserverBaseUrl, HomeserverDiscoveryError } from '../services/matrixService';

interface LoginPageProps {
  onLoginSuccess: (client: MatrixClient) => void;
  initialError: string | null;
  savedAccounts?: { key: string; homeserver_url: string; user_id: string; access_token: string }[];
  isEmbedded?: boolean;
}

type ConnectionType = 'public' | 'secure' | 'selfhosted';
type AuthMode = 'choose' | 'login' | 'register';

const getDefaultHomeserver = (connectionType: ConnectionType) => {
  switch (connectionType) {
    case 'public':
      return 'https://matrix.org';
    case 'secure':
      return 'https://matrix.secure-messenger.com';
    case 'selfhosted':
    default:
      return '';
  }
};

const ConnectionOption: React.FC<{ title: string; description: string; icon: React.ReactElement; onSelect: () => void; }> = ({ title, description, icon, onSelect }) => (
  <button
    onClick={onSelect}
    className="w-full text-left p-4 bg-bg-tertiary/50 hover:bg-bg-tertiary rounded-lg transition-all border border-border-primary hover:border-accent flex items-start space-x-3"
  >
    <div className="flex-shrink-0 text-accent bg-accent/20 rounded-lg p-2">{icon}</div>
    <div>
      <h3 className="text-base font-bold text-text-primary">{title}</h3>
      <p className="text-xs text-text-secondary mt-1">{description}</p>
    </div>
  </button>
);

const LoginForm: React.FC<{
  connectionType: ConnectionType;
  onLogin: (homeserverUrl: string, username: string, password: string) => Promise<void>;
  isLoading: boolean;
  error: string | null;
  onBack: () => void;
  onSwitchToRegister: () => void;
}> = ({ connectionType, onLogin, isLoading, error, onBack, onSwitchToRegister }) => {
  const [homeserverUrl, setHomeserverUrl] = useState(getDefaultHomeserver(connectionType));
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const isSelfHosted = connectionType === 'selfhosted';

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    onLogin(homeserverUrl, username, password);
  };

  return (
    <div className="animate-fade-in-fast">
      <button onClick={onBack} className="flex items-center text-sm text-text-accent hover:underline mb-3">
        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-1" viewBox="0 0 20 20" fill="currentColor">
          <path fillRule="evenodd" d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z" clipRule="evenodd" />
        </svg>
        Назад
      </button>
      <form className="space-y-4" onSubmit={handleSubmit}>
        <div className="-space-y-px">
          <div>
            <label htmlFor="homeserver" className="sr-only">Homeserver URL</label>
            <input
              id="homeserver"
              name="homeserver"
              type="text"
              required
              readOnly={!isSelfHosted}
              className="appearance-none rounded-none relative block w-full px-3 py-2 border border-border-primary bg-bg-secondary text-text-primary placeholder-text-secondary rounded-t-md focus:outline-none focus:ring-ring-focus focus:border-ring-focus focus:z-10 sm:text-sm read-only:bg-bg-tertiary"
              placeholder={isSelfHosted ? 'example.com, @user:domain или https://host:8448' : 'Homeserver URL'}
              value={homeserverUrl}
              onChange={(e) => setHomeserverUrl(e.target.value)}
            />
            {isSelfHosted && (
              <p className="mt-2 text-xs text-text-secondary">
                Введите домен, Matrix ID или IP-адрес с портом. Например: matrix.example.com, 10.0.0.5:8448, @alice:example.com
              </p>
            )}
          </div>
          <div>
            <label htmlFor="username" className="sr-only">Username</label>
            <input
              id="username"
              name="username"
              type="text"
              autoComplete="username"
              required
              className="appearance-none rounded-none relative block w-full px-3 py-2 border border-border-primary bg-bg-secondary text-text-primary placeholder-text-secondary focus:outline-none focus:ring-ring-focus focus:border-ring-focus focus:z-10 sm:text-sm"
              placeholder="Username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
          </div>
          <div>
            <label htmlFor="password" className="sr-only">Password</label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              className="appearance-none rounded-none relative block w-full px-3 py-2 border border-border-primary bg-bg-secondary text-text-primary placeholder-text-secondary rounded-b-md focus:outline-none focus:ring-ring-focus focus:border-ring-focus focus:z-10 sm:text-sm"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
        </div>
        {error && <p className="text-error text-sm text-center">{error}</p>}
        <div>
          <button
            type="submit"
            disabled={isLoading || !homeserverUrl}
            className="group relative w-full flex justify-center py-2 px-4 border border-transparent text-sm font-medium rounded-md text-text-inverted bg-accent hover:bg-accent-hover focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-ring-focus disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isLoading ? (
              <>
                <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-text-inverted" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                Вход...
              </>
            ) : 'Войти'}
          </button>
        </div>
        <p className="text-xs text-center text-text-secondary">
          Нет аккаунта?{' '}
          <button type="button" className="text-text-accent hover:underline" onClick={onSwitchToRegister}>
            Зарегистрироваться
          </button>
        </p>
      </form>
    </div>
  );
};

const RegisterForm: React.FC<{
  connectionType: ConnectionType;
  onRegister: (homeserverUrl: string, username: string, password: string) => Promise<void>;
  isLoading: boolean;
  error: string | null;
  onBack: () => void;
  onSwitchToLogin: () => void;
}> = ({ connectionType, onRegister, isLoading, error, onBack, onSwitchToLogin }) => {
  const [homeserverUrl, setHomeserverUrl] = useState(getDefaultHomeserver(connectionType));
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    setLocalError(null);
    if (password !== confirmPassword) {
      setLocalError('Пароли не совпадают.');
      return;
    }
    onRegister(homeserverUrl, username, password);
  };

  const readOnly = connectionType !== 'selfhosted';

  return (
    <div className="animate-fade-in-fast">
      <button onClick={onBack} className="flex items-center text-sm text-text-accent hover:underline mb-3">
        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-1" viewBox="0 0 20 20" fill="currentColor">
          <path fillRule="evenodd" d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z" clipRule="evenodd" />
        </svg>
        Назад
      </button>
      <form className="space-y-4" onSubmit={handleSubmit}>
        <div className="-space-y-px">
          <div>
            <label htmlFor="register-homeserver" className="sr-only">Homeserver URL</label>
            <input
              id="register-homeserver"
              name="homeserver"
              type="text"
              required
              readOnly={readOnly}
              className="appearance-none rounded-none relative block w-full px-3 py-2 border border-border-primary bg-bg-secondary text-text-primary placeholder-text-secondary rounded-t-md focus:outline-none focus:ring-ring-focus focus:border-ring-focus focus:z-10 sm:text-sm read-only:bg-bg-tertiary"
              placeholder="Homeserver URL"
              value={homeserverUrl}
              onChange={(e) => setHomeserverUrl(e.target.value)}
            />
          </div>
          <div>
            <label htmlFor="register-username" className="sr-only">Username</label>
            <input
              id="register-username"
              name="username"
              type="text"
              autoComplete="username"
              required
              className="appearance-none rounded-none relative block w-full px-3 py-2 border border-border-primary bg-bg-secondary text-text-primary placeholder-text-secondary focus:outline-none focus:ring-ring-focus focus:border-ring-focus focus:z-10 sm:text-sm"
              placeholder="Username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
          </div>
          <div>
            <label htmlFor="register-password" className="sr-only">Password</label>
            <input
              id="register-password"
              name="password"
              type="password"
              autoComplete="new-password"
              required
              className="appearance-none rounded-none relative block w-full px-3 py-2 border border-border-primary bg-bg-secondary text-text-primary placeholder-text-secondary focus:outline-none focus:ring-ring-focus focus:border-ring-focus focus:z-10 sm:text-sm"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <div>
            <label htmlFor="register-password-confirm" className="sr-only">Confirm password</label>
            <input
              id="register-password-confirm"
              name="confirmPassword"
              type="password"
              autoComplete="new-password"
              required
              className="appearance-none rounded-none relative block w-full px-3 py-2 border border-border-primary bg-bg-secondary text-text-primary placeholder-text-secondary rounded-b-md focus:outline-none focus:ring-ring-focus focus:border-ring-focus focus:z-10 sm:text-sm"
              placeholder="Повторите пароль"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
            />
          </div>
        </div>
        {(localError || error) && <p className="text-error text-sm text-center">{localError || error}</p>}
        <div>
          <button
            type="submit"
            disabled={isLoading || !homeserverUrl}
            className="group relative w-full flex justify-center py-2 px-4 border border-transparent text-sm font-medium rounded-md text-text-inverted bg-accent hover:bg-accent-hover focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-ring-focus disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isLoading ? (
              <>
                <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-text-inverted" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                Регистрация...
              </>
            ) : 'Создать аккаунт'}
          </button>
        </div>
        <p className="text-xs text-center text-text-secondary">
          Уже есть учётная запись?{' '}
          <button type="button" className="text-text-accent hover:underline" onClick={onSwitchToLogin}>
            Войти
          </button>
        </p>
      </form>
    </div>
  );
};

const LoginPage: React.FC<LoginPageProps> = ({ onLoginSuccess, initialError, savedAccounts = [], isEmbedded }) => {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(initialError);
  const [connectionType, setConnectionType] = useState<ConnectionType | null>(null);
  const [mode, setMode] = useState<AuthMode>('choose');

  useEffect(() => setError(initialError), [initialError]);

  const handleLogin = async (homeserverInput: string, username: string, password: string) => {
    setError(null);
    setIsLoading(true);
    try {
      const baseUrl = await resolveHomeserverBaseUrl(homeserverInput);
      const client = await login(baseUrl, username, password);
      onLoginSuccess(client);
    } catch (err: any) {
      console.error(err);
      if (err instanceof HomeserverDiscoveryError) setError(err.message);
      else if (err.message?.includes('M_FORBIDDEN')) setError('Неверный логин или пароль.');
      else if (err.message?.includes('M_UNKNOWN_TOKEN')) setError('Токен недействителен.');
      else setError(err.message || 'Вход не выполнен.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleRegister = async (homeserverUrl: string, username: string, password: string) => {
    setError(null);
    setIsLoading(true);
    try {
      const client = await registerAccount(homeserverUrl, username, password);
      onLoginSuccess(client);
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'Регистрация не выполнена.');
    } finally {
      setIsLoading(false);
    }
  };

  const resetToChoose = () => {
    setError(null);
    setConnectionType(null);
    setMode('choose');
  };

  const SavedList = () => {
    if (!savedAccounts.length) return null;
    return (
      <div className="mt-3">
        <h4 className="text-sm font-semibold mb-2">Сохранённые аккаунты</h4>
        <ul className="space-y-2">
          {savedAccounts.map(a => (
            <li key={a.key} className="text-xs text-text-secondary break-all border border-border-primary rounded p-2">
              {a.user_id} — {a.homeserver_url}
            </li>
          ))}
        </ul>
      </div>
    );
  };

  const renderContent = () => {
    if (connectionType && mode === 'login') {
      return (
        <LoginForm
          connectionType={connectionType}
          onLogin={handleLogin}
          isLoading={isLoading}
          error={error}
          onBack={resetToChoose}
          onSwitchToRegister={() => {
            setError(null);
            setMode('register');
          }}
        />
      );
    }

    if (connectionType && mode === 'register') {
      return (
        <RegisterForm
          connectionType={connectionType}
          onRegister={handleRegister}
          isLoading={isLoading}
          error={error}
          onBack={resetToChoose}
          onSwitchToLogin={() => {
            setError(null);
            setMode('login');
          }}
        />
      );
    }

    return (
      <div className="space-y-4 animate-fade-in-fast">
        {!isEmbedded && (
          <div className="text-center">
            <h2 className="text-2xl font-extrabold text-text-primary">Connect to Matrix</h2>
            <p className="mt-2 text-text-secondary">Добавьте новый аккаунт или войдите впервые.</p>
          </div>
        )}
        <div className="space-y-3">
          <ConnectionOption
            title="Matrix.org"
            description="Быстрый вход на публичный сервер."
            icon={<svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>}
            onSelect={() => {
              setConnectionType('public');
              setMode('login');
            }}
          />
          <ConnectionOption
            title="Secure Cloud"
            description="Наш управляемый сервер с расширенной защитой."
            icon={<svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 10-9.78 2.096A4.001 4.001 0 003 15z" /></svg>}
            onSelect={() => {
              setConnectionType('secure');
              setMode('login');
            }}
          />
          <ConnectionOption
            title="Ваш сервер"
            description="Подключение к собственному homeserver'у."
            icon={<svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2m-2-4h.01M17 16h.01" /></svg>}
            onSelect={() => {
              setConnectionType('selfhosted');
              setMode('login');
            }}
          />
        </div>
        <SavedList />
        {initialError && !error && <p className="text-error text-sm text-center">{initialError}</p>}
      </div>
    );
  };

  return (
    <div className={`flex items-center justify-center ${isEmbedded ? '' : 'h-full'} bg-bg-secondary`}>
      <div className={`w-full ${isEmbedded ? 'max-w-none' : 'max-w-md'} p-6 space-y-6 bg-bg-primary rounded-lg shadow-lg`}>
        {renderContent()}
      </div>
    </div>
  );
};

export default LoginPage;
