import { MatrixClient, MatrixEvent } from '../types';
import { searchMessages } from './searchService';
import { searchUniversalMessages } from './universalSearchService';
import { getAccountStore } from './accountManager';
import { createStore } from 'zustand/vanilla';
import { useStore } from 'zustand';

const DEFAULT_ACCOUNT_KEY = '__default__';
const DIGEST_DB_NAME = 'matrix-messenger-digests';
const DIGEST_DB_VERSION = 1;
const DIGEST_STORE_NAME = 'digests';
const DIGEST_SETTINGS_KEY = 'matrix-digest-settings';
const TAURI_STORE_FILE = 'digest.store';
const MIN_DIGEST_REFRESH_INTERVAL = 60 * 1000;
const DAILY_NOTIFICATION_INTERVAL = 6 * 60 * 60 * 1000;

const isBrowser = typeof window !== 'undefined';
const isTauri = isBrowser && typeof (window as any).__TAURI_IPC__ !== 'undefined';

type DigestFrequency = 'never' | 'daily' | 'weekly' | 'hourly';

export interface DigestSettings {
    periodicity: DigestFrequency;
    language: string;
    tokenLimit: number;
}

const defaultSettings: DigestSettings = {
    periodicity: 'daily',
    language: '',
    tokenLimit: 512,
};

const env = (typeof import.meta !== 'undefined' ? (import.meta as any).env : undefined)
    || (typeof process !== 'undefined' ? process.env : {});

const resolveEnvString = (key: string): string | undefined => {
    const value = env?.[key];
    return typeof value === 'string' && value.length > 0 ? value : undefined;
};

const resolveEnvNumber = (key: string): number | undefined => {
    const value = resolveEnvString(key);
    if (!value) return undefined;
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
};

const envSummarizerProvider = (resolveEnvString('VITE_DIGEST_SUMMARIZER')
    ?? resolveEnvString('DIGEST_SUMMARIZER')
    ?? 'auto').toLowerCase();
const envSummarizerEndpoint = resolveEnvString('VITE_DIGEST_SUMMARIZER_URL')
    ?? resolveEnvString('DIGEST_SUMMARIZER_URL');
const envSummarizerApiKey = resolveEnvString('VITE_DIGEST_SUMMARIZER_API_KEY')
    ?? resolveEnvString('DIGEST_SUMMARIZER_API_KEY');
const envSummarizerModel = resolveEnvString('VITE_DIGEST_SUMMARIZER_MODEL')
    ?? resolveEnvString('DIGEST_SUMMARIZER_MODEL');
const envSummarizerLanguage = resolveEnvString('VITE_DIGEST_SUMMARIZER_LANGUAGE')
    ?? resolveEnvString('DIGEST_SUMMARIZER_LANGUAGE');
const envSummarizerTokenLimit = resolveEnvNumber('VITE_DIGEST_SUMMARIZER_TOKENS')
    ?? resolveEnvNumber('DIGEST_SUMMARIZER_TOKENS');

const sanitizeSettings = (settings: Partial<DigestSettings>): DigestSettings => {
    const periodicity: DigestFrequency = ['never', 'daily', 'weekly', 'hourly'].includes(
        (settings.periodicity as DigestFrequency) ?? defaultSettings.periodicity,
    )
        ? (settings.periodicity as DigestFrequency)
        : defaultSettings.periodicity;

    const language = typeof settings.language === 'string' ? settings.language.trim() : defaultSettings.language;
    const tokenLimitRaw = typeof settings.tokenLimit === 'number'
        ? settings.tokenLimit
        : Number.parseInt(String(settings.tokenLimit ?? ''), 10);
    const tokenLimit = Number.isFinite(tokenLimitRaw) && tokenLimitRaw > 0
        ? Math.floor(tokenLimitRaw)
        : 0;

    return {
        periodicity,
        language,
        tokenLimit,
    };
};

const settingsEqual = (a: DigestSettings, b: DigestSettings): boolean =>
    a.periodicity === b.periodicity
    && a.language === b.language
    && a.tokenLimit === b.tokenLimit;

const readSettingsFromStorage = (): DigestSettings => {
    if (!isBrowser) {
        return { ...defaultSettings };
    }
    try {
        const raw = window.localStorage?.getItem(DIGEST_SETTINGS_KEY);
        if (!raw) {
            return { ...defaultSettings };
        }
        const parsed = JSON.parse(raw);
        return sanitizeSettings(parsed);
    } catch (error) {
        console.warn('Failed to read digest settings from storage', error);
        return { ...defaultSettings };
    }
};

let currentSettings: DigestSettings = sanitizeSettings({
    ...defaultSettings,
    ...readSettingsFromStorage(),
});

const settingsListeners = new Set<(settings: DigestSettings) => void>();

const emitSettingsUpdate = () => {
    settingsListeners.forEach(listener => {
        try {
            listener(currentSettings);
        } catch (error) {
            console.warn('Digest settings listener failed', error);
        }
    });
};

const resolveTauriInvoke = async (): Promise<(<T>(command: string, payload?: Record<string, unknown>) => Promise<T>) | null> => {
    if (!isTauri) return null;
    try {
        const { invoke } = await import('@tauri-apps/api/core');
        return invoke;
    } catch (error) {
        console.debug('Tauri invoke unavailable for digest service', error);
        return null;
    }
};

