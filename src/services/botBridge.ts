import type { MatrixEvent } from '../types';

export interface BotBridgeConfig {
    baseUrl: string;
    accessToken?: string;
    timeoutMs?: number;
    headers?: Record<string, string>;
}

const DEFAULT_TIMEOUT_MS = 15000;

let activeConfig: BotBridgeConfig | null = null;

export class BotBridgeError extends Error {
    public readonly status: number;
    public readonly method: string;
    public readonly url: string;
    public readonly payload?: unknown;

    public constructor(method: string, url: string, status: number, message: string, payload?: unknown) {
        super(message);
        this.name = 'BotBridgeError';
        this.method = method;
        this.url = url;
        this.status = status;
        this.payload = payload;
    }
}

const resolveConfig = (overrides?: Partial<BotBridgeConfig>): BotBridgeConfig => {
    const base = activeConfig ?? undefined;
    const baseUrl = overrides?.baseUrl ?? base?.baseUrl;
    if (!baseUrl) {
        throw new Error('Bot bridge baseUrl is not configured. Call configureBotBridge() first or provide overrides.');
    }

    return {
        baseUrl,
        accessToken: overrides?.accessToken ?? base?.accessToken,
        timeoutMs: overrides?.timeoutMs ?? base?.timeoutMs,
        headers: { ...(base?.headers ?? {}), ...(overrides?.headers ?? {}) },
    };
};

const buildUrl = (baseUrl: string, path: string): string => {
    try {
        if (/^https?:\/\//i.test(path)) {
            return path;
        }
        const normalized = path.startsWith('/') ? path : `/${path}`;
        const url = new URL(normalized, baseUrl);
        return url.toString();
    } catch (error) {
        throw new Error(`Failed to build bot bridge URL: ${error instanceof Error ? error.message : String(error)}`);
    }
};

const parseErrorResponse = async (response: Response): Promise<{ message: string; payload?: unknown }> => {
    const contentType = response.headers.get('content-type') || '';
    try {
        if (contentType.includes('application/json')) {
            const data = await response.json();
            const message = typeof data.error === 'string'
                ? data.error
                : typeof data.message === 'string'
                    ? data.message
                    : response.statusText;
            return { message, payload: data };
        }
        const text = await response.text();
        return { message: text || response.statusText };
    } catch (error) {
        return { message: response.statusText };
    }
};

const performRequest = async <T>(
    method: string,
    path: string,
    body?: unknown,
    overrides?: Partial<BotBridgeConfig>,
): Promise<T> => {
    const config = resolveConfig(overrides);
    const url = buildUrl(config.baseUrl, path);
    const controller = new AbortController();
    const timeout = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const timeoutHandle = setTimeout(() => controller.abort(), timeout);

    try {
        const headers = new Headers({ Accept: 'application/json', ...(config.headers ?? {}) });
        let requestBody: BodyInit | undefined;
        if (body !== undefined) {
            headers.set('Content-Type', 'application/json');
            requestBody = JSON.stringify(body);
        }
        if (config.accessToken) {
            headers.set('Authorization', `Bearer ${config.accessToken}`);
        }

        const response = await fetch(url, {
            method,
            headers,
            body: requestBody,
            signal: controller.signal,
        });

        if (!response.ok) {
            const { message, payload } = await parseErrorResponse(response);
            throw new BotBridgeError(method, url, response.status, message, payload);
        }

        if (response.status === 204) {
            return undefined as unknown as T;
        }

        const text = await response.text();
        if (!text) {
            return undefined as unknown as T;
        }
        return JSON.parse(text) as T;
    } catch (error) {
        if (error instanceof BotBridgeError) {
            throw error;
        }
        if ((error as any)?.name === 'AbortError') {
            throw new BotBridgeError(method, url, 0, 'Bot bridge request timed out');
        }
        throw new BotBridgeError(method, url, 0, error instanceof Error ? error.message : String(error));
    } finally {
        clearTimeout(timeoutHandle);
    }
};

export const configureBotBridge = (config: BotBridgeConfig): void => {
    activeConfig = { ...config };
};

export const getBotBridgeConfig = (): BotBridgeConfig | null => {
    return activeConfig ? { ...activeConfig, headers: { ...(activeConfig.headers ?? {}) } } : null;
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
}

export const listBots = (overrides?: Partial<BotBridgeConfig>): Promise<BotDefinition[]> => {
    return performRequest<BotDefinition[]>('GET', '/bots', undefined, overrides);
};

export const getBot = (botId: string, overrides?: Partial<BotBridgeConfig>): Promise<BotDefinition> => {
    return performRequest<BotDefinition>('GET', `/bots/${encodeURIComponent(botId)}`, undefined, overrides);
};

export const createBot = (payload: CreateBotPayload, overrides?: Partial<BotBridgeConfig>): Promise<BotDefinition> => {
    return performRequest<BotDefinition>('POST', '/bots', payload, overrides);
};

export const updateBot = (
    botId: string,
    payload: UpdateBotPayload,
    overrides?: Partial<BotBridgeConfig>,
): Promise<BotDefinition> => {
    return performRequest<BotDefinition>('PATCH', `/bots/${encodeURIComponent(botId)}`, payload, overrides);
};

export const deleteBot = (botId: string, overrides?: Partial<BotBridgeConfig>): Promise<void> => {
    return performRequest<void>('DELETE', `/bots/${encodeURIComponent(botId)}`, undefined, overrides);
};

export const sendBotCommand = (
    botId: string,
    command: string,
    payload?: Record<string, unknown>,
    overrides?: Partial<BotBridgeConfig>,
): Promise<BotExecutionResult> => {
    return performRequest<BotExecutionResult>(
        'POST',
        `/bots/${encodeURIComponent(botId)}/commands/${encodeURIComponent(command)}`,
        payload,
        overrides,
    );
};

const serializeMatrixEvent = (event: MatrixEvent) => {
    const eventId = event.getId();
    return {
        event_id: eventId ?? undefined,
        room_id: event.getRoomId(),
        sender: event.getSender(),
        type: event.getType(),
        origin_server_ts: event.getTs(),
        content: event.getContent(),
        unsigned: event.getUnsigned?.(),
    };
};

export const pushMatrixEventToBot = (
    botId: string,
    event: MatrixEvent,
    overrides?: Partial<BotBridgeConfig>,
): Promise<BotExecutionResult> => {
    return performRequest<BotExecutionResult>(
        'POST',
        `/bots/${encodeURIComponent(botId)}/events`,
        serializeMatrixEvent(event),
        overrides,
    );
};

export const pingBot = (
    botId: string,
    overrides?: Partial<BotBridgeConfig>,
): Promise<BotExecutionResult> => {
    return performRequest<BotExecutionResult>(
        'POST',
        `/bots/${encodeURIComponent(botId)}/ping`,
        undefined,
        overrides,
    );
};
