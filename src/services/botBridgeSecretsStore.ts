import { secureSecretsStore } from './secureSecretsStore';
import type { BotBridgeConnectorAuthState } from './botBridge';

const STORAGE_PREFIX = 'bot-bridge/connector/';

const buildKey = (connectorId: string): string => `${STORAGE_PREFIX}${connectorId}`;

export interface PersistedConnectorSecrets extends Omit<BotBridgeConnectorAuthState, 'headers'> {
    headers?: Record<string, string>;
}

const serialise = (value: PersistedConnectorSecrets): string => JSON.stringify(value);

const parse = (value: string | null): PersistedConnectorSecrets | null => {
    if (!value) return null;
    try {
        const parsed = JSON.parse(value);
        if (!parsed || typeof parsed !== 'object') return null;
        return parsed as PersistedConnectorSecrets;
    } catch (error) {
        console.warn('Failed to parse connector secrets', error);
        return null;
    }
};

export const loadConnectorSecrets = async (connectorId: string): Promise<PersistedConnectorSecrets | null> => {
    const raw = await secureSecretsStore.get(buildKey(connectorId));
    return parse(raw);
};

export const saveConnectorSecrets = async (
    connectorId: string,
    secrets: PersistedConnectorSecrets,
): Promise<void> => {
    await secureSecretsStore.set(buildKey(connectorId), serialise(secrets));
};

export const clearConnectorSecrets = async (connectorId: string): Promise<void> => {
    await secureSecretsStore.remove(buildKey(connectorId));
};

export const listStoredConnectorIds = async (): Promise<string[]> => {
    const prefix = STORAGE_PREFIX;
    if (typeof localStorage === 'undefined') {
        return [];
    }
    try {
        const keys: string[] = [];
        for (let i = 0; i < localStorage.length; i += 1) {
            const key = localStorage.key(i);
            if (key && key.startsWith(prefix)) {
                keys.push(key.slice(prefix.length));
            }
        }
        return keys;
    } catch (error) {
        console.warn('Failed to enumerate connector secrets keys', error);
        return [];
    }
};

export const mergeConnectorAuthState = (
    base: BotBridgeConnectorAuthState | undefined,
    next: PersistedConnectorSecrets | null,
): BotBridgeConnectorAuthState | undefined => {
    if (!next) return base;
    const merged: BotBridgeConnectorAuthState = {
        scheme: next.scheme,
        accessToken: next.accessToken ?? base?.accessToken,
        refreshToken: next.refreshToken ?? base?.refreshToken,
        expiresAt: next.expiresAt ?? base?.expiresAt,
        tokenType: next.tokenType ?? base?.tokenType,
        apiKey: next.apiKey ?? base?.apiKey,
        headers: { ...(base?.headers ?? {}), ...(next.headers ?? {}) },
        clientId: next.clientId ?? base?.clientId,
        clientSecret: next.clientSecret ?? base?.clientSecret,
        metadata: { ...(base?.metadata ?? {}), ...(next.metadata ?? {}) },
    };
    return merged;
};