const persistSettings = async (settings: DigestSettings): Promise<void> => {
    if (isBrowser) {
        try {
            window.localStorage?.setItem(DIGEST_SETTINGS_KEY, JSON.stringify(settings));
        } catch (error) {
            console.warn('Failed to persist digest settings to localStorage', error);
        }
    }
    if (isTauri) {
        try {
            const invoke = await resolveTauriInvoke();
            await invoke?.('plugin:store|set', {
                store: TAURI_STORE_FILE,
                key: DIGEST_SETTINGS_KEY,
                value: settings,
            });
            await invoke?.('plugin:store|save', { store: TAURI_STORE_FILE });
        } catch (error) {
            console.debug('Failed to persist digest settings via Tauri store', error);
        }
    }
};

const hydrateSettingsFromTauri = async () => {
    if (!isTauri) return;
    try {
        const invoke = await resolveTauriInvoke();
        const stored = await invoke?.<DigestSettings | null>('plugin:store|get', {
            store: TAURI_STORE_FILE,
            key: DIGEST_SETTINGS_KEY,
        });
        if (stored) {
            const sanitized = sanitizeSettings(stored);
            if (!settingsEqual(currentSettings, sanitized)) {
                currentSettings = sanitized;
                emitSettingsUpdate();
            }
        }
    } catch (error) {
        console.debug('Failed to hydrate digest settings from Tauri store', error);
    }
};

void hydrateSettingsFromTauri();

if (isBrowser) {
    window.addEventListener('storage', event => {
        if (event.key !== DIGEST_SETTINGS_KEY || !event.newValue) {
            return;
        }
        try {
            const parsed = JSON.parse(event.newValue);
            const sanitized = sanitizeSettings(parsed);
            if (!settingsEqual(currentSettings, sanitized)) {
                currentSettings = sanitized;
                emitSettingsUpdate();
            }
        } catch (error) {
            console.warn('Failed to process digest settings storage event', error);
        }
    });
}

export const getDigestSettings = (): DigestSettings => currentSettings;

export const setDigestSettings = (patch: Partial<DigestSettings>): DigestSettings => {
    const next = sanitizeSettings({ ...currentSettings, ...patch });
    if (settingsEqual(currentSettings, next)) {
        return currentSettings;
    }
    currentSettings = next;
    void persistSettings(currentSettings);
    emitSettingsUpdate();
    return currentSettings;
};

interface DigestSettingsStoreState {
    settings: DigestSettings;
    setSettings: (patch: Partial<DigestSettings>) => void;
    hydrate: () => void;
}

export const digestSettingsStore = createStore<DigestSettingsStoreState>((set) => ({
    settings: currentSettings,
    setSettings: (patch) => {
        const next = setDigestSettings(patch);
        set({ settings: next });
    },
    hydrate: () => set({ settings: getDigestSettings() }),
}));

settingsListeners.add(settings => {
    digestSettingsStore.setState({ settings });
});

export const useDigestSettings = <T,>(selector: (state: DigestSettingsStoreState) => T): T =>
    useStore(digestSettingsStore, selector);

type SummarizerProvider = 'local' | 'tauri' | 'http';

interface SummarizerConfig {
    provider: SummarizerProvider;
    endpoint?: string;
    apiKey?: string;
    model?: string;
    language?: string;
    tokenLimit?: number;
}

const resolveSummarizerConfig = (overrides?: Partial<Pick<SummarizerConfig, 'language' | 'tokenLimit'>>): SummarizerConfig => {
    const preferredProvider: SummarizerProvider = ['local', 'tauri', 'http'].includes(envSummarizerProvider as SummarizerProvider)
        ? (envSummarizerProvider as SummarizerProvider)
        : 'local';
    const provider = envSummarizerProvider === 'auto'
        ? (isTauri ? 'tauri' : envSummarizerEndpoint ? 'http' : 'local')
        : preferredProvider;

    const settings = getDigestSettings();
    const language = overrides?.language
        ?? (settings.language || envSummarizerLanguage || undefined);
    const tokenLimit = overrides?.tokenLimit
        ?? (settings.tokenLimit > 0 ? settings.tokenLimit : undefined)
        ?? envSummarizerTokenLimit;

    return {
        provider,
        endpoint: envSummarizerEndpoint,
        apiKey: envSummarizerApiKey,
        model: envSummarizerModel,
        language: language && language.length > 0 ? language : undefined,
        tokenLimit,
    };
};

export interface RoomDigest {
    roomId: string;
    accountKey: string;
    summary: string;
    generatedAt: number;
    eventIds: string[];
    participants: string[];
    unreadCount: number;
    highlights: string[];
    language?: string;
    tokenCount?: number;
    provider?: string;
}

interface PersistedDigestRecord extends RoomDigest {
    storageKey: string;
}

const normalizeAccountKey = (key?: string | null): string => (key && key.length > 0 ? key : DEFAULT_ACCOUNT_KEY);

const buildStorageKey = (accountKey: string, roomId: string): string => `${accountKey}::${roomId}`;

const toPersistedRecord = (digest: RoomDigest): PersistedDigestRecord => ({
    ...digest,
    storageKey: buildStorageKey(digest.accountKey, digest.roomId),
});

const fromPersistedRecord = (record: PersistedDigestRecord): RoomDigest => {
    const { storageKey: _ignored, ...rest } = record;
    return rest;
};

