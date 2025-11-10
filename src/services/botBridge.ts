import type { MatrixEvent } from '../types';

export type BotBridgeAuthScheme = 'none' | 'api_key' | 'oauth2';

export interface BotBridgeRetryConfig {
    maxAttempts: number;
    initialDelayMs: number;
    maxDelayMs: number;
    backoffFactor: number;
    retryOn: Array<number | 'timeout' | 'network'>;
}

export interface BotBridgeConnectorManifest {
    id: string;
    displayName: string;
    description?: string;
    iconUrl?: string;
    capabilities: string[];
    webhookEvents?: Array<{
        event: string;
        description?: string;
        path: string;
        secretHeader?: string;
    }>;
    auth: BotBridgeAuthScheme;
    oauth?: {
        authorizeUrl: string;
        tokenUrl: string;
        scopes?: string[];
        redirectUri?: string;
        pkce?: boolean;
    };
    apiKey?: {
        header?: string;
        queryParam?: string;
        helpText?: string;
    };
    customFields?: Array<{
        id: string;
        label: string;
        required?: boolean;
        description?: string;
    }>;
}

export interface BotBridgeConnectorAuthState {
    scheme: BotBridgeAuthScheme;
    accessToken?: string;
    refreshToken?: string;
    expiresAt?: number;
    tokenType?: string;
    apiKey?: string;
    headers?: Record<string, string>;
    clientId?: string;
    clientSecret?: string;
    metadata?: Record<string, unknown>;
}

export interface BotBridgeConnectorConfig {
    id: string;
    baseUrl: string;
    manifestUrl?: string;
    manifest?: BotBridgeConnectorManifest;
    timeoutMs?: number;
    headers?: Record<string, string>;
    retry?: Partial<BotBridgeRetryConfig>;
    auth?: BotBridgeConnectorAuthState;
    metadata?: Record<string, unknown>;
}

export interface BotBridgeConfig {
    connectors: Record<string, BotBridgeConnectorConfig>;
    defaultConnectorId?: string;
    defaultTimeoutMs?: number;
    defaultRetry?: Partial<BotBridgeRetryConfig>;
    headers?: Record<string, string>;
}

export interface BotBridgeRequestOptions extends Partial<Omit<BotBridgeConnectorConfig, 'id' | 'manifest'>> {
    connectorId?: string;
    retry?: Partial<BotBridgeRetryConfig>;
    auth?: Partial<BotBridgeConnectorAuthState>;
    signal?: AbortSignal;
}

const DEFAULT_TIMEOUT_MS = 15000;
const DEFAULT_RETRY_CONFIG: BotBridgeRetryConfig = {
    maxAttempts: 3,
    initialDelayMs: 400,
    maxDelayMs: 10_000,
    backoffFactor: 2,
    retryOn: ['network', 'timeout', 408, 425, 429, 500, 502, 503, 504],
};

let activeConfig: BotBridgeConfig | null = null;

const cloneHeaders = (value?: Record<string, string>): Record<string, string> | undefined => {
    if (!value) return undefined;
    return Object.keys(value).reduce<Record<string, string>>((acc, key) => {
        acc[key] = value[key];
        return acc;
    }, {});
};

const mergeRetryConfig = (base: BotBridgeRetryConfig, overrides?: Partial<BotBridgeRetryConfig>): BotBridgeRetryConfig => ({
    maxAttempts: overrides?.maxAttempts ?? base.maxAttempts,
    initialDelayMs: overrides?.initialDelayMs ?? base.initialDelayMs,
    maxDelayMs: overrides?.maxDelayMs ?? base.maxDelayMs,
    backoffFactor: overrides?.backoffFactor ?? base.backoffFactor,
    retryOn: overrides?.retryOn ?? base.retryOn,
});

