import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
    BotBridgeAuthScheme,
    BotBridgeConnectorManifest,
    BotBridgeConnectorConfig,
    getBotBridgeConfig,
    listConnectorConfigs,
    loadConnectorManifest,
    setDefaultConnector,
    updateConnectorAuth,
} from '../services/botBridge';
import {
    PersistedConnectorSecrets,
    clearConnectorSecrets,
    loadConnectorSecrets,
    mergeConnectorAuthState,
    saveConnectorSecrets,
} from '../services/botBridgeSecretsStore';

const statusChipClasses: Record<'connected' | 'disconnected' | 'error' | 'loading', string> = {
    connected: 'bg-emerald-100 text-emerald-900 border border-emerald-400',
    disconnected: 'bg-slate-100 text-slate-700 border border-slate-300',
    error: 'bg-rose-100 text-rose-900 border border-rose-400',
    loading: 'bg-amber-100 text-amber-900 border border-amber-400',
};

interface BotBridgeSettingsModalProps {
    open: boolean;
    onClose: () => void;
}

type ConnectorFormState = {
    scheme: BotBridgeAuthScheme;
    apiKey?: string;
    clientId?: string;
    clientSecret?: string;
    accessToken?: string;
    refreshToken?: string;
    metadata?: Record<string, unknown>;
};

const resolveStatus = (
    manifest: BotBridgeConnectorManifest | undefined,
    secrets: PersistedConnectorSecrets | null,
    error?: string | null,
    loading?: boolean,
) => {
    if (loading) {
        return { label: 'Загрузка…', tone: 'loading' as const };
    }
    if (error) {
        return { label: error, tone: 'error' as const };
    }
    if (!manifest) {
        return { label: 'Манифест не загружен', tone: 'error' as const };
    }
    if (manifest.auth === 'none') {
        return { label: 'Не требует подключения', tone: 'connected' as const };
    }
    const connected = Boolean(
        secrets?.apiKey?.trim() ||
        secrets?.accessToken?.trim() ||
        secrets?.refreshToken?.trim(),
    );
    return connected
        ? { label: 'Подключено', tone: 'connected' as const }
        : { label: 'Не подключено', tone: 'disconnected' as const };
};

const describeAuth = (manifest: BotBridgeConnectorManifest | undefined): string => {
    if (!manifest) return 'Неизвестная схема авторизации';
    switch (manifest.auth) {
        case 'none':
            return 'Подключение не требуется';
        case 'api_key':
            return manifest.apiKey?.helpText ?? 'Требуется API ключ для доступа к платформе.';
        case 'oauth2':
            return 'Поддерживается OAuth 2.0. Укажите параметры приложения и обновляйте токены при необходимости.';
        default:
            return 'Неизвестная схема авторизации';
    }
};

const mergeFormState = (
    manifest: BotBridgeConnectorManifest | undefined,
    connector: BotBridgeConnectorConfig,
    secrets: PersistedConnectorSecrets | null,
): ConnectorFormState => {
    const scheme = manifest?.auth ?? connector.auth?.scheme ?? 'none';
    const state: ConnectorFormState = {
        scheme,
        apiKey: secrets?.apiKey ?? connector.auth?.apiKey,
        clientId: secrets?.clientId ?? connector.auth?.clientId,
        clientSecret: secrets?.clientSecret ?? connector.auth?.clientSecret,
        accessToken: secrets?.accessToken ?? connector.auth?.accessToken,
        refreshToken: secrets?.refreshToken ?? connector.auth?.refreshToken,
        metadata: { ...(connector.auth?.metadata ?? {}), ...(secrets?.metadata ?? {}) },
    };
    return state;
};

const buildSecretsPayload = (
    manifest: BotBridgeConnectorManifest,
    state: ConnectorFormState,
): PersistedConnectorSecrets => {
    const payload: PersistedConnectorSecrets = {
        scheme: manifest.auth,
        apiKey: state.apiKey?.trim() || undefined,
        clientId: state.clientId?.trim() || undefined,
        clientSecret: state.clientSecret?.trim() || undefined,
        accessToken: state.accessToken?.trim() || undefined,
        refreshToken: state.refreshToken?.trim() || undefined,
        metadata: state.metadata ? { ...state.metadata } : undefined,
    };

    if (manifest.apiKey?.header && payload.apiKey) {
        payload.headers = { [manifest.apiKey.header]: payload.apiKey };
    }

    return payload;
};