const normalizePersistedRecord = (value: any): PersistedDigestRecord | null => {
    if (!value || typeof value !== 'object') {
        return null;
    }
    const storageKey = typeof value.storageKey === 'string' ? value.storageKey : undefined;
    const roomId = typeof value.roomId === 'string' ? value.roomId : undefined;
    const accountKey = typeof value.accountKey === 'string' ? value.accountKey : undefined;
    const summary = typeof value.summary === 'string' ? value.summary : '';
    if (!storageKey || !roomId || !accountKey) {
        return null;
    }
    const eventIds = Array.isArray(value.eventIds)
        ? value.eventIds.filter((entry: unknown) => typeof entry === 'string')
        : [];
    const participants = Array.isArray(value.participants)
        ? value.participants.filter((entry: unknown) => typeof entry === 'string')
        : [];
    const highlights = Array.isArray(value.highlights)
        ? value.highlights.filter((entry: unknown) => typeof entry === 'string')
        : [];
    const generatedAt = typeof value.generatedAt === 'number' ? value.generatedAt : Date.now();
    const unreadCount = typeof value.unreadCount === 'number' ? value.unreadCount : 0;
    const language = typeof value.language === 'string' ? value.language : undefined;
    const tokenCount = typeof value.tokenCount === 'number' ? value.tokenCount : undefined;
    const provider = typeof value.provider === 'string' ? value.provider : undefined;

    return {
        storageKey,
        roomId,
        accountKey,
        summary,
        generatedAt,
        eventIds,
        participants,
        unreadCount,
        highlights,
        language,
        tokenCount,
        provider,
    };
};

type IDBDatabasePromise = Promise<IDBDatabase | null>;
let dbPromise: IDBDatabasePromise | null = null;

const openIndexedDb = (): IDBDatabasePromise => {
    if (!isBrowser || typeof indexedDB === 'undefined') {
        return Promise.resolve(null);
    }
    if (!dbPromise) {
        dbPromise = new Promise((resolve, reject) => {
            const request = indexedDB.open(DIGEST_DB_NAME, DIGEST_DB_VERSION);
            request.onupgradeneeded = () => {
                const db = request.result;
                if (!db.objectStoreNames.contains(DIGEST_STORE_NAME)) {
                    const store = db.createObjectStore(DIGEST_STORE_NAME, { keyPath: 'storageKey' });
                    store.createIndex('byAccount', 'accountKey', { unique: false });
                    store.createIndex('byUpdatedAt', 'generatedAt', { unique: false });
                }
            };
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        }).catch(error => {
            console.debug('Failed to open digest IndexedDB', error);
            return null;
        });
    }
    return dbPromise;
};

const idbPut = async (record: PersistedDigestRecord): Promise<void> => {
    const db = await openIndexedDb();
    if (!db) return;
    await new Promise<void>((resolve, reject) => {
        const tx = db.transaction([DIGEST_STORE_NAME], 'readwrite');
        const store = tx.objectStore(DIGEST_STORE_NAME);
        store.put(record);
        tx.oncomplete = () => resolve();
        tx.onabort = () => reject(tx.error);
        tx.onerror = () => reject(tx.error);
    }).catch(error => {
        console.debug('Failed to persist digest record to IndexedDB', error);
    });
};

const idbGetByAccount = async (accountKey: string): Promise<PersistedDigestRecord[]> => {
    const db = await openIndexedDb();
    if (!db) return [];
    return new Promise<PersistedDigestRecord[]>((resolve, reject) => {
        const tx = db.transaction([DIGEST_STORE_NAME], 'readonly');
        const store = tx.objectStore(DIGEST_STORE_NAME);
        const index = store.index('byAccount');
        const request = index.getAll(accountKey);
        request.onsuccess = () => {
            resolve((request.result as PersistedDigestRecord[]) ?? []);
        };
        request.onerror = () => reject(request.error);
    }).catch(error => {
        console.debug('Failed to load digests from IndexedDB', error);
        return [];
    });
};

const idbRemove = async (storageKey: string): Promise<void> => {
    const db = await openIndexedDb();
    if (!db) return;
    await new Promise<void>((resolve, reject) => {
        const tx = db.transaction([DIGEST_STORE_NAME], 'readwrite');
        const store = tx.objectStore(DIGEST_STORE_NAME);
        store.delete(storageKey);
        tx.oncomplete = () => resolve();
        tx.onabort = () => reject(tx.error);
        tx.onerror = () => reject(tx.error);
    }).catch(error => {
        console.debug('Failed to remove digest record from IndexedDB', error);
    });
};

const tauriReadAccount = async (accountKey: string): Promise<PersistedDigestRecord[] | null> => {
    if (!isTauri) return null;
    try {
        const invoke = await resolveTauriInvoke();
        const raw = await invoke?.<unknown>('plugin:store|get', {
            store: TAURI_STORE_FILE,
            key: accountKey,
        });
        if (!raw) return [];
        if (Array.isArray(raw)) {
            return raw
                .map(entry => normalizePersistedRecord(entry))
                .filter((entry): entry is PersistedDigestRecord => Boolean(entry));
        }
        const normalized = normalizePersistedRecord(raw);
        return normalized ? [normalized] : [];
    } catch (error) {
        console.debug('Failed to read digest records from Tauri store', error);
        return null;
    }
};