const computeRetryDelay = (config: BotBridgeRetryConfig, attempt: number, retryAfterMs?: number | null): number => {
    if (retryAfterMs != null && retryAfterMs > 0) {
        return Math.min(retryAfterMs, config.maxDelayMs);
    }
    const baseDelay = config.initialDelayMs * Math.pow(config.backoffFactor, attempt - 1);
    return Math.min(baseDelay, config.maxDelayMs);
};

const sleep = (ms: number): Promise<void> => new Promise((resolve) => {
    setTimeout(resolve, ms);
});

export class BotBridgeError extends Error {
    public readonly status: number;
    public readonly method: string;
    public readonly url: string;
    public readonly payload?: unknown;
    public readonly connectorId?: string;
    public readonly retryAfterMs?: number | null;
    public readonly attempt: number;
    public readonly maxAttempts: number;

    public constructor(
        method: string,
        url: string,
        status: number,
        message: string,
        payload: unknown,
        attempt: number,
        maxAttempts: number,
        connectorId?: string,
        retryAfterMs?: number | null,
    ) {
        super(message);
        this.name = 'BotBridgeError';
        this.method = method;
        this.url = url;
        this.status = status;
        this.payload = payload;
        this.attempt = attempt;
        this.maxAttempts = maxAttempts;
        this.connectorId = connectorId;
        this.retryAfterMs = retryAfterMs ?? null;
    }
}

const resolveConnector = (options?: BotBridgeRequestOptions): BotBridgeConnectorConfig => {
    if (!activeConfig) {
        throw new Error('Bot bridge is not configured. Call configureBotBridge() first.');
    }

    const connectorId = options?.connectorId ?? activeConfig.defaultConnectorId;
    if (!connectorId) {
        throw new Error('Bot bridge connector is not specified. Provide connectorId in request options or configure defaultConnectorId.');
    }

    const baseConnector = activeConfig.connectors[connectorId];
    if (!baseConnector) {
        throw new Error(`Unknown bot bridge connector: ${connectorId}`);
    }

    return {
        ...baseConnector,
        ...options,
        id: connectorId,
        headers: { ...(activeConfig.headers ?? {}), ...(baseConnector.headers ?? {}), ...(options?.headers ?? {}) },
        retry: mergeRetryConfig(
            mergeRetryConfig(DEFAULT_RETRY_CONFIG, activeConfig.defaultRetry),
            options?.retry ?? baseConnector.retry,
        ),
        timeoutMs: options?.timeoutMs ?? baseConnector.timeoutMs ?? activeConfig.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS,
        manifest: options?.manifest ?? baseConnector.manifest,
        auth: options?.auth ? { ...(baseConnector.auth ?? { scheme: 'none' }), ...options.auth } : baseConnector.auth,
    };
};

const buildUrl = (baseUrl: string, path: string): string => {
    if (/^https?:\/\//i.test(path)) {
        return path;
    }
    const normalized = path.startsWith('/') ? path : `/${path}`;
    return new URL(normalized, baseUrl).toString();
};

interface ParsedErrorPayload {
    message: string;
    payload?: unknown;
    retryAfterMs?: number | null;
}

const parseErrorResponse = async (response: Response): Promise<ParsedErrorPayload> => {
    const retryAfter = response.headers.get('retry-after');
    let retryAfterMs: number | null = null;
    if (retryAfter) {
        const seconds = Number(retryAfter);
        if (Number.isFinite(seconds)) {
            retryAfterMs = seconds * 1000;
        } else {
            const date = new Date(retryAfter).getTime();
            if (!Number.isNaN(date)) {
                retryAfterMs = date - Date.now();
            }
        }
    }

    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
        try {
            const payload = await response.json();
            const message =
                typeof payload?.error === 'string'
                    ? payload.error
                    : typeof payload?.message === 'string'
                        ? payload.message
                        : response.statusText || 'Unknown bot bridge error';
            return { message, payload, retryAfterMs };
        } catch (error) {
            return { message: response.statusText || String(error), retryAfterMs };
        }
    }

    try {
        const text = await response.text();
        return { message: text || response.statusText, retryAfterMs };
    } catch (error) {
        return { message: response.statusText || String(error), retryAfterMs };
    }
};