const ConnectorHeader: React.FC<{ connector: BotBridgeConnectorConfig; manifest?: BotBridgeConnectorManifest | null }>
    = ({ connector, manifest }) => (
        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div>
                <h3 className="text-lg font-semibold text-text-primary">
                    {manifest?.displayName ?? connector.metadata?.displayName ?? connector.id}
                </h3>
                {(manifest?.description || connector.metadata?.description) && (
                    <p className="text-sm text-text-secondary">
                        {manifest?.description ?? connector.metadata?.description}
                    </p>
                )}
            </div>
        </div>
    );

const FieldLabel: React.FC<{ htmlFor: string; children: React.ReactNode }>
    = ({ htmlFor, children }) => (
        <label htmlFor={htmlFor} className="block text-xs font-medium uppercase tracking-wide text-text-tertiary">
            {children}
        </label>
    );

const TextInput: React.FC<{
    id: string;
    value?: string;
    placeholder?: string;
    onChange: (value: string) => void;
    type?: string;
}> = ({ id, value, placeholder, onChange, type = 'text' }) => (
    <input
        id={id}
        value={value ?? ''}
        type={type}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="mt-1 w-full rounded-md border border-border-primary bg-surface-primary px-3 py-2 text-sm text-text-primary shadow-sm focus:border-accent-primary focus:outline-none focus:ring-2 focus:ring-accent-primary/40"
    />
);

const CapabilityPill: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <span className="inline-flex items-center rounded-full bg-surface-tertiary px-3 py-1 text-xs font-medium text-text-secondary">
        {children}
    </span>
);