const tauriWriteAccount = async (accountKey: string, records: PersistedDigestRecord[]): Promise<void> => {
    if (!isTauri) return;
    try {
        const invoke = await resolveTauriInvoke();
        await invoke?.('plugin:store|set', {
            store: TAURI_STORE_FILE,
            key: accountKey,
            value: records,
        });
        await invoke?.('plugin:store|save', { store: TAURI_STORE_FILE });
    } catch (error) {
        console.debug('Failed to write digest records to Tauri store', error);
    }
};

const tauriPut = async (record: PersistedDigestRecord): Promise<void> => {
    if (!isTauri) return;
    try {
        const existing = await tauriReadAccount(record.accountKey);
        const entries = Array.isArray(existing) ? existing : [];
        const filtered = entries.filter(entry => entry.storageKey !== record.storageKey);
        filtered.push(record);
        await tauriWriteAccount(record.accountKey, filtered);
    } catch (error) {
        console.debug('Failed to persist digest record via Tauri store', error);
    }
};

const tauriRemove = async (accountKey: string, storageKey: string): Promise<void> => {
    if (!isTauri) return;
    try {
        const existing = await tauriReadAccount(accountKey);
        if (!existing) return;
        const filtered = existing.filter(entry => entry.storageKey !== storageKey);
        await tauriWriteAccount(accountKey, filtered);
    } catch (error) {
        console.debug('Failed to remove digest record via Tauri store', error);
    }
};

const loadAccountDigests = async (accountKey: string): Promise<RoomDigest[]> => {
    const [idbRecords, tauriRecords] = await Promise.all([
        idbGetByAccount(accountKey),
        tauriReadAccount(accountKey),
    ]);
    const combined = new Map<string, PersistedDigestRecord>();
    idbRecords.forEach(record => combined.set(record.storageKey, record));
    (tauriRecords ?? []).forEach(record => combined.set(record.storageKey, record));
    return Array.from(combined.values())
        .map(record => fromPersistedRecord(record))
        .sort((a, b) => b.generatedAt - a.generatedAt);
};

const persistDigestRecord = async (digest: RoomDigest): Promise<void> => {
    const record = toPersistedRecord(digest);
    await Promise.all([
        idbPut(record),
        tauriPut(record),
    ]);
};

const removePersistedDigest = async (accountKey: string, roomId: string): Promise<void> => {
    const storageKey = buildStorageKey(accountKey, roomId);
    await Promise.all([
        idbRemove(storageKey),
        tauriRemove(accountKey, storageKey),
    ]);
};

interface SummarizerEventPayload {
    id: string;
    body: string;
    senderId: string;
    senderLabel: string;
    timestamp: number;
}

interface SummarizerResult {
    summary: string;
    tokenCount?: number;
    highlights?: string[];
    provider: string;
}

const stripHtml = (value: string): string => value.replace(/<[^>]+>/g, ' ');

const extractEventBody = (event: MatrixEvent): string | null => {
    const content: any = typeof event.getContent === 'function' ? event.getContent() : event.getContent();
    if (content && typeof content.body === 'string' && content.body.trim().length > 0) {
        return content.body.trim();
    }
    if (content && typeof content.formatted_body === 'string') {
        const stripped = stripHtml(content.formatted_body).trim();
        if (stripped.length > 0) {
            return stripped;
        }
    }
    if (content && typeof content.summary === 'string' && content.summary.trim().length > 0) {
        return content.summary.trim();
    }
    const type = typeof event.getType === 'function' ? event.getType() : (event as any).type;
    if (type === 'm.room.message') {
        const msgtype = content?.msgtype;
        if (msgtype === 'm.image') return '[изображение]';
        if (msgtype === 'm.video') return '[видео]';
        if (msgtype === 'm.audio') return '[аудио]';
        if (msgtype === 'm.file') return '[файл]';
        if (msgtype === 'm.location') return '[локация]';
        if (msgtype === 'm.emote' && typeof content?.body === 'string') {
            return content.body.trim();
        }
    }
    return null;
};

const countTokens = (text: string): number => {
    const trimmed = text.trim();
    if (!trimmed) return 0;
    return trimmed.split(/\s+/).length;
};

const clipToTokenLimit = (text: string, limit?: number): { text: string; tokenCount: number } => {
    const tokens = countTokens(text);
    if (!limit || tokens <= limit) {
        return { text: text.trim(), tokenCount: tokens };
    }
    const parts = text.trim().split(/\s+/).slice(0, limit);
    return { text: `${parts.join(' ')}…`, tokenCount: limit };
};

const toSummarizerEvent = (
    client: MatrixClient,
    roomId: string,
    event: MatrixEvent,
): SummarizerEventPayload | null => {
    const body = extractEventBody(event);
    if (!body) {
        return null;
    }
    const senderId = typeof event.getSender === 'function' ? event.getSender() : (event as any).sender;
    const eventId = typeof event.getId === 'function' ? event.getId() : (event as any).event_id;
    const timestamp = typeof event.getTs === 'function' ? event.getTs() : Date.now();

    const room = typeof client.getRoom === 'function' ? client.getRoom(roomId) : null;
    const member = senderId && room?.getMember?.(senderId);
    const senderLabel = member?.name
        ?? member?.rawDisplayName
        ?? member?.user?.displayName
        ?? senderId
        ?? 'unknown';

    return {
        id: eventId ?? `${roomId}-${timestamp}`,
        body,
        senderId: senderId ?? 'unknown',
        senderLabel,
        timestamp: typeof timestamp === 'number' ? timestamp : Date.now(),
    };
};