const shouldRetry = (error: BotBridgeError, retryConfig: BotBridgeRetryConfig): boolean => {
    if (error.attempt >= retryConfig.maxAttempts) {
        return false;
    }

    const status = error.status;
    const retrySignals = new Set(retryConfig.retryOn);

    if (status === 0) {
        // Network failure
        return retrySignals.has('network') || retrySignals.has('timeout');
    }

    if (retrySignals.has(status)) {
        return true;
    }

    if (status >= 500 && retrySignals.has(500)) {
        return true;
    }

    return false;
};

const normaliseAuthHeaders = (auth?: BotBridgeConnectorAuthState): Record<string, string> => {
    if (!auth) return {};
    const headers: Record<string, string> = { ...(auth.headers ?? {}) };
    if (auth.scheme === 'api_key' && auth.apiKey) {
        headers['x-api-key'] = auth.apiKey;
    }
    if (auth.scheme === 'oauth2' && auth.accessToken) {
        const tokenType = auth.tokenType ?? 'Bearer';
        headers['authorization'] = `${tokenType} ${auth.accessToken}`;
    }
    return headers;
};

const performRequest = async <T>(
    method: string,
    path: string,
    body?: unknown,
    options?: BotBridgeRequestOptions,
): Promise<T> => {
    const connector = resolveConnector(options);
    const url = buildUrl(connector.baseUrl, path);
    const retryConfig = mergeRetryConfig(DEFAULT_RETRY_CONFIG, connector.retry);

    let attempt = 0;
    let lastError: BotBridgeError | null = null;

    while (attempt < retryConfig.maxAttempts) {
        attempt += 1;
        const controller = new AbortController();
        const timeout = connector.timeoutMs ?? DEFAULT_TIMEOUT_MS;
        const timeoutHandle = setTimeout(() => controller.abort(), timeout);

        try {
            const headers = new Headers({
                Accept: 'application/json',
                ...(connector.headers ?? {}),
                ...normaliseAuthHeaders(connector.auth),
            });

            let requestBody: BodyInit | undefined;
            if (body !== undefined) {
                if (body instanceof FormData || body instanceof URLSearchParams || body instanceof Blob) {
                    requestBody = body as BodyInit;
                } else {
                    headers.set('Content-Type', 'application/json');
                    requestBody = JSON.stringify(body);
                }
            }

            const response = await fetch(url, {
                method,
                headers,
                body: requestBody,
                signal: options?.signal ?? controller.signal,
            });

            if (!response.ok) {
                const { message, payload, retryAfterMs } = await parseErrorResponse(response);
                throw new BotBridgeError(method, url, response.status, message, payload, attempt, retryConfig.maxAttempts, connector.id, retryAfterMs);
            }

            if (response.status === 204) {
                return undefined as unknown as T;
            }

            const text = await response.text();
            if (!text) {
                return undefined as unknown as T;
            }
            try {
                return JSON.parse(text) as T;
            } catch (error) {
                throw new BotBridgeError(method, url, response.status, `Failed to parse bot bridge response: ${String(error)}`, text, attempt, retryConfig.maxAttempts, connector.id);
            }
        } catch (error) {
            clearTimeout(timeoutHandle);
            let botError: BotBridgeError;
            if (error instanceof BotBridgeError) {
                botError = error;
            } else if ((error as any)?.name === 'AbortError') {
                botError = new BotBridgeError(method, url, 0, 'Bot bridge request timed out', undefined, attempt, retryConfig.maxAttempts, connector.id);
            } else {
                botError = new BotBridgeError(method, url, 0, error instanceof Error ? error.message : String(error), undefined, attempt, retryConfig.maxAttempts, connector.id);
            }

            lastError = botError;

            if (!shouldRetry(botError, retryConfig)) {
                throw botError;
            }

            const delay = computeRetryDelay(retryConfig, attempt, botError.retryAfterMs);
            await sleep(delay);
        } finally {
            clearTimeout(timeoutHandle);
        }
    }

    if (lastError) {
        throw lastError;
    }

    throw new Error('Bot bridge request failed without error details');
};