const BotBridgeSettingsModal: React.FC<BotBridgeSettingsModalProps> = ({ open, onClose }) => {
    const [connectors, setConnectors] = useState<BotBridgeConnectorConfig[]>([]);
    const [manifests, setManifests] = useState<Record<string, BotBridgeConnectorManifest | null>>({});
    const [secrets, setSecrets] = useState<Record<string, PersistedConnectorSecrets | null>>({});
    const [errors, setErrors] = useState<Record<string, string | null>>({});
    const [loadingMap, setLoadingMap] = useState<Record<string, boolean>>({});
    const [formState, setFormState] = useState<Record<string, ConnectorFormState>>({});
    const [defaultConnectorId, setDefaultConnectorIdState] = useState<string | undefined>(() => getBotBridgeConfig()?.defaultConnectorId);

    const refreshConnectors = useCallback(async () => {
        const configConnectors = listConnectorConfigs();
        setConnectors(configConnectors);
        setDefaultConnectorIdState(getBotBridgeConfig()?.defaultConnectorId);
        const nextManifests: Record<string, BotBridgeConnectorManifest | null> = {};
        const nextSecrets: Record<string, PersistedConnectorSecrets | null> = {};
        const nextForm: Record<string, ConnectorFormState> = {};
        const nextErrors: Record<string, string | null> = {};
        const nextLoading: Record<string, boolean> = {};

        await Promise.all(configConnectors.map(async (connector) => {
            nextLoading[connector.id] = true;
            try {
                const manifest = await loadConnectorManifest(connector.id).catch((error) => {
                    console.warn('Failed to load connector manifest', connector.id, error);
                    nextErrors[connector.id] = error instanceof Error ? error.message : String(error);
                    return null;
                });
                nextManifests[connector.id] = manifest;

                const storedSecrets = await loadConnectorSecrets(connector.id);
                nextSecrets[connector.id] = storedSecrets;

                const mergedAuth = mergeConnectorAuthState(connector.auth, storedSecrets);
                if (mergedAuth) {
                    updateConnectorAuth(connector.id, mergedAuth);
                }
                const state = mergeFormState(manifest ?? undefined, connector, storedSecrets);
                nextForm[connector.id] = state;
            } finally {
                nextLoading[connector.id] = false;
            }
        }));

        setManifests(nextManifests);
        setSecrets(nextSecrets);
        setErrors(nextErrors);
        setLoadingMap(nextLoading);
        setFormState(nextForm);
    }, []);

    useEffect(() => {
        if (!open) {
            return;
        }
        void refreshConnectors();
    }, [open, refreshConnectors]);

    const handleInputChange = useCallback((connectorId: string, partial: Partial<ConnectorFormState>) => {
        setFormState((prev) => ({
            ...prev,
            [connectorId]: { ...prev[connectorId], ...partial },
        }));
    }, []);

    const handleMetadataChange = useCallback((connectorId: string, key: string, value: string) => {
        setFormState((prev) => ({
            ...prev,
            [connectorId]: {
                ...prev[connectorId],
                metadata: { ...(prev[connectorId]?.metadata ?? {}), [key]: value },
            },
        }));
    }, []);

    const handleSave = useCallback(async (connectorId: string) => {
        const manifest = manifests[connectorId];
        const state = formState[connectorId];
        if (!manifest || !state) return;

        const payload = buildSecretsPayload(manifest, state);
        await saveConnectorSecrets(connectorId, payload);
        setSecrets((prev) => ({ ...prev, [connectorId]: payload }));
        const resolvedAuth = mergeConnectorAuthState(undefined, payload);
        if (resolvedAuth) {
            updateConnectorAuth(connectorId, resolvedAuth);
        }
    }, [formState, manifests]);

    const handleDisconnect = useCallback(async (connectorId: string) => {
        await clearConnectorSecrets(connectorId);
        setSecrets((prev) => ({ ...prev, [connectorId]: null }));
        const manifest = manifests[connectorId] ?? undefined;
        const baseConnector = connectors.find((item) => item.id === connectorId);
        if (baseConnector) {
            setFormState((prev) => ({
                ...prev,
                [connectorId]: mergeFormState(manifest, baseConnector, null),
            }));
        }
        updateConnectorAuth(connectorId, null);
    }, [manifests, connectors]);

    const handleSetDefault = useCallback((connectorId: string) => {
        setDefaultConnectorId(connectorId);
        setDefaultConnectorIdState(connectorId);
    }, []);

    const hasConnectors = connectors.length > 0;

    const modalContent = useMemo(() => {
        if (!hasConnectors) {
            return (
                <div className="py-12 text-center text-sm text-text-secondary">
                    Нет доступных коннекторов. Добавьте описание в конфигурации botBridge.
                </div>
            );
        }

        return connectors.map((connector) => {
            const manifest = manifests[connector.id] ?? undefined;
            const connectorSecrets = secrets[connector.id] ?? null;
            const status = resolveStatus(manifest, connectorSecrets, errors[connector.id], loadingMap[connector.id]);
            const state = formState[connector.id];

            return (
                <div key={connector.id} className="rounded-lg border border-border-secondary bg-surface-primary p-5 shadow-sm">
                    <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                        <div className="flex-1">
                            <ConnectorHeader connector={connector} manifest={manifest ?? null} />
                        </div>
                        <div className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ${statusChipClasses[status.tone]}`}>
                            {status.label}
                        </div>
                    </div>

                    <div className="mt-4 space-y-4">
                        {manifest?.capabilities?.length ? (
                            <div>
                                <FieldLabel htmlFor={`${connector.id}-capabilities`}>Возможности</FieldLabel>
                                <div className="mt-2 flex flex-wrap gap-2">
                                    {manifest.capabilities.map((capability) => (
                                        <CapabilityPill key={capability}>{capability}</CapabilityPill>
                                    ))}
                                </div>
                            </div>
                        ) : null}

                        <div>
                            <FieldLabel htmlFor={`${connector.id}-auth`}>Авторизация</FieldLabel>
                            <p className="mt-1 text-sm text-text-secondary">{describeAuth(manifest)}</p>
                        </div>

                        {manifest?.auth === 'api_key' && state && (
                            <div>
                                <FieldLabel htmlFor={`${connector.id}-api-key`}>API ключ</FieldLabel>
                                <TextInput
                                    id={`${connector.id}-api-key`}
                                    value={state.apiKey}
                                    placeholder="sk_live_xxxxxxxxx"
                                    onChange={(value) => handleInputChange(connector.id, { apiKey: value })}
                                />
                            </div>
                        )}

                        {manifest?.auth === 'oauth2' && state && (
                            <div className="grid gap-4 md:grid-cols-2">
                                <div>
                                    <FieldLabel htmlFor={`${connector.id}-client-id`}>Client ID</FieldLabel>
                                    <TextInput
                                        id={`${connector.id}-client-id`}
                                        value={state.clientId}
                                        placeholder="пример: a1b2c3"
                                        onChange={(value) => handleInputChange(connector.id, { clientId: value })}
                                    />
                                </div>
                                <div>
                                    <FieldLabel htmlFor={`${connector.id}-client-secret`}>Client Secret</FieldLabel>
                                    <TextInput
                                        id={`${connector.id}-client-secret`}
                                        value={state.clientSecret}
                                        placeholder="секрет приложения"
                                        onChange={(value) => handleInputChange(connector.id, { clientSecret: value })}
                                    />
                                </div>
                                <div>
                                    <FieldLabel htmlFor={`${connector.id}-access-token`}>Access Token</FieldLabel>
                                    <TextInput
                                        id={`${connector.id}-access-token`}
                                        value={state.accessToken}
                                        placeholder="Bearer токен"
                                        onChange={(value) => handleInputChange(connector.id, { accessToken: value })}
                                    />
                                </div>
                                <div>
                                    <FieldLabel htmlFor={`${connector.id}-refresh-token`}>Refresh Token</FieldLabel>
                                    <TextInput
                                        id={`${connector.id}-refresh-token`}
                                        value={state.refreshToken}
                                        placeholder="Опционально"
                                        onChange={(value) => handleInputChange(connector.id, { refreshToken: value })}
                                    />
                                </div>
                            </div>
                        )}

                        {manifest?.customFields?.length && state ? (
                            <div className="grid gap-4 md:grid-cols-2">
                                {manifest.customFields.map((field) => (
                                    <div key={field.id}>
                                        <FieldLabel htmlFor={`${connector.id}-${field.id}`}>{field.label}</FieldLabel>
                                        <TextInput
                                            id={`${connector.id}-${field.id}`}
                                            value={String(state.metadata?.[field.id] ?? '')}
                                            placeholder={field.description}
                                            onChange={(value) => handleMetadataChange(connector.id, field.id, value)}
                                        />
                                        {field.description && (
                                            <p className="mt-1 text-xs text-text-tertiary">{field.description}</p>
                                        )}
                                    </div>
                                ))}
                            </div>
                        ) : null}

                        <div className="flex flex-col gap-3 border-t border-border-secondary pt-4 md:flex-row md:items-center md:justify-between">
                            <div className="flex items-center gap-2">
                                <input
                                    id={`${connector.id}-default`}
                                    type="radio"
                                    name="botbridge-default-connector"
                                    checked={defaultConnectorId === connector.id}
                                    onChange={() => handleSetDefault(connector.id)}
                                    className="h-4 w-4 text-accent-primary focus:ring-accent-primary"
                                />
                                <label htmlFor={`${connector.id}-default`} className="text-sm text-text-secondary">
                                    Использовать по умолчанию
                                </label>
                            </div>

                            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                                <button
                                    type="button"
                                    className="inline-flex items-center justify-center rounded-md border border-border-secondary px-4 py-2 text-sm font-medium text-text-secondary transition hover:border-border-primary hover:text-text-primary"
                                    onClick={() => handleDisconnect(connector.id)}
                                >
                                    Отключить
                                </button>
                                <button
                                    type="button"
                                    className="inline-flex items-center justify-center rounded-md bg-accent-primary px-4 py-2 text-sm font-semibold text-white transition hover:bg-accent-primary/90"
                                    onClick={() => handleSave(connector.id)}
                                >
                                    Сохранить настройки
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            );
        });
    }, [connectors, manifests, secrets, errors, loadingMap, formState, defaultConnectorId, handleInputChange, handleMetadataChange, handleSetDefault, handleSave, handleDisconnect, hasConnectors]);

    if (!open) {
        return null;
    }

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
            <div className="relative max-h-[90vh] w-full max-w-4xl overflow-hidden rounded-xl bg-surface-primary shadow-xl">
                <header className="flex items-start justify-between border-b border-border-secondary px-6 py-4">
                    <div>
                        <h2 className="text-xl font-semibold text-text-primary">Подключение коннекторов</h2>
                        <p className="mt-1 text-sm text-text-secondary">
                            Управляйте BotBridge коннекторами, настраивайте OAuth/API ключи и отслеживайте состояние подключений.
                        </p>
                    </div>
                    <button
                        type="button"
                        aria-label="Закрыть"
                        className="rounded-md p-2 text-text-tertiary transition hover:bg-surface-tertiary hover:text-text-primary"
                        onClick={onClose}
                    >
                        ✕
                    </button>
                </header>

                <div className="max-h-[70vh] overflow-y-auto px-6 py-5">
                    <div className="flex flex-col gap-5">
                        {modalContent}
                    </div>
                </div>

                <footer className="flex items-center justify-end gap-3 border-t border-border-secondary bg-surface-secondary px-6 py-4">
                    <button
                        type="button"
                        className="rounded-md border border-border-secondary px-4 py-2 text-sm font-medium text-text-secondary hover:border-border-primary hover:text-text-primary"
                        onClick={onClose}
                    >
                        Закрыть
                    </button>
                </footer>
            </div>
        </div>
    );
};

export default BotBridgeSettingsModal;