const collectRecentAccountEvents = async (
    client: MatrixClient,
    roomId: string,
    limit: number,
): Promise<MatrixEvent[]> => {
    try {
        const response = await searchMessages(client, {
            roomId,
            searchTerm: 'smart:recent',
            limit,
        });
        const seen = new Map<string, MatrixEvent>();
        response.results.forEach(result => {
            const sequence: MatrixEvent[] = [];
            sequence.push(...result.context.before);
            sequence.push(result.event);
            sequence.push(...result.context.after);
            sequence.forEach(event => {
                const eventId = typeof event.getId === 'function' ? event.getId() : (event as any).event_id;
                if (eventId && !seen.has(eventId)) {
                    seen.set(eventId, event);
                }
            });
        });
        return Array.from(seen.values()).sort((a, b) => {
            const ta = typeof a.getTs === 'function' ? a.getTs() : 0;
            const tb = typeof b.getTs === 'function' ? b.getTs() : 0;
            return ta - tb;
        });
    } catch (error) {
        console.warn('Failed to collect recent events for digest', error);
        return [];
    }
};

const collectUniversalEvents = async (
    roomId: string,
    limit: number,
    includedAccountKeys?: string[],
): Promise<{ event: MatrixEvent; accountKey: string }[]> => {
    try {
        const response = await searchUniversalMessages({
            roomId,
            searchTerm: 'smart:recent',
            limit,
            includedAccountKeys,
        });
        const dedupe = new Map<string, { event: MatrixEvent; accountKey: string }>();
        response.results.forEach(item => {
            const eventId = typeof item.event.getId === 'function' ? item.event.getId() : (item.event as any).event_id;
            if (!eventId) {
                return;
            }
            if (!dedupe.has(eventId)) {
                dedupe.set(eventId, { event: item.event, accountKey: item.accountKey });
            }
        });
        return Array.from(dedupe.values()).sort((a, b) => {
            const ta = typeof a.event.getTs === 'function' ? a.event.getTs() : 0;
            const tb = typeof b.event.getTs === 'function' ? b.event.getTs() : 0;
            return ta - tb;
        });
    } catch (error) {
        console.warn('Failed to collect universal events for digest', error);
        return [];
    }
};

const runLocalSummarizer = async (
    events: SummarizerEventPayload[],
    config: SummarizerConfig,
): Promise<SummarizerResult> => {
    const recent = events.slice(-8);
    const highlightSet = new Set<string>();
    const lines = recent.map(event => {
        highlightSet.add(event.senderLabel);
        return `${event.senderLabel}: ${event.body}`;
    });
    const rawSummary = lines.join('\n');
    const clipped = clipToTokenLimit(rawSummary, config.tokenLimit);
    return {
        summary: clipped.text,
        tokenCount: clipped.tokenCount,
        highlights: Array.from(highlightSet),
        provider: 'local',
    };
};

const runTauriSummarizer = async (
    events: SummarizerEventPayload[],
    config: SummarizerConfig,
    roomId: string,
    accountKey: string,
): Promise<SummarizerResult> => {
    try {
        const invoke = await resolveTauriInvoke();
        if (!invoke) {
            throw new Error('invoke unavailable');
        }
        const result = await invoke<any>('plugin:llm|summarize_chat', {
            roomId,
            accountKey,
            language: config.language,
            tokenLimit: config.tokenLimit,
            events,
        });
        if (result && typeof result.summary === 'string') {
            const highlights = Array.isArray(result.highlights)
                ? result.highlights.filter((entry: unknown) => typeof entry === 'string')
                : undefined;
            return {
                summary: result.summary,
                tokenCount: typeof result.tokenCount === 'number' ? result.tokenCount : undefined,
                highlights,
                provider: 'tauri',
            };
        }
        throw new Error('invalid tauri response');
    } catch (error) {
        console.warn('Tauri summarizer failed, falling back to local summarizer', error);
        return runLocalSummarizer(events, config);
    }
};

const runHttpSummarizer = async (
    events: SummarizerEventPayload[],
    config: SummarizerConfig,
    roomId: string,
    accountKey: string,
): Promise<SummarizerResult> => {
    if (!config.endpoint) {
        return runLocalSummarizer(events, config);
    }
    try {
        const response = await fetch(config.endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
            },
            body: JSON.stringify({
                roomId,
                accountKey,
                language: config.language,
                tokenLimit: config.tokenLimit,
                model: config.model,
                events,
            }),
        });
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        const data = await response.json();
        if (!data || typeof data.summary !== 'string') {
            throw new Error('Malformed summarizer response');
        }
        const highlights = Array.isArray(data.highlights)
            ? data.highlights.filter((entry: unknown) => typeof entry === 'string')
            : undefined;
        return {
            summary: data.summary,
            tokenCount: typeof data.tokenCount === 'number' ? data.tokenCount : undefined,
            highlights,
            provider: 'http',
        };
    } catch (error) {
        console.warn('HTTP summarizer failed, falling back to local summarizer', error);
        return runLocalSummarizer(events, config);
    }
};

const runSummarizer = async (
    events: SummarizerEventPayload[],
    config: SummarizerConfig,
    roomId: string,
    accountKey: string,
): Promise<SummarizerResult> => {
    if (!events.length) {
        return {
            summary: '',
            tokenCount: 0,
            highlights: [],
            provider: config.provider,
        };
    }
    if (config.provider === 'tauri') {
        return runTauriSummarizer(events, config, roomId, accountKey);
    }
    if (config.provider === 'http') {
        return runHttpSummarizer(events, config, roomId, accountKey);
    }
    return runLocalSummarizer(events, config);
};