const cloneConnector = (connector: BotBridgeConnectorConfig): BotBridgeConnectorConfig => ({
    ...connector,
    headers: cloneHeaders(connector.headers),
    retry: connector.retry ? { ...connector.retry } : undefined,
    auth: connector.auth ? { ...connector.auth, headers: cloneHeaders(connector.auth.headers) } : undefined,
    metadata: connector.metadata ? { ...connector.metadata } : undefined,
    manifest: connector.manifest ? { ...connector.manifest } : undefined,
});

export const configureBotBridge = (config: BotBridgeConfig): void => {
    activeConfig = {
        connectors: Object.values(config.connectors ?? {}).reduce<Record<string, BotBridgeConnectorConfig>>((acc, connector) => {
            acc[connector.id] = cloneConnector(connector);
            return acc;
        }, {}),
        defaultConnectorId: config.defaultConnectorId,
        defaultTimeoutMs: config.defaultTimeoutMs,
        defaultRetry: config.defaultRetry ? { ...config.defaultRetry } : undefined,
        headers: cloneHeaders(config.headers),
    };
};

export const getBotBridgeConfig = (): BotBridgeConfig | null => {
    if (!activeConfig) return null;
    return {
        connectors: Object.values(activeConfig.connectors).reduce<Record<string, BotBridgeConnectorConfig>>((acc, connector) => {
            acc[connector.id] = cloneConnector(connector);
            return acc;
        }, {}),
        defaultConnectorId: activeConfig.defaultConnectorId,
        defaultTimeoutMs: activeConfig.defaultTimeoutMs,
        defaultRetry: activeConfig.defaultRetry ? { ...activeConfig.defaultRetry } : undefined,
        headers: cloneHeaders(activeConfig.headers),
    };
};

export const listConnectorConfigs = (): BotBridgeConnectorConfig[] => {
    if (!activeConfig) return [];
    return Object.values(activeConfig.connectors).map((connector) => cloneConnector(connector));
};

export const getConnectorConfig = (connectorId: string): BotBridgeConnectorConfig | null => {
    if (!activeConfig) return null;
    const connector = activeConfig.connectors[connectorId];
    return connector ? cloneConnector(connector) : null;
};

export const upsertConnectorConfig = (connector: BotBridgeConnectorConfig, setAsDefault = false): void => {
    if (!activeConfig) {
        activeConfig = {
            connectors: {},
        } as BotBridgeConfig;
    }
    activeConfig.connectors[connector.id] = cloneConnector(connector);
    if (setAsDefault) {
        activeConfig.defaultConnectorId = connector.id;
    }
};

export const setDefaultConnector = (connectorId: string | undefined): void => {
    if (!activeConfig) {
        throw new Error('Bot bridge is not configured');
    }
    if (connectorId && !activeConfig.connectors[connectorId]) {
        throw new Error(`Cannot set unknown connector ${connectorId} as default`);
    }
    activeConfig.defaultConnectorId = connectorId;
};

export const updateConnectorAuth = (connectorId: string, auth: BotBridgeConnectorAuthState | null): void => {
    if (!activeConfig) {
        throw new Error('Bot bridge is not configured');
    }
    const connector = activeConfig.connectors[connectorId];
    if (!connector) {
        throw new Error(`Unknown connector: ${connectorId}`);
    }
    connector.auth = auth ? { ...auth, headers: cloneHeaders(auth.headers) } : undefined;
};

