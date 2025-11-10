import React, { useState, FormEvent, useEffect } from 'react';
import type { MatrixClient, SecureCloudProfile, SecureCloudDetector } from '@matrix-messenger/core';
import {
  login,
  resolveHomeserverBaseUrl,
  HomeserverDiscoveryError,
  register as registerAccount,
  TotpRequiredError,
  type LoginOptions,
  getSecureCloudDetectorCatalog,
} from '@matrix-messenger/core';
import ServerDeploymentWizard from './ServerDeploymentWizard';
import { useAccountStore, createAccountKey } from '../services/accountManager';
import {
  listPasskeyDevices,
  removePasskeyDevice,
  savePasskeyDevice,
  touchPasskeyDevice,
  type StoredPasskeyDevice,
} from '../services/passkeyStore';

interface LoginPageProps {
  onLoginSuccess?: (client: MatrixClient) => void;
  initialError?: string | null;
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

const deriveAccountKey = (homeserverUrl: string, username: string): string | null => {
  const trimmedHomeserver = homeserverUrl.trim();
  const trimmedUsername = username.trim();
  if (!trimmedHomeserver || !trimmedUsername) return null;
  try {
    const url = new URL(trimmedHomeserver);
    const hasDomain = trimmedUsername.includes(':');
    const normalisedUserId = hasDomain
      ? trimmedUsername.startsWith('@')
        ? trimmedUsername
        : `@${trimmedUsername}`
      : `@${trimmedUsername.replace(/^@/, '')}:${url.host}`;
    return createAccountKey({ homeserver_url: trimmedHomeserver, user_id: normalisedUserId, access_token: '' });
  } catch {
    return null;
  }
};

const describePasskeyType = (value?: string | null): string => {
  switch (value) {
    case 'security-key':
      return 'Аппаратный ключ';
    case 'webauthn':
      return 'WebAuthn';
    case 'passkey':
    default:
      return 'Passkey';
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
  onLogin: (homeserverUrl: string, username: string, password: string, options?: LoginOptions) => Promise<void>;
  isLoading: boolean;
  error: string | null;
  onBack: () => void;
  onSwitchToRegister: () => void;
  totpRequired: boolean;
  totpCode: string;
  onTotpCodeChange: (value: string) => void;
  totpValidationError: string | null;
  onResetTotp: () => void;
}> = ({
  connectionType,
  onLogin,
  isLoading,
  error,
  onBack,
  onSwitchToRegister,
  totpRequired,
  totpCode,
  onTotpCodeChange,
  totpValidationError,
  onResetTotp,
}) => {
  const [homeserverUrl, setHomeserverUrl] = useState(getDefaultHomeserver(connectionType));
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const isSelfHosted = connectionType === 'selfhosted';


  // Secure Cloud controls
  const detectorCatalog = React.useMemo<SecureCloudDetector[]>(() => {
    try {
      return getSecureCloudDetectorCatalog().filter((detector) => detector.type === 'ml' || detector.type === 'llm');
    } catch {
      return [];
    }
  }, []);
  const defaultModelMapping = React.useMemo<Record<string, string>>(() => {
    const mapping: Record<string, string> = {};
    detectorCatalog.forEach((detector) => {
      if (Array.isArray(detector.models) && detector.models.length > 0) {
        mapping[detector.id] = detector.models[0].id;
      }
    });
    return mapping;
  }, [detectorCatalog]);
  const [useSecureCloud, setUseSecureCloud] = useState(connectionType === 'secure');
  const [secureApiUrl, setSecureApiUrl] = useState(getDefaultHomeserver(connectionType));
  const [metadataToken, setMetadataToken] = useState('');
  const [enablePremium, setEnablePremium] = useState(false);
  const [enableAnalytics, setEnableAnalytics] = useState(false);
  const [analyticsToken, setAnalyticsToken] = useState('');
  const [riskThreshold, setRiskThreshold] = useState('0.6');
  const [retentionDays, setRetentionDays] = useState('30');
  const [selectedModels, setSelectedModels] = useState<Record<string, string>>(defaultModelMapping);
  const [userSensitivity, setUserSensitivity] = useState<'low' | 'medium' | 'high'>('medium');
  const [organizationSensitivity, setOrganizationSensitivity] = useState<'low' | 'medium' | 'high'>('medium');

  const [passkeyDevices, setPasskeyDevices] = useState<StoredPasskeyDevice[]>([]);
  const [passkeyLoading, setPasskeyLoading] = useState(false);
  const [passkeyError, setPasskeyError] = useState<string | null>(null);

  const refreshPasskeys = useCallback(async () => {
    const key = deriveAccountKey(homeserverUrl, username);
    if (!key) {
      setPasskeyDevices([]);
      setPasskeyError(null);
      return;
    }
    setPasskeyLoading(true);
    try {
      const devices = await listPasskeyDevices(key);
      setPasskeyDevices(devices);
      setPasskeyError(null);
    } catch (err: any) {
      setPasskeyDevices([]);
      setPasskeyError(err?.message ? `Не удалось загрузить passkey: ${err.message}` : 'Не удалось загрузить passkey.');
    } finally {
      setPasskeyLoading(false);
    }
  }, [homeserverUrl, username]);

  useEffect(() => {
    void refreshPasskeys();
  }, [refreshPasskeys]);

  const handleRemovePasskey = useCallback(
    async (credentialId: string) => {
      const key = deriveAccountKey(homeserverUrl, username);
      if (!key) return;
      try {
        await removePasskeyDevice(key, credentialId);
        await refreshPasskeys();
      } catch (err) {
        console.warn('Failed to remove passkey device', err);
      }
    },
    [homeserverUrl, username, refreshPasskeys],
  );

  const shouldShowPasskeys = Boolean(homeserverUrl.trim() && username.trim());
  const hasAccountKey = shouldShowPasskeys && deriveAccountKey(homeserverUrl, username) !== null;

  // Reset form fields when connection type changes
  useEffect(() => {
    const defaultHs = getDefaultHomeserver(connectionType);
    setHomeserverUrl(defaultHs);
    const managed = connectionType === 'secure';
    setUseSecureCloud(managed);
    setSecureApiUrl(defaultHs); // mirror homeserver by default
    setMetadataToken('');
    setEnablePremium(false);
    setEnableAnalytics(false);
    setAnalyticsToken('');
    setRiskThreshold('0.6');
    setRetentionDays('30');
    setSelectedModels(defaultModelMapping);
    setUserSensitivity('medium');
    setOrganizationSensitivity('medium');
    onResetTotp();
  }, [connectionType, defaultModelMapping, onResetTotp]);

  // Load saved Secure Cloud settings on mount or connectionType change.
  // Ignore for public servers.
  useEffect(() => {
    if (connectionType === 'public') return;
    try {
      const raw = localStorage.getItem('secure-cloud-settings');
      if (!raw) return;
      const data = JSON.parse(raw);
      // Simple schema guard
      if (typeof data !== 'object' || data === null) return;
      const getBool = (v, d=false) => typeof v === 'boolean' ? v : d;
      const getStr = (v, d='') => typeof v === 'string' ? v : d;
      const parseSensitivity = (value: unknown): 'low' | 'medium' | 'high' => {
        if (value === 'low' || value === 'medium' || value === 'high') return value;
        if (typeof value === 'string') {
          const lowered = value.toLowerCase();
          if (lowered === 'low' || lowered === 'medium' || lowered === 'high') {
            return lowered as 'low' | 'medium' | 'high';
          }
        }
        return 'medium';
      };
      const next = {
        useSecureCloud: getBool(data.useSecureCloud, connectionType === 'secure'),
        secureApiUrl: getStr(data.secureApiUrl, getDefaultHomeserver(connectionType)),
        metadataToken: getStr(data.metadataToken, ''),
        enablePremium: getBool(data.enablePremium, false),
        enableAnalytics: getBool(data.enableAnalytics, false),
        analyticsToken: getStr(data.analyticsToken, ''),
        riskThreshold: (() => {
          if (typeof data.riskThreshold === 'number' && isFinite(data.riskThreshold)) return String(data.riskThreshold);
          if (typeof data.riskThreshold === 'string' && data.riskThreshold.trim()) return data.riskThreshold.trim();
          return '0.6';
        })(),
        retentionDays: (() => {
          if (typeof data.retentionDays === 'number' && Number.isFinite(data.retentionDays)) {
            return String(data.retentionDays);
          }
          if (typeof data.retentionDays === 'string' && data.retentionDays.trim()) {
            return data.retentionDays.trim();
          }
          return '30';
        })(),
        selectedModels: (() => {
          if (typeof data.selectedModels === 'object' && data.selectedModels) {
            const entries = Object.entries(data.selectedModels as Record<string, unknown>)
              .filter(([key, value]) => typeof key === 'string' && typeof value === 'string');
            return Object.fromEntries(entries) as Record<string, string>;
          }
          return {} as Record<string, string>;
        })(),
        userSensitivity: parseSensitivity((data as any).userSensitivity),
        organizationSensitivity: parseSensitivity((data as any).organizationSensitivity),
      };
      setUseSecureCloud(next.useSecureCloud);
      setSecureApiUrl(next.secureApiUrl);
      setMetadataToken(next.metadataToken);
      setEnablePremium(next.enablePremium);
      setEnableAnalytics(next.enableAnalytics);
      setAnalyticsToken(next.analyticsToken);
      setRiskThreshold(next.riskThreshold);
      setRetentionDays(next.retentionDays);
      setSelectedModels({ ...defaultModelMapping, ...next.selectedModels });
      setUserSensitivity(next.userSensitivity);
      setOrganizationSensitivity(next.organizationSensitivity);
    } catch {
      // Ignore malformed JSON
    }
  }, [connectionType, defaultModelMapping]);

  // Persist settings when they change. Skip for public servers.
  useEffect(() => {
    if (connectionType === 'public') return;
    const persistedModels = Object.fromEntries(
      Object.entries(selectedModels).filter(([_, value]) => typeof value === 'string' && value.length > 0),
    );
    const payload = {
      useSecureCloud,
      secureApiUrl,
      metadataToken,
      enablePremium,
      enableAnalytics,
      analyticsToken,
      riskThreshold,
      retentionDays,
      selectedModels: persistedModels,
      userSensitivity,
      organizationSensitivity,
    };
    try {
      localStorage.setItem('secure-cloud-settings', JSON.stringify(payload));
    } catch {
      // Storage may be unavailable (private mode). Ignore.
    }
  }, [connectionType, useSecureCloud, secureApiUrl, metadataToken, enablePremium, enableAnalytics, analyticsToken, riskThreshold, retentionDays, selectedModels, userSensitivity, organizationSensitivity]);


  
  // Persist current Secure Cloud settings to localStorage
  function persistSecureSettings() {
    if (connectionType === 'public') return;
    const persistedModels = Object.fromEntries(
      Object.entries(selectedModels).filter(([_, value]) => typeof value === 'string' && value.length > 0),
    );
    const payload = {
      useSecureCloud,
      secureApiUrl,
      metadataToken,
      enablePremium,
      enableAnalytics,
      analyticsToken,
      riskThreshold,
      retentionDays,
      selectedModels: persistedModels,
      userSensitivity,
      organizationSensitivity,
    };
    try {
      localStorage.setItem('secure-cloud-settings', JSON.stringify(payload));
    } catch {}
  }
const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const thresholdValue = Number.parseFloat(riskThreshold);
    const normalisedThreshold = Number.isFinite(thresholdValue)
      ? Math.min(1, Math.max(0, thresholdValue))
      : 0.6;
    const retentionValue = (() => {
      const parsed = Number.parseInt(retentionDays, 10);
      return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
    })();
    const modelOverrides = Object.fromEntries(
      Object.entries(selectedModels).filter(([_, value]) => typeof value === 'string' && value.length > 0),
    );

    const shouldAttachSecure = connectionType === 'secure' || useSecureCloud;
    const secureProfile: SecureCloudProfile | undefined = shouldAttachSecure
      ? {
          mode: connectionType === 'secure' ? 'managed' : 'self-hosted',
          apiBaseUrl: (secureApiUrl || homeserverUrl).trim(),
          metadataToken: metadataToken.trim() ? metadataToken.trim() : undefined,
          analyticsToken: enableAnalytics ? (analyticsToken.trim() || undefined) : undefined,
          enablePremium,
          enableAnalytics,
          riskThreshold: normalisedThreshold,
          retentionPeriodDays: retentionValue,
          detectorModels: Object.keys(modelOverrides).length > 0 ? modelOverrides : undefined,
          userSensitivity,
          organizationSensitivity,
        }
      : undefined;

    const options = secureProfile ? { secureProfile } : undefined;

    onLogin(homeserverUrl, username, password, options)
      .then(() => { try { persistSecureSettings(); } catch {} });
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
        {totpRequired && (
          <div className="space-y-2 border border-border-primary rounded-md p-3 bg-bg-tertiary/30">
            <div>
              <label htmlFor="totp" className="block text-xs font-medium text-text-secondary uppercase">Код 2FA (TOTP)</label>
              <input
                id="totp"
                name="totp"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]*"
                className="mt-1 block w-full rounded-md border border-border-primary bg-bg-secondary px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-ring-focus focus:border-ring-focus"
                placeholder="123 456"
                value={totpCode}
                onChange={(e) => onTotpCodeChange(e.target.value)}
                required
                disabled={isLoading}
              />
            </div>
            <p className="text-xs text-text-secondary">
              Введите код из приложения-аутентификатора. Если код истёк, дождитесь следующего и попробуйте снова.
            </p>
            {totpValidationError && (
              <p className="text-xs text-error" role="alert">{totpValidationError}</p>
            )}
          </div>
        )}
        {shouldShowPasskeys && (
          <div className="space-y-2 border border-border-primary rounded-md p-3 bg-bg-tertiary/30">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold uppercase tracking-wide text-text-primary">Passkey устройства</span>
              <button
                type="button"
                className="text-text-accent hover:underline disabled:opacity-50"
                onClick={() => void refreshPasskeys()}
                disabled={passkeyLoading || !hasAccountKey}
              >
                Обновить
              </button>
            </div>
            {passkeyError && <p className="text-xs text-error" role="alert">{passkeyError}</p>}
            {passkeyLoading ? (
              <p className="text-xs text-text-secondary">Загрузка списка устройств...</p>
            ) : passkeyDevices.length > 0 ? (
              <ul className="space-y-2 text-xs">
                {passkeyDevices.map((device) => (
                  <li key={device.credentialId} className="flex items-start justify-between gap-2">
                    <div>
                      <div className="font-medium text-text-primary">{device.label}</div>
                      <div className="text-text-secondary">
                        {describePasskeyType((device as any).deviceType ?? (device as any).device_type)} ·{' '}
                        {device.lastUsedAt
                          ? new Date(device.lastUsedAt).toLocaleString()
                          : 'ещё не использовалось'}
                      </div>
                    </div>
                    <button
                      type="button"
                      className="text-red-400 hover:underline disabled:opacity-40"
                      onClick={() => void handleRemovePasskey(device.credentialId)}
                      disabled={passkeyLoading}
                    >
                      Удалить
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-text-secondary">
                Passkey устройства для этой учётной записи не найдены.
              </p>
            )}
            <p className="text-[11px] text-text-secondary leading-snug">
              Passkey будет запрошен автоматически, когда сервер потребует подтверждение WebAuthn вместе с паролем.
            </p>
          </div>
        )}
        {(connectionType === 'secure' || connectionType === 'selfhosted') && (
          <div className="space-y-3 border border-border-primary rounded-md p-3 bg-bg-tertiary/30">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm font-semibold text-text-primary">Secure Cloud фильтрация</p>
                <p className="text-xs text-text-secondary mt-1">
                  Локальные правила анализируют незашифрованные комнаты и отправляют только метаданные в облако.
                </p>
              </div>
              <label className="flex items-center space-x-2 text-xs">
                <input
                  type="checkbox"
                  className="form-checkbox h-4 w-4 text-accent"
                  disabled={connectionType === 'secure'}
                  checked={useSecureCloud}
                  onChange={(e) => setUseSecureCloud(e.target.checked)}
                />
                <span className="uppercase tracking-wide text-text-secondary">
                  {connectionType === 'secure' ? 'Вкл.' : 'Включить'}
                </span>
              </label>
            </div>
            {useSecureCloud && (
              <div className="space-y-2">
                <div>
                  <label htmlFor="secure-api" className="block text-xs font-medium text-text-secondary uppercase">Secure Cloud API</label>
                  <input
                    id="secure-api"
                    name="secure-api"
                    type="url"
                    className="mt-1 block w-full rounded-md border border-border-primary bg-bg-secondary px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-ring-focus focus:border-ring-focus"
                    placeholder="https://secure-cloud.api.yourcompany.com"
                    value={secureApiUrl}
                    onChange={(e) => setSecureApiUrl(e.target.value)}
                    required={connectionType === 'secure'}
                  />
                </div>
                <div>
                  <label htmlFor="metadata-token" className="block text-xs font-medium text-text-secondary uppercase">Метаданные: токен</label>
                  <input
                    id="metadata-token"
                    name="metadata-token"
                    type="text"
                    className="mt-1 block w-full rounded-md border border-border-primary bg-bg-secondary px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-ring-focus focus:border-ring-focus"
                    placeholder="Bearer токен от Secure Cloud"
                    value={metadataToken}
                    onChange={(e) => setMetadataToken(e.target.value)}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <label className="flex items-center space-x-2 text-sm text-text-primary">
                    <input
                      type="checkbox"
                      className="form-checkbox h-4 w-4 text-accent"
                      checked={enablePremium}
                      onChange={(e) => setEnablePremium(e.target.checked)}
                    />
                    <span>Премиум-функции (анализ ссылок, превентивные баны)</span>
                  </label>
                </div>
                <div className="space-y-2">
                  <label className="flex items-center space-x-2 text-sm text-text-primary">
                    <input
                      type="checkbox"
                      className="form-checkbox h-4 w-4 text-accent"
                      checked={enableAnalytics}
                      onChange={(e) => setEnableAnalytics(e.target.checked)}
                    />
                    <span>Включить аналитику администраторов</span>
                  </label>
                  {enableAnalytics && (
                    <input
                      type="text"
                      className="block w-full rounded-md border border-border-primary bg-bg-secondary px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-ring-focus focus:border-ring-focus"
                      placeholder="Analytics token"
                      value={analyticsToken}
                      onChange={(e) => setAnalyticsToken(e.target.value)}
                    />
                  )}
                </div>
                <div>
                  <label htmlFor="risk-threshold" className="block text-xs font-medium text-text-secondary uppercase">Порог риска (0-1)</label>
                  <input
                    id="risk-threshold"
                    name="risk-threshold"
                    type="number"
                    min={0}
                    max={1}
                    step={0.05}
                    className="mt-1 block w-full rounded-md border border-border-primary bg-bg-secondary px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-ring-focus focus:border-ring-focus"
                    value={riskThreshold}
                    onChange={(e) => setRiskThreshold(e.target.value)}
                  />
                </div>
                <div>
                  <label htmlFor="retention-days" className="block text-xs font-medium text-text-secondary uppercase">Политика хранения предупреждений</label>
                  <select
                    id="retention-days"
                    name="retention-days"
                    className="mt-1 block w-full rounded-md border border-border-primary bg-bg-secondary px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-ring-focus focus:border-ring-focus"
                    value={retentionDays}
                    onChange={(e) => setRetentionDays(e.target.value)}
                  >
                    <option value="0">Не хранить</option>
                    <option value="7">7 дней</option>
                    <option value="30">30 дней</option>
                    <option value="90">90 дней</option>
                    <option value="180">180 дней</option>
                  </select>
                </div>
                <div className="grid gap-2 md:grid-cols-2">
                  <div>
                    <label htmlFor="user-sensitivity" className="block text-xs font-medium text-text-secondary uppercase">Чувствительность пользователя</label>
                    <select
                      id="user-sensitivity"
                      className="mt-1 block w-full rounded-md border border-border-primary bg-bg-secondary px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-ring-focus focus:border-ring-focus"
                      value={userSensitivity}
                      onChange={(e) => setUserSensitivity(e.target.value as 'low' | 'medium' | 'high')}
                    >
                      <option value="low">Низкая</option>
                      <option value="medium">Средняя</option>
                      <option value="high">Высокая</option>
                    </select>
                  </div>
                  <div>
                    <label htmlFor="org-sensitivity" className="block text-xs font-medium text-text-secondary uppercase">Чувствительность организации</label>
                    <select
                      id="org-sensitivity"
                      className="mt-1 block w-full rounded-md border border-border-primary bg-bg-secondary px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-ring-focus focus:border-ring-focus"
                      value={organizationSensitivity}
                      onChange={(e) => setOrganizationSensitivity(e.target.value as 'low' | 'medium' | 'high')}
                    >
                      <option value="low">Низкая</option>
                      <option value="medium">Средняя</option>
                      <option value="high">Высокая</option>
                    </select>
                  </div>
                </div>
                {detectorCatalog.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-xs font-semibold uppercase text-text-secondary">Модели детекторов</p>
                    {detectorCatalog.map((detector) => (
                      <div key={detector.id} className="space-y-1">
                        <label className="block text-xs font-medium text-text-secondary uppercase" htmlFor={`detector-model-${detector.id}`}>
                          {detector.displayName}
                        </label>
                        <select
                          id={`detector-model-${detector.id}`}
                          className="block w-full rounded-md border border-border-primary bg-bg-secondary px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-ring-focus focus:border-ring-focus"
                          value={selectedModels[detector.id] ?? ''}
                          onChange={(e) => setSelectedModels((prev) => ({ ...prev, [detector.id]: e.target.value }))}
                        >
                          {(detector.models ?? []).map((model) => (
                            <option key={model.id} value={model.id}>
                              {model.label} ({model.provider})
                            </option>
                          ))}
                          {(!detector.models || detector.models.length === 0) && (
                            <option value="">Нет доступных моделей</option>
                          )}
                        </select>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
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

const LoginPage: React.FC<LoginPageProps> = ({ onLoginSuccess, initialError, savedAccounts: savedAccountsProp, isEmbedded }) => {
  const addAccount = useAccountStore(state => state.addClientAccount);
  const savedAccountsFromStore = useAccountStore(state => Object.values(state.accounts).map(a => a.creds));
  const storeError = useAccountStore(state => state.error);
  const setStoreError = useAccountStore(state => state.setError);

  const resolvedOnLoginSuccess = onLoginSuccess ?? addAccount;
  const savedAccounts = savedAccountsProp ?? savedAccountsFromStore;
  const initialErrorValue = initialError ?? storeError ?? null;

  const [isLoading, setIsLoading] = useState(false);
  const [error, setErrorState] = useState<string | null>(initialErrorValue);
  const [connectionType, setConnectionType] = useState<ConnectionType | null>(null);
  const [mode, setMode] = useState<AuthMode>('choose');
  const [showDeploymentWizard, setShowDeploymentWizard] = useState(false);
  const [totpRequired, setTotpRequired] = useState(false);
  const [totpSessionId, setTotpSessionId] = useState<string | null>(null);
  const [totpCode, setTotpCode] = useState('');
  const [totpValidationError, setTotpValidationError] = useState<string | null>(null);

  const resetTotpState = () => {
    setTotpRequired(false);
    setTotpSessionId(null);
    setTotpCode('');
    setTotpValidationError(null);
  };

  const handleTotpCodeChange = (value: string) => {
    setTotpCode(value);
    if (totpValidationError) {
      setTotpValidationError(null);
      applyError(null);
    }
  };

  const applyError = (value: string | null) => {
    setErrorState(value);
    setStoreError(value);
  };

  useEffect(() => {
    applyError(initialErrorValue);
  }, [initialErrorValue]);

  const persistPasskeyRecord = useCallback(
    async (
      client: MatrixClient,
      details: PasskeyAssertionDetails | PasskeyAttestationDetails | null,
    ) => {
      if (!details) return;
      try {
        const homeserver = client.getHomeserverUrl?.() ?? '';
        const userId = client.getUserId?.() ?? '';
        if (!homeserver || !userId) return;
        const accountKey = createAccountKey({
          homeserver_url: homeserver,
          user_id: userId,
          access_token: client.getAccessToken?.() ?? '',
        });
        const existing = await listPasskeyDevices(accountKey);
        const deviceType = details.stage === 'm.login.passkey' ? 'passkey' : 'webauthn';
        const now = Date.now();
        const matched = existing.find(device => device.credentialId === details.credentialId);
        if (matched) {
          await touchPasskeyDevice(accountKey, details.credentialId);
          return;
        }
        const labelBase = deviceType === 'passkey' ? 'Passkey' : 'WebAuthn';
        await savePasskeyDevice(accountKey, {
          credentialId: details.credentialId,
          userId,
          label: `${labelBase} ${existing.length + 1}`,
          addedAt: now,
          lastUsedAt: now,
          transports: details.transports ?? undefined,
          deviceType,
        });
      } catch (err) {
        console.warn('Failed to persist passkey metadata', err);
      }
    },
    [],
  );

  const handleLogin = async (
    homeserverInput: string,
    username: string,
    password: string,
    loginOptions?: LoginOptions,
  ) => {
    applyError(null);
    setTotpValidationError(null);
    setIsLoading(true);
    let capturedPasskey: PasskeyAssertionDetails | null = null;
    try {
      const baseUrl = await resolveHomeserverBaseUrl(homeserverInput);
      const options: LoginOptions = {};
      if (loginOptions?.secureProfile) options.secureProfile = loginOptions.secureProfile;
      const trimmedTotp = totpCode.trim();
      if (trimmedTotp) {
        options.totpCode = trimmedTotp;
        if (totpSessionId) options.totpSessionId = totpSessionId;
      }
      options.onPasskeyAssertion = (details) => {
        capturedPasskey = details;
        loginOptions?.onPasskeyAssertion?.(details);
      };

      const client = Object.keys(options).length
        ? await login(baseUrl, username, password, options)
        : await login(baseUrl, username, password);
      await persistPasskeyRecord(client, capturedPasskey);
      await resolvedOnLoginSuccess(client);
      resetTotpState();
    } catch (err: any) {
      console.error(err);
      if (err instanceof HomeserverDiscoveryError) {
        resetTotpState();
        applyError(err.message);
      } else if (err instanceof TotpRequiredError) {
        setTotpRequired(true);
        setTotpSessionId(err.sessionId ?? totpSessionId);
        if (!err.isValidationError) {
          setTotpCode('');
        }
        const validationMessage = err.message || 'Неверный одноразовый код или код истёк.';
        setTotpValidationError(err.isValidationError ? validationMessage : null);
        applyError(validationMessage);
      } else if (err.message?.includes('M_FORBIDDEN')) {
        resetTotpState();
        applyError('Неверный логин или пароль.');
      } else if (err.message?.includes('M_UNKNOWN_TOKEN')) {
        resetTotpState();
        applyError('Токен недействителен.');
      } else {
        resetTotpState();
        applyError(err.message || 'Вход не выполнен.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleRegister = async (homeserverUrl: string, username: string, password: string) => {
    applyError(null);
    setIsLoading(true);
    let capturedAttestation: PasskeyAttestationDetails | null = null;
    let capturedAssertion: PasskeyAssertionDetails | null = null;
    try {
      const registerOptions: RegisterOptions = {
        onPasskeyAttestation: (details) => {
          capturedAttestation = details;
        },
        onPasskeyAssertion: (details) => {
          capturedAssertion = details;
        },
      };
      const client = await registerAccount(homeserverUrl, username, password, registerOptions);
      await persistPasskeyRecord(client, capturedAttestation);
      await persistPasskeyRecord(client, capturedAssertion);
      await resolvedOnLoginSuccess(client);
    } catch (err: any) {
      console.error(err);
      applyError(err.message || 'Регистрация не выполнена.');
    } finally {
      setIsLoading(false);
    }
  };

  const resetToChoose = () => {
    applyError(null);
    resetTotpState();
    setConnectionType(null);
    setMode('choose');
  };

  const handleDeploymentComplete = async (homeserverUrl: string, username: string, password: string) => {
    setShowDeploymentWizard(false);
    await handleLogin(homeserverUrl, username, password);
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
            applyError(null);
            resetTotpState();
            setMode('register');
          }}
          totpRequired={totpRequired}
          totpCode={totpCode}
          onTotpCodeChange={handleTotpCodeChange}
          totpValidationError={totpValidationError}
          onResetTotp={resetTotpState}
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
            applyError(null);
            resetTotpState();
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
              resetTotpState();
              setConnectionType('public');
              setMode('login');
            }}
          />
          <ConnectionOption
            title="Secure Cloud"
            description="Наш управляемый сервер с расширенной защитой."
            icon={<svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 10-9.78 2.096A4.001 4.001 0 003 15z" /></svg>}
            onSelect={() => {
              resetTotpState();
              setConnectionType('secure');
              setMode('login');
            }}
          />
          <ConnectionOption
            title="Существующий сервер"
            description="Подключиться к уже установленному Matrix серверу (требуется URL)"
            icon={<svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2m-2-4h.01M17 16h.01" /></svg>}
            onSelect={() => {
              resetTotpState();
              setConnectionType('selfhosted');
              setMode('login');
            }}
          />
        </div>

        <div className="relative">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-border-secondary"></div>
          </div>
          <div className="relative flex justify-center text-sm">
            <span className="px-2 bg-bg-primary text-text-secondary">or</span>
          </div>
        </div>

        <button
          onClick={() => {
            resetTotpState();
            applyError(null);
            setShowDeploymentWizard(true);
          }}
          className="w-full flex flex-col items-center justify-center gap-2 px-4 py-4 bg-gradient-to-r from-indigo-600 to-purple-600 text-white rounded-lg hover:from-indigo-700 hover:to-purple-700 transition-all shadow-lg"
        >
          <div className="flex items-center gap-2">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
            </svg>
            <span className="font-semibold">Развернуть новый сервер</span>
          </div>
          <span className="text-xs text-indigo-200">Автоматическая установка Matrix на ваш VPS (5-10 мин)</span>
        </button>
        <SavedList />
        {initialErrorValue && !error && <p className="text-error text-sm text-center">{initialErrorValue}</p>}
      </div>
    );
  };

  return (
    <>
      <div className={`flex items-center justify-center ${isEmbedded ? '' : 'h-full'} bg-bg-secondary`}>
        <div className={`w-full ${isEmbedded ? 'max-w-none' : 'max-w-md'} p-6 space-y-6 bg-bg-primary rounded-lg shadow-lg`}>
          {renderContent()}
        </div>
      </div>

      {showDeploymentWizard && (
        <ServerDeploymentWizard
          onClose={() => setShowDeploymentWizard(false)}
          onDeploymentComplete={handleDeploymentComplete}
        />
      )}
    </>
  );
};

export default LoginPage;