const DIGEST_NOTIFICATION_BODY_LIMIT = 240;

const truncateNotificationText = (text: string, limit: number): string => {
    if (text.length <= limit) {
        return text;
    }
    return `${text.slice(0, Math.max(0, limit - 1)).trimEnd()}…`;
};

const getRoomDisplayName = (client: MatrixClient | null | undefined, roomId: string): string | null => {
    if (!client || typeof client.getRoom !== 'function') {
        return null;
    }
    const room: any = client.getRoom(roomId);
    if (!room) {
        return null;
    }
    if (typeof room.name === 'string' && room.name.trim().length > 0) {
        return room.name.trim();
    }
    if (typeof room.getCanonicalAlias === 'function') {
        const alias = room.getCanonicalAlias();
        if (typeof alias === 'string' && alias.length > 0) {
            return alias;
        }
    }
    if (typeof room.getAltAliases === 'function') {
        const aliases = room.getAltAliases();
        if (Array.isArray(aliases) && aliases.length > 0) {
            const alias = aliases.find(entry => typeof entry === 'string' && entry.length > 0);
            if (alias) {
                return alias;
            }
        }
    }
    return null;
};

const buildDigestNotificationTitle = (
    digest: RoomDigest,
    roomName: string | null,
    accountLabel: string | null,
): string => {
    const unread = typeof digest.unreadCount === 'number' && digest.unreadCount > 0 ? digest.unreadCount : null;
    const segments: string[] = [];
    const baseRoomName = roomName ?? (digest.highlights[0] ?? 'Комната');
    segments.push(unread ? `Наверстать: ${baseRoomName} (${unread})` : `Наверстать: ${baseRoomName}`);
    if (accountLabel) {
        segments.push(accountLabel);
    }
    return segments.join(' • ');
};

const buildDigestNotificationBody = (digest: RoomDigest): string => {
    const summary = typeof digest.summary === 'string' ? digest.summary.trim() : '';
    const participants = Array.from(new Set(digest.participants)).filter(Boolean).slice(0, 5);
    const highlights = Array.from(new Set(digest.highlights)).filter(Boolean).slice(0, 3);

    const lines: string[] = [];
    if (summary.length > 0) {
        lines.push(truncateNotificationText(summary, DIGEST_NOTIFICATION_BODY_LIMIT));
    }

    if (participants.length > 0) {
        lines.push(`Участники: ${participants.join(', ')}`);
    } else if (highlights.length > 0) {
        lines.push(`Участники: ${highlights.join(', ')}`);
    }

    if (digest.provider && digest.provider !== 'local') {
        lines.push(`Источник: ${digest.provider}`);
    }

    if (lines.length === 0) {
        return 'Посмотрите, что произошло в комнате за последнее время.';
    }

    const combined = lines.join('\n');
    if (combined.length <= DIGEST_NOTIFICATION_BODY_LIMIT) {
        return combined;
    }

    const [firstLine, ...rest] = lines;
    const truncatedFirst = truncateNotificationText(firstLine, DIGEST_NOTIFICATION_BODY_LIMIT);
    const remainingBudget = DIGEST_NOTIFICATION_BODY_LIMIT - truncatedFirst.length - (rest.length > 0 ? 1 : 0);

    if (remainingBudget <= 0 || rest.length === 0) {
        return truncatedFirst;
    }

    const truncatedRest: string[] = [];
    let available = remainingBudget;
    for (const line of rest) {
        if (line.length + 1 <= available) {
            truncatedRest.push(line);
            available -= line.length + 1;
            continue;
        }
        if (available > 0) {
            truncatedRest.push(truncateNotificationText(line, available));
        }
        break;
    }

    return [truncatedFirst, ...truncatedRest].join('\n');
};

const notifyDigest = async (digest: RoomDigest): Promise<void> => {
    let roomName: string | null = null;
    let accountLabel: string | null = null;
    try {
        const accountStore = getAccountStore();
        const state = accountStore.getState();
        const accountKey = digest.accountKey === DEFAULT_ACCOUNT_KEY ? state.activeKey : digest.accountKey;
        const account = accountKey ? state.accounts[accountKey] : undefined;
        const client = account?.client ?? null;
        roomName = getRoomDisplayName(client, digest.roomId);
        accountLabel = account?.displayName ?? account?.userId ?? null;
    } catch (error) {
        console.debug('Failed to derive digest notification metadata', error);
    }

    const title = buildDigestNotificationTitle(digest, roomName, accountLabel);
    const body = buildDigestNotificationBody(digest);

    try {
        const module = await import('./pushService');
        if (typeof module.sendDailyDigestNotification === 'function') {
            await module.sendDailyDigestNotification({
                title,
                body,
                roomId: digest.roomId,
                accountKey: digest.accountKey === DEFAULT_ACCOUNT_KEY ? null : digest.accountKey,
                unreadCount: digest.unreadCount,
            });
        }
    } catch (error) {
        console.debug('Daily digest notification dispatch failed', error);
    }
};

export interface GenerateDigestOptions {
    accountKey?: string | null;
    roomId: string;
    client?: MatrixClient;
    limit?: number;
    language?: string;
    tokenLimit?: number;
    unreadCount?: number;
    scope?: 'account' | 'universal';
    includedAccountKeys?: string[];
    force?: boolean;
    notify?: boolean;
    reason?: 'manual' | 'auto' | 'scheduled';
}