export const loadConnectorManifest = async (
    connectorId: string,
    options?: BotBridgeRequestOptions,
): Promise<BotBridgeConnectorManifest> => {
    const connector = resolveConnector({ ...(options ?? {}), connectorId });
    if (connector.manifest) {
        return connector.manifest;
    }
    if (!connector.manifestUrl) {
        throw new Error(`Connector ${connectorId} does not declare manifestUrl`);
    }
    const manifest = await performRequest<BotBridgeConnectorManifest>('GET', connector.manifestUrl, undefined, {
        ...options,
        connectorId,
    });
    if (activeConfig) {
        const stored = activeConfig.connectors[connectorId];
        if (stored) {
            stored.manifest = { ...manifest };
        }
    }
    return manifest;
};

export interface BotDefinition {
    id: string;
    displayName: string;
    description?: string;
    avatarUrl?: string | null;
    webhookUrl?: string;
    capabilities: string[];
    isEnabled: boolean;
    tags?: string[];
    createdAt?: string;
    updatedAt?: string;
    metadata?: Record<string, unknown>;
    connectorId?: string;
}

export interface CreateBotPayload {
    displayName: string;
    description?: string;
    webhookUrl?: string;
    avatarUrl?: string;
    capabilities?: string[];
    tags?: string[];
    metadata?: Record<string, unknown>;
}

export interface UpdateBotPayload extends Partial<CreateBotPayload> {
    isEnabled?: boolean;
}

export interface BotExecutionResult {
    ok: boolean;
    message?: string;
    data?: unknown;
    retryAfterMs?: number | null;
}

export const listBots = (
    options?: BotBridgeRequestOptions,
): Promise<BotDefinition[]> => {
    return performRequest<BotDefinition[]>('GET', '/bots', undefined, options);
};

export const getBot = (
    botId: string,
    options?: BotBridgeRequestOptions,
): Promise<BotDefinition> => {
    return performRequest<BotDefinition>('GET', `/bots/${encodeURIComponent(botId)}`, undefined, options);
};

export const createBot = (
    payload: CreateBotPayload,
    options?: BotBridgeRequestOptions,
): Promise<BotDefinition> => {
    return performRequest<BotDefinition>('POST', '/bots', payload, options);
};

export const updateBot = (
    botId: string,
    payload: UpdateBotPayload,
    options?: BotBridgeRequestOptions,
): Promise<BotDefinition> => {
    return performRequest<BotDefinition>('PATCH', `/bots/${encodeURIComponent(botId)}`, payload, options);
};

export const deleteBot = (
    botId: string,
    options?: BotBridgeRequestOptions,
): Promise<void> => {
    return performRequest<void>('DELETE', `/bots/${encodeURIComponent(botId)}`, undefined, options);
};

export const sendBotCommand = (
    botId: string,
    command: string,
    payload?: Record<string, unknown>,
    options?: BotBridgeRequestOptions,
): Promise<BotExecutionResult> => {
    return performRequest<BotExecutionResult>(
        'POST',
        `/bots/${encodeURIComponent(botId)}/commands/${encodeURIComponent(command)}`,
        payload,
        options,
    );
};

const serializeMatrixEvent = (event: MatrixEvent) => {
    const eventId = event.getId?.();
    return {
        event_id: eventId ?? undefined,
        room_id: event.getRoomId?.(),
        sender: event.getSender?.(),
        type: event.getType?.(),
        origin_server_ts: event.getTs?.(),
        content: event.getContent?.(),
        unsigned: event.getUnsigned?.(),
    };
};

export const pushMatrixEventToBot = (
    botId: string,
    event: MatrixEvent,
    options?: BotBridgeRequestOptions,
): Promise<BotExecutionResult> => {
    return performRequest<BotExecutionResult>(
        'POST',
        `/bots/${encodeURIComponent(botId)}/events`,
        serializeMatrixEvent(event),
        options,
    );
};

export const pingBot = (
    botId: string,
    options?: BotBridgeRequestOptions,
): Promise<BotExecutionResult> => {
    return performRequest<BotExecutionResult>(
        'POST',
        `/bots/${encodeURIComponent(botId)}/ping`,
        undefined,
        options,
    );
};