interface DigestStoreState {
    activeKey: string;
    digests: RoomDigest[];
    digestMap: Record<string, RoomDigest>;
    digestsByAccount: Record<string, RoomDigest[]>;
    hydratedAccounts: Record<string, boolean>;
    generatingRooms: Record<string, boolean>;
    isHydrated: boolean;
    hydrateAccount: (accountKey: string, options?: { force?: boolean }) => Promise<void>;
    setActiveKey: (accountKey: string | null) => void;
    removeAccount: (accountKey: string) => void;
    generateDigestForRoom: (options: GenerateDigestOptions) => Promise<RoomDigest | null>;
    removeDigest: (accountKey: string, roomId: string) => Promise<void>;
    updateUnreadCounts: (accountKey: string, counts: Record<string, number>) => Promise<void>;
}

const buildDigestMap = (entries: RoomDigest[]): Record<string, RoomDigest> => {
    const map: Record<string, RoomDigest> = {};
    entries.forEach(entry => {
        map[entry.roomId] = entry;
    });
    return map;
};

const recentGenerationByRoom = new Map<string, number>();
const lastNotificationByAccount = new Map<string, number>();

const digestStore = createStore<DigestStoreState>((set, get) => ({
    activeKey: DEFAULT_ACCOUNT_KEY,
    digests: [],
    digestMap: {},
    digestsByAccount: {},
    hydratedAccounts: {},
    generatingRooms: {},
    isHydrated: false,
    hydrateAccount: async (accountKey, options) => {
        const normalized = normalizeAccountKey(accountKey);
        const state = get();
        if (!options?.force && state.hydratedAccounts[normalized]) {
            return;
        }
        const records = await loadAccountDigests(normalized);
        set(current => {
            const digestsByAccount = {
                ...current.digestsByAccount,
                [normalized]: records,
            };
            const hydratedAccounts = {
                ...current.hydratedAccounts,
                [normalized]: true,
            };
            const patch: Partial<DigestStoreState> = {
                digestsByAccount,
                hydratedAccounts,
            };
            if (current.activeKey === normalized) {
                patch.digests = records;
                patch.digestMap = buildDigestMap(records);
                patch.isHydrated = true;
            }
            return { ...current, ...patch };
        });
    },
    setActiveKey: (accountKey) => {
        const normalized = normalizeAccountKey(accountKey);
        set(current => {
            const digests = current.digestsByAccount[normalized] ?? [];
            return {
                ...current,
                activeKey: normalized,
                digests,
                digestMap: buildDigestMap(digests),
                isHydrated: Boolean(current.hydratedAccounts[normalized]),
            };
        });
    },
    removeAccount: (accountKey) => {
        const normalized = normalizeAccountKey(accountKey);
        set(current => {
            const { [normalized]: _removed, ...restAccounts } = current.digestsByAccount;
            const { [normalized]: _hydrated, ...restHydrated } = current.hydratedAccounts;
            const patch: Partial<DigestStoreState> = {
                digestsByAccount: restAccounts,
                hydratedAccounts: restHydrated,
            };
            if (current.activeKey === normalized) {
                patch.activeKey = DEFAULT_ACCOUNT_KEY;
                patch.digests = restAccounts[DEFAULT_ACCOUNT_KEY] ?? [];
                patch.digestMap = buildDigestMap(patch.digests ?? []);
                patch.isHydrated = Boolean(restHydrated[DEFAULT_ACCOUNT_KEY]);
            }
            return { ...current, ...patch };
        });
    },
    generateDigestForRoom: async (options) => {
        const normalizedAccountKey = normalizeAccountKey(options.accountKey ?? get().activeKey);
        if (!options.roomId) {
            return null;
        }
        const roomKey = buildStorageKey(normalizedAccountKey, options.roomId);
        if (!options.force) {
            const last = recentGenerationByRoom.get(roomKey);
            if (last && Date.now() - last < MIN_DIGEST_REFRESH_INTERVAL) {
                return get().digestMap[options.roomId] ?? null;
            }
        }
        recentGenerationByRoom.set(roomKey, Date.now());
        set(current => ({
            ...current,
            generatingRooms: {
                ...current.generatingRooms,
                [roomKey]: true,
            },
        }));

        let client = options.client;
        if (!client) {
            client = getAccountStore().getState().accounts[normalizedAccountKey]?.client ?? null;
        }
        if (!client) {
            console.warn('generateDigestForRoom called without available client');
            set(current => {
                const { [roomKey]: _skip, ...rest } = current.generatingRooms;
                return { ...current, generatingRooms: rest };
            });
            return null;
        }

        const limit = Math.max(5, options.limit ?? 40);
        const scope = options.scope ?? 'account';
        let summarizerEvents: SummarizerEventPayload[] = [];
        if (scope === 'universal') {
            const universalEvents = await collectUniversalEvents(options.roomId, limit, options.includedAccountKeys);
            summarizerEvents = universalEvents
                .map(entry => toSummarizerEvent(client!, options.roomId, entry.event))
                .filter((entry): entry is SummarizerEventPayload => Boolean(entry));
        } else {
            const events = await collectRecentAccountEvents(client, options.roomId, limit);
            summarizerEvents = events
                .map(event => toSummarizerEvent(client!, options.roomId, event))
                .filter((entry): entry is SummarizerEventPayload => Boolean(entry));
        }

        const participants = Array.from(new Set(summarizerEvents.map(event => event.senderLabel)));
        const eventIds = summarizerEvents.map(event => event.id);
        const config = resolveSummarizerConfig({ language: options.language, tokenLimit: options.tokenLimit });
        const summary = await runSummarizer(summarizerEvents, config, options.roomId, normalizedAccountKey);
        const digest: RoomDigest = {
            roomId: options.roomId,
            accountKey: normalizedAccountKey,
            summary: summary.summary,
            generatedAt: Date.now(),
            eventIds,
            participants,
            unreadCount: options.unreadCount ?? 0,
            highlights: summary.highlights ?? participants,
            language: config.language,
            tokenCount: summary.tokenCount,
            provider: summary.provider,
        };
        await persistDigestRecord(digest);

        set(current => {
            const existing = current.digestsByAccount[normalizedAccountKey] ?? [];
            const filtered = existing.filter(entry => entry.roomId !== options.roomId);
            const updated = [...filtered, digest].sort((a, b) => b.generatedAt - a.generatedAt);
            const digestsByAccount = {
                ...current.digestsByAccount,
                [normalizedAccountKey]: updated,
            };
            const { [roomKey]: _skip, ...rest } = current.generatingRooms;
            const patch: Partial<DigestStoreState> = {
                digestsByAccount,
                generatingRooms: rest,
            };
            if (current.activeKey === normalizedAccountKey) {
                patch.digests = updated;
                patch.digestMap = buildDigestMap(updated);
            }
            return { ...current, ...patch };
        });

        const shouldNotify = Boolean(
            options.notify
            || (options.reason === 'scheduled' && getDigestSettings().periodicity !== 'never'),
        );

        if (shouldNotify) {
            const last = lastNotificationByAccount.get(normalizedAccountKey) ?? 0;
            if (Date.now() - last > DAILY_NOTIFICATION_INTERVAL) {
                await notifyDigest(digest);
                lastNotificationByAccount.set(normalizedAccountKey, Date.now());
            }
        }

        return digest;
    },
    removeDigest: async (accountKey, roomId) => {
        const normalized = normalizeAccountKey(accountKey);
        await removePersistedDigest(normalized, roomId);
        set(current => {
            const existing = current.digestsByAccount[normalized] ?? [];
            const updated = existing.filter(entry => entry.roomId !== roomId);
            const digestsByAccount = {
                ...current.digestsByAccount,
                [normalized]: updated,
            };
            const patch: Partial<DigestStoreState> = { digestsByAccount };
            if (current.activeKey === normalized) {
                patch.digests = updated;
                patch.digestMap = buildDigestMap(updated);
            }
            return { ...current, ...patch };
        });
    },
    updateUnreadCounts: async (accountKey, counts) => {
        const normalized = normalizeAccountKey(accountKey);
        const updates: RoomDigest[] = [];
        set(current => {
            const existing = current.digestsByAccount[normalized] ?? [];
            const updatedEntries = existing.map(entry => {
                if (Object.prototype.hasOwnProperty.call(counts, entry.roomId)) {
                    const unread = counts[entry.roomId];
                    if (entry.unreadCount !== unread) {
                        const updated = { ...entry, unreadCount: unread };
                        updates.push(updated);
                        return updated;
                    }
                }
                return entry;
            });
            if (updates.length === 0) {
                return current;
            }
            const digestsByAccount = {
                ...current.digestsByAccount,
                [normalized]: updatedEntries,
            };
            const patch: Partial<DigestStoreState> = { digestsByAccount };
            if (current.activeKey === normalized) {
                patch.digests = updatedEntries;
                patch.digestMap = buildDigestMap(updatedEntries);
            }
            return { ...current, ...patch };
        });
        if (updates.length > 0) {
            await Promise.all(updates.map(entry => persistDigestRecord(entry)));
        }
    },
}));

export const useDigestStore = <T,>(selector: (state: DigestStoreState) => T): T => useStore(digestStore, selector);

export const hydrateDigestsForAccount = async (
    accountKey: string | null,
    options?: { force?: boolean },
): Promise<void> => {
    await digestStore.getState().hydrateAccount(normalizeAccountKey(accountKey), options);
};

export const setActiveDigestAccount = (accountKey: string | null): void => {
    digestStore.getState().setActiveKey(accountKey);
};

export const detachDigestsForAccount = (accountKey: string | null): void => {
    digestStore.getState().removeAccount(normalizeAccountKey(accountKey));
};

export const updateDigestUnreadCounts = async (
    accountKey: string | null,
    counts: Record<string, number>,
): Promise<void> => {
    await digestStore.getState().updateUnreadCounts(normalizeAccountKey(accountKey), counts);
};

export const generateRoomDigest = async (options: GenerateDigestOptions): Promise<RoomDigest | null> => {
    return digestStore.getState().generateDigestForRoom(options);
};

export const removeStoredDigest = async (accountKey: string | null, roomId: string): Promise<void> => {
    await digestStore.getState().removeDigest(normalizeAccountKey(accountKey), roomId);
};

export const getDigestForRoom = (roomId: string): RoomDigest | null => {
    return digestStore.getState().digestMap[roomId] ?? null;
};

export const DEFAULT_DIGEST_ACCOUNT_KEY = DEFAULT_ACCOUNT_KEY;

