import { MatrixClient, MatrixEvent, MatrixRoom, MatrixUser, Sticker, Gif, RoomCreationOptions } from '../types';
import type { SecureCloudProfile } from './secureCloudService';
import { normaliseSecureCloudProfile } from './secureCloudService';
import GroupCallCoordinator, { GroupCallParticipant as CoordinatorParticipant } from './webrtc/groupCallCoordinator';
import {
    GROUP_CALL_CONTROL_EVENT_TYPE,
    GROUP_CALL_PARTICIPANTS_EVENT_TYPE,
    GROUP_CALL_SIGNAL_EVENT_TYPE,
    GROUP_CALL_STATE_EVENT_TYPE,
    GroupCallParticipantsContent,
    GroupCallRole,
    GroupCallStateEventContent,
    SerializedGroupCallParticipant,
} from './webrtc/groupCallConstants';
// FIX: `RoomCreateOptions` is not an exported member of `matrix-js-sdk`. Replaced with the correct type `ICreateRoomOpts`.
// FIX: Import Visibility enum to correctly type room creation options.
import {
    createClient,
    ICreateClientOpts,
    EventType,
    MsgType,
    RelationType,
    ICreateRoomOpts,
    Visibility,
    AutoDiscovery,
    AutoDiscoveryAction,
    AutoDiscoveryError, 
    IndexedDBStore, IndexedDBCryptoStore, ClientEvent, MemoryStore, MatrixScheduler, Preset, RoomEvent} from 'matrix-js-sdk';
import type { HierarchyRoom } from 'matrix-js-sdk';


// ===== Offline Outbox Queue (IndexedDB/SQLite) =====
export interface OutboxAttachment {
    id: string;
    name: string;
    size: number;
    mimeType: string;
    /**
     * Serialized payload for the attachment. We use data URLs because they
     * are self-contained and work in browsers without FileSystem Access.
     */
    dataUrl?: string;
    /** Remote URL to fetch when flushing, used if dataUrl is not available. */
    remoteUrl?: string;
    /**
     * Where in the event content the uploaded MXC URL should be injected.
     * Accepts dot-notation (e.g. "url" or "file.url").
     */
    contentPath?: string;
    kind?: 'file' | 'image' | 'audio' | 'video' | 'sticker' | 'voice' | 'other';
}

export type OutboxPayload = {
    id: string;                 // local id (txn-like)
    roomId: string;
    type: string;
    content: any;
    ts: number;
    attempts: number;
    threadRootId?: string;
    replyToEventId?: string;
    attachments?: OutboxAttachment[];
};

export type OutboxEvent =
  | { kind: 'status'; online: boolean; syncing: boolean }
  | { kind: 'enqueued'; item: OutboxPayload }
  | { kind: 'progress'; id: string; attempts: number }
  | { kind: 'sent'; id: string; serverEventId: string }
  | { kind: 'error'; id: string; error: any }
  | { kind: 'cancelled'; id: string };

type OutboxListener = (ev: OutboxEvent) => void;

class SimpleEmitter {
    private listeners: Set<OutboxListener> = new Set();
    on(fn: OutboxListener) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
    emit(ev: OutboxEvent) { this.listeners.forEach(l => { try { l(ev); } catch { /* ignore */ } }); }
}
const _outboxEmitter = new SimpleEmitter();

export const onOutboxEvent = (fn: OutboxListener) => _outboxEmitter.on(fn);

// IndexedDB helpers
const OUTBOX_DB = 'econix-outbox';
const OUTBOX_STORE = 'events';

const idbOpen = (): Promise<IDBDatabase> => new Promise((resolve, reject) => {
    const req = indexedDB.open(OUTBOX_DB, 1);
    req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(OUTBOX_STORE)) {
            db.createObjectStore(OUTBOX_STORE, { keyPath: 'id' });
        }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
});

const idbPut = async (item: OutboxPayload) => {
    const db = await idbOpen();
    await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(OUTBOX_STORE, 'readwrite');
        tx.objectStore(OUTBOX_STORE).put(item);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
    db.close();
};

const idbGetAll = async (): Promise<OutboxPayload[]> => {
    const db = await idbOpen();
    const items: OutboxPayload[] = await new Promise((resolve, reject) => {
        const tx = db.transaction(OUTBOX_STORE, 'readonly');
        const req = tx.objectStore(OUTBOX_STORE).getAll();
        req.onsuccess = () => resolve(req.result as any);
        req.onerror = () => reject(req.error);
    });
    db.close();
    return items;
};

const idbDelete = async (id: string) => {
    const db = await idbOpen();
    await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(OUTBOX_STORE, 'readwrite');
        tx.objectStore(OUTBOX_STORE).delete(id);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
    db.close();
};

const idbGet = async (id: string): Promise<OutboxPayload | null> => {
    const db = await idbOpen();
    const item: OutboxPayload | undefined = await new Promise((resolve, reject) => {
        const tx = db.transaction(OUTBOX_STORE, 'readonly');
        const req = tx.objectStore(OUTBOX_STORE).get(id);
        req.onsuccess = () => resolve(req.result as OutboxPayload | undefined);
        req.onerror = () => reject(req.error);
    });
    db.close();
    return item ?? null;
};

const blobToDataUrl = (blob: Blob): Promise<string> => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
});

const dataUrlToBlob = (dataUrl: string): Blob => {
    const [meta, base64] = dataUrl.split(',');
    const mimeMatch = /data:([^;]+);base64/.exec(meta);
    const mimeType = mimeMatch ? mimeMatch[1] : 'application/octet-stream';
    let binary: string;
    if (typeof atob === 'function') {
        binary = atob(base64);
    } else if (typeof Buffer !== 'undefined') {
        binary = Buffer.from(base64, 'base64').toString('binary');
    } else {
        throw new Error('Unable to decode dataUrl in this environment');
    }
    const len = binary.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i += 1) {
        bytes[i] = binary.charCodeAt(i);
    }
    return new Blob([bytes], { type: mimeType });
};

const setContentPath = (target: any, path: string | undefined, value: any) => {
    if (!path) return;
    const segments = path.split('.').filter(Boolean);
    if (segments.length === 0) return;
    let current = target;
    for (let i = 0; i < segments.length - 1; i += 1) {
        const key = segments[i];
        if (typeof current[key] !== 'object' || current[key] === null) {
            current[key] = {};
        }
        current = current[key];
    }
    current[segments[segments.length - 1]] = value;
};

let _boundClient: MatrixClient | null = null;
let _isSyncing = false;

const updateStatus = () => {
    _outboxEmitter.emit({ kind: 'status', online: navigator.onLine, syncing: _isSyncing });
};

export const bindOutboxToClient = (client: MatrixClient) => {
    _boundClient = client;
    client.on(ClientEvent.Sync as any, (state: any) => {
        _isSyncing = state === 'SYNCING' || state === 'PREPARED';
        updateStatus();
        if (_isSyncing && navigator.onLine) {
            void flushOutbox();
        }
    });
    window.addEventListener('online', () => { updateStatus(); void flushOutbox(); });
    window.addEventListener('offline', () => updateStatus());
};

const randomId = () => 'loc_' + Math.random().toString(36).slice(2) + Date.now().toString(36);

const isOffline = () => typeof navigator !== 'undefined' && navigator.onLine === false;

const shouldQueueFromError = (error: unknown) => {
    if (isOffline()) return true;
    const message = typeof (error as any)?.message === 'string' ? (error as any).message : '';
    return /network|fetch|timeout|offline|abort/i.test(message);
};

export const getOutboxPending = async (roomId?: string): Promise<OutboxPayload[]> => {
    const all = await idbGetAll();
    return roomId ? all.filter(i => i.roomId === roomId) : all;
};

export const flushOutbox = async () => {
    if (!_boundClient) return;
    if (!navigator.onLine) return;
    const items = (await idbGetAll()).sort((a,b) => a.ts - b.ts);
    for (const item of items) {
        try {
            _outboxEmitter.emit({ kind: 'progress', id: item.id, attempts: (item.attempts||0)+1 });
            const baseContent = item.content ? JSON.parse(JSON.stringify(item.content)) : {};
            if (Array.isArray(item.attachments) && item.attachments.length > 0) {
                for (const attachment of item.attachments) {
                    try {
                        let blob: Blob;
                        if (attachment.dataUrl) {
                            blob = dataUrlToBlob(attachment.dataUrl);
                        } else if (attachment.remoteUrl) {
                            const response = await fetch(attachment.remoteUrl);
                            blob = await response.blob();
                        } else {
                            throw new Error('Attachment payload missing data');
                        }
                        const fileName = attachment.name || 'attachment';
                        const uploadSource = (typeof File !== 'undefined')
                            ? new File([blob], fileName, { type: attachment.mimeType, lastModified: Date.now() })
                            : blob;
                        const { content_uri } = await _boundClient.uploadContent(uploadSource as any, {
                            name: fileName,
                            type: attachment.mimeType,
                        });
                        setContentPath(baseContent, attachment.contentPath ?? 'url', content_uri);
                    } catch (uploadError) {
                        throw uploadError;
                    }
                }
            }
            const sendRes = await _boundClient.sendEvent(item.roomId, item.type as any, baseContent);
            await idbDelete(item.id);
            _outboxEmitter.emit({ kind: 'sent', id: item.id, serverEventId: sendRes.event_id });
        } catch (e) {
            // likely still offline or server error. increase attempts and stop.
            try {
                await idbPut({ ...item, attempts: (item.attempts||0)+1 });
            } catch {}
            _outboxEmitter.emit({ kind: 'error', id: item.id, error: e });
            break;
        }
    }
};

export const enqueueOutbox = async (
    roomId: string,
    type: string,
    content: any,
    opts?: { threadRootId?: string; replyToEventId?: string; attachments?: OutboxAttachment[] }
) => {
    const id = randomId();
    const payload: OutboxPayload = {
        id,
        roomId,
        type,
        content,
        ts: Date.now(),
        attempts: 0,
        threadRootId: opts?.threadRootId,
        replyToEventId: opts?.replyToEventId,
        attachments: opts?.attachments,
    };
    await idbPut(payload);
    _outboxEmitter.emit({ kind: 'enqueued', item: payload });
    return id;
};

export const cancelOutboxItem = async (id: string) => {
    await idbDelete(id);
    _outboxEmitter.emit({ kind: 'cancelled', id });
};

export const retryOutboxItem = async (id: string) => {
    const existing = await idbGet(id);
    if (!existing) return;
    const updated: OutboxPayload = { ...existing, attempts: 0, ts: Date.now() };
    await idbPut(updated);
    _outboxEmitter.emit({ kind: 'enqueued', item: updated });
    if (navigator.onLine) {
        void flushOutbox();
    }
};

export const serializeOutboxAttachment = async (
    blob: Blob,
    options?: { name?: string; contentPath?: string; kind?: OutboxAttachment['kind']; mimeTypeOverride?: string }
): Promise<OutboxAttachment> => {
    const name = options?.name ?? (blob instanceof File ? blob.name : 'attachment');
    const mimeType = options?.mimeTypeOverride ?? (blob.type || 'application/octet-stream');
    return {
        id: randomId(),
        name,
        size: blob.size,
        mimeType,
        dataUrl: await blobToDataUrl(blob),
        contentPath: options?.contentPath ?? 'url',
        kind: options?.kind ?? 'file',
    };
};

export const createRemoteOutboxAttachment = (
    url: string,
    options?: { name?: string; size?: number; mimeType?: string; contentPath?: string; kind?: OutboxAttachment['kind'] }
): OutboxAttachment => ({
    id: randomId(),
    name: options?.name ?? 'attachment',
    size: options?.size ?? 0,
    mimeType: options?.mimeType ?? 'application/octet-stream',
    remoteUrl: url,
    contentPath: options?.contentPath ?? 'url',
    kind: options?.kind ?? 'file',
});
// ===== Translation settings and utilities =====
export interface TranslationSettings {
    baseUrl: string;                // Full endpoint like https://host/api/translate
    apiKey?: string;                // Optional bearer token or API key
    headers?: Record<string, string>; // Optional extra headers (JSON)
}
const TRANSLATION_ACCOUNT_EVENT = 'com.econix.translation.settings';
const TRANSLATION_LOCAL_KEY = 'econix.translation.settings';

let _translationSettingsCache: TranslationSettings | null = null;

/**
 * Read translation settings from Matrix account data or localStorage.
 * Account data has priority if present.
 */
export function getTranslationSettings(client?: MatrixClient): TranslationSettings | null {
    try {
        const localRaw = (globalThis as any).localStorage?.getItem(TRANSLATION_LOCAL_KEY);
        const local: TranslationSettings | null = localRaw ? JSON.parse(localRaw) : null;
        let remote: TranslationSettings | null = null;
        if (client) {
            const ev: any = (client as any).getAccountData?.(TRANSLATION_ACCOUNT_EVENT as any);
            const content = ev?.getContent?.();
            if (content && typeof content === 'object') {
                remote = {
                    baseUrl: typeof content.baseUrl === 'string' ? content.baseUrl : '',
                    apiKey: typeof content.apiKey === 'string' ? content.apiKey : undefined,
                    headers: (content.headers && typeof content.headers === 'object') ? content.headers : undefined,
                };
            }
        }
        const merged: TranslationSettings | null = remote?.baseUrl ? { ...(local || {}), ...remote } : (local || remote);
        if (merged) _translationSettingsCache = merged;
        return _translationSettingsCache || merged || null;
    } catch (e) {
        console.warn('Failed to read translation settings', e);
        return _translationSettingsCache;
    }
}

/**
 * Persist translation settings to localStorage and Matrix account data.
 */
export async function setTranslationSettings(client: MatrixClient | null | undefined, settings: TranslationSettings): Promise<void> {
    try {
        (globalThis as any).localStorage?.setItem(TRANSLATION_LOCAL_KEY, JSON.stringify(settings));
    } catch (e) {
        console.warn('Failed to persist translation settings to localStorage', e);
    }
    _translationSettingsCache = settings;
    try {
        if (client) {
            await (client as any).setAccountData?.(TRANSLATION_ACCOUNT_EVENT as any, settings as any);
        }
    } catch (e) {
        console.warn('Failed to persist translation settings to account data', e);
    }
}

export type TranslationErrorHandler = (message: string) => void;
let _translationErrorHandler: TranslationErrorHandler | null = null;
export function setTranslationErrorHandler(handler: TranslationErrorHandler | null) {
    _translationErrorHandler = handler;
}


const secureCloudProfiles = new WeakMap<MatrixClient, SecureCloudProfile>();

export const setSecureCloudProfileForClient = (client: MatrixClient, profile: SecureCloudProfile | null): void => {
    if (!profile || profile.mode === 'disabled') {
        secureCloudProfiles.delete(client);
        return;
    }
    secureCloudProfiles.set(client, normaliseSecureCloudProfile(profile));
};

export const getSecureCloudProfileForClient = (client: MatrixClient): SecureCloudProfile | null => {
    return secureCloudProfiles.get(client) ?? null;
};


export class HomeserverDiscoveryError extends Error {
    public constructor(message: string) {
        super(message);
        this.name = 'HomeserverDiscoveryError';
    }
}

const MATRIX_ID_DOMAIN_PATTERN = /^@[^:]+:(.+)$/;

const normalizeBaseUrl = (value: string): string => {
    const ensureProtocol = (url: string) => (url.includes('://') ? url : `https://${url}`);
    let candidate = ensureProtocol(value);

    try {
        const parsed = new URL(candidate);
        if (parsed.protocol !== 'https:') {
            parsed.protocol = 'https:';
        }
        parsed.hash = '';
        parsed.search = '';
        // remove trailing slash for consistency but keep non-root paths intact
        const normalised = parsed.toString();
        return normalised.endsWith('/') && parsed.pathname === '/' ? normalised.slice(0, -1) : normalised;
    } catch (error) {
        throw new HomeserverDiscoveryError('Сервер вернул некорректный адрес homeserver.');
    }
};

const formatDiscoveryErrorMessage = (error?: AutoDiscoveryError | null): string => {
    switch (error) {
        case AutoDiscovery.ERROR_MISSING_WELLKNOWN:
            return 'На сервере отсутствует /.well-known/matrix/client.';
        case AutoDiscovery.ERROR_INVALID_HOMESERVER:
            return 'Указанный сервер не поддерживает Matrix.';
        case AutoDiscovery.ERROR_INVALID_HS_BASE_URL:
        case AutoDiscovery.ERROR_INVALID:
            return 'Сервер вернул некорректные настройки discovery.';
        case AutoDiscovery.ERROR_GENERIC_FAILURE:
            return 'Не удалось получить настройки discovery с сервера.';
        default:
            return 'Не удалось определить адрес homeserver.';
    }
};

export const resolveHomeserverBaseUrl = async (input: string): Promise<string> => {
    const trimmed = input.trim();
    if (!trimmed) {
        throw new HomeserverDiscoveryError('Укажите домен, Matrix ID или URL homeserver.');
    }

    const matrixIdMatch = trimmed.match(MATRIX_ID_DOMAIN_PATTERN);
    const withoutMatrixId = matrixIdMatch ? matrixIdMatch[1] : trimmed;

    const stripProtocol = withoutMatrixId.replace(/^https?:\/\//i, '');
    const discoveryTarget = stripProtocol.split('/')[0];

    if (!discoveryTarget) {
        throw new HomeserverDiscoveryError('Некорректный адрес homeserver.');
    }

    let discoveryResult;
    try {
        discoveryResult = await AutoDiscovery.findClientConfig(discoveryTarget);
    } catch (error) {
        throw new HomeserverDiscoveryError('Не удалось выполнить discovery для указанного сервера.');
    }

    const homeserverConfig = discoveryResult['m.homeserver'];
    if (
        !homeserverConfig ||
        homeserverConfig.state !== AutoDiscoveryAction.SUCCESS ||
        !homeserverConfig.base_url
    ) {
        throw new HomeserverDiscoveryError(formatDiscoveryErrorMessage(homeserverConfig?.error));
    }

    return normalizeBaseUrl(homeserverConfig.base_url);
};



// ===== E2EE bootstrap helpers =====
let _idbStore: IndexedDBStore | MemoryStore | null = null;
let _cryptoStore: IndexedDBCryptoStore | null = null;
let _scheduler: MatrixScheduler | null = null;
let rustCryptoInitPromise: Promise<boolean> | null = null;

export const ensureRustCrypto = async (): Promise<boolean> => {
    if (!rustCryptoInitPromise) {
        rustCryptoInitPromise = (async () => {
            try {
                const wasm: any = await import('@matrix-org/matrix-sdk-crypto-wasm');
                if (typeof wasm?.initAsync === 'function') {
                    await wasm.initAsync();
                    return true;
                }
            } catch (e) {
                console.warn('matrix-sdk-crypto-wasm init failed', e);
            }
            return false;
        })();
    }
    return rustCryptoInitPromise;
};

export type CryptoBackendKind = 'rust' | 'legacy' | 'none';

export const initCryptoBackend = async (client: MatrixClient): Promise<CryptoBackendKind> => {
    const anyClient = client as any;

    if (typeof anyClient.initRustCrypto === 'function') {
        const rustReady = await ensureRustCrypto();
        if (rustReady) {
            try {
                await anyClient.initRustCrypto();
                anyClient.setGlobalErrorOnUnknownDevices?.(false);
                return 'rust';
            } catch (e) {
                console.warn('initRustCrypto failed, falling back to legacy Olm backend', e);
            }
        }
    }

    const olmReady = await ensureOlm();
    if (olmReady && typeof anyClient.initCrypto === 'function') {
        try {
            await anyClient.initCrypto();
            anyClient.setGlobalErrorOnUnknownDevices?.(false);
            return 'legacy';
        } catch (e) {
            console.warn('initCrypto failed', e);
        }
    }

    return 'none';
};

export interface EncryptionSessionState {
    roomId: string;
    isEncrypted: boolean;
    algorithm: string | null;
    lastPreparedAt: number | null;
    lastRotatedAt: number | null;
    error?: string | null;
}

const encryptionSessions = new Map<string, EncryptionSessionState>();

const ensureSessionEntry = (roomId: string): EncryptionSessionState => {
    const existing = encryptionSessions.get(roomId);
    if (existing) return existing;
    const created: EncryptionSessionState = {
        roomId,
        isEncrypted: false,
        algorithm: null,
        lastPreparedAt: null,
        lastRotatedAt: null,
        error: null,
    };
    encryptionSessions.set(roomId, created);
    return created;
};

const updateSession = (roomId: string, patch: Partial<EncryptionSessionState>): EncryptionSessionState => {
    const base = ensureSessionEntry(roomId);
    const next = { ...base, ...patch } as EncryptionSessionState;
    encryptionSessions.set(roomId, next);
    return next;
};

const getRoomEncryptionEvent = (room: MatrixRoom | null | undefined): any => {
    try {
        const event = room?.currentState?.getStateEvents?.(EventType.RoomEncryption, '') as any;
        return event?.getContent?.() ?? null;
    } catch (e) {
        console.warn('Failed to read room encryption event', e);
        return null;
    }
};

export const getEncryptionSessionState = (roomId: string): EncryptionSessionState | null => {
    return encryptionSessions.get(roomId) ?? null;
};

export const listEncryptionSessionStates = (): EncryptionSessionState[] => {
    return Array.from(encryptionSessions.values());
};

export interface EnsureRoomEncryptionOptions {
    algorithm?: string;
    rotationPeriodMs?: number;
    rotationPeriodMsgs?: number;
}

export const ensureRoomEncryption = async (
    client: MatrixClient,
    roomId: string,
    options?: EnsureRoomEncryptionOptions,
): Promise<EncryptionSessionState> => {
    const room = client.getRoom(roomId);
    if (!room) {
        throw new Error(`Room ${roomId} not found`);
    }

    const targetAlgorithm = options?.algorithm ?? 'm.megolm.v1.aes-sha2';

    if (!client.isRoomEncrypted(roomId)) {
        try {
            await client.setRoomEncryption(roomId, {
                algorithm: targetAlgorithm,
                rotation_period_ms: options?.rotationPeriodMs,
                rotation_period_msgs: options?.rotationPeriodMsgs,
            } as any);
        } catch (error) {
            const msg = error instanceof Error ? error.message : String(error ?? 'unknown error');
            return updateSession(roomId, { isEncrypted: false, error: msg });
        }
    }

    const crypto = client.getCrypto?.();
    try {
        if (crypto?.prepareToEncrypt) {
            crypto.prepareToEncrypt(room);
        } else {
            (client as any).prepareToEncrypt?.(room);
        }
        const content = getRoomEncryptionEvent(room);
        return updateSession(roomId, {
            isEncrypted: client.isRoomEncrypted(roomId),
            algorithm: (content?.algorithm as string) ?? targetAlgorithm,
            lastPreparedAt: Date.now(),
            error: null,
        });
    } catch (error) {
        const msg = error instanceof Error ? error.message : String(error ?? 'unknown error');
        return updateSession(roomId, {
            isEncrypted: client.isRoomEncrypted(roomId),
            algorithm: targetAlgorithm,
            lastPreparedAt: Date.now(),
            error: msg,
        });
    }
};

export const rotateRoomMegolmSession = (client: MatrixClient, roomId: string): EncryptionSessionState => {
    const crypto = client.getCrypto?.();
    try {
        if (crypto?.forceDiscardSession) {
            crypto.forceDiscardSession(roomId);
        } else {
            (client as any).forceDiscardSession?.(roomId);
        }
    } catch (error) {
        const msg = error instanceof Error ? error.message : String(error ?? 'unknown error');
        return updateSession(roomId, { lastRotatedAt: Date.now(), error: msg });
    }
    return updateSession(roomId, { lastRotatedAt: Date.now(), error: null });
};

const KEY_BACKUP_LABEL = 'econix.matrix.keys.backup';
let keyBackupStopper: (() => void) | null = null;
let lastKeyBackupAt: number | null = null;

const performKeyBackup = async (client: MatrixClient, passphrase: string): Promise<void> => {
    const payload = await exportRoomKeysAsJson(client);
    await saveEncryptedSeed(KEY_BACKUP_LABEL, payload, passphrase);
    lastKeyBackupAt = Date.now();
};

export const backupRoomKeysOnce = async (client: MatrixClient, passphrase: string): Promise<boolean> => {
    if (!passphrase) return false;
    await performKeyBackup(client, passphrase);
    return true;
};

export const restoreRoomKeysFromBackup = async (client: MatrixClient, passphrase: string): Promise<boolean> => {
    if (!passphrase) return false;
    const payload = await loadEncryptedSeed(KEY_BACKUP_LABEL, passphrase);
    if (!payload) return false;
    await importRoomKeysFromJson(client, payload);
    return true;
};

export const startManagedKeyBackup = (
    client: MatrixClient,
    passphraseProvider: () => Promise<string>,
): (() => void) => {
    stopManagedKeyBackup();

    let stopped = false;
    let timer: number | null = null;

    const run = async () => {
        try {
            const pass = await passphraseProvider();
            if (!pass) return;
            await performKeyBackup(client, pass);
        } catch (err) {
            console.warn('Managed key backup failed', err);
        }
    };

    const schedule = () => {
        if (stopped) return;
        timer = window.setTimeout(async () => {
            await run();
            schedule();
        }, 5 * 60 * 1000);
    };

    const beforeUnload = () => { void run(); };
    const onDevicesUpdated = () => { void run(); };

    void run();
    schedule();
    window.addEventListener('beforeunload', beforeUnload);
    (client as any)?.on?.('crypto.devicesUpdated', onDevicesUpdated);

    const stop = () => {
        stopped = true;
        if (timer) window.clearTimeout(timer);
        window.removeEventListener('beforeunload', beforeUnload);
        (client as any)?.removeListener?.('crypto.devicesUpdated', onDevicesUpdated);
        keyBackupStopper = null;
    };

    keyBackupStopper = stop;
    return stop;
};

export const stopManagedKeyBackup = (): void => {
    if (keyBackupStopper) {
        const stopper = keyBackupStopper;
        keyBackupStopper = null;
        stopper();
    }
};

export const getKeyBackupStatus = (): { active: boolean; lastBackupAt: number | null; label: string } => ({
    active: keyBackupStopper !== null,
    lastBackupAt: lastKeyBackupAt,
    label: KEY_BACKUP_LABEL,
});

/**
 * Dynamically load Olm if available. Works in browser and Tauri.
 * Safe to call many times.
 */
let olmInitPromise: Promise<boolean> | null = null;

export const ensureOlm = async (): Promise<boolean> => {
    if ((globalThis as any).Olm && typeof (globalThis as any).Olm.init === 'function') {
        try {
            await (globalThis as any).Olm.init();
            return true;
        } catch (e) {
            console.warn('Olm init failed', e);
        }
    }
    if (!olmInitPromise) {
        olmInitPromise = (async () => {
            try {
                const mod: any = await import('@matrix-org/olm');
                if (mod?.init) {
                    await mod.init();
                    (globalThis as any).Olm = mod;
                    return true;
                }
            } catch (e) {
                console.warn('Olm not available. Falling back to Rust crypto if possible.', e);
            }
            return false;
        })();
    }
    return olmInitPromise;
};

/**
 * Resolve after the first ClientEvent.Sync fires.
 */
const waitForFirstSync = (client: MatrixClient): Promise<void> =>
    new Promise(resolve => {
        const handler = (state: any) => {
            client.removeListener(ClientEvent.Sync as any, handler);
            resolve();
        };
        client.on(ClientEvent.Sync as any, handler);
    });

const delay = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

const createAbortError = (): Error => {
    const error = new Error('Aborted');
    (error as any).name = 'AbortError';
    return error;
};

const bootstrapAuthenticatedClient = async (client: MatrixClient, secureProfile?: SecureCloudProfile): Promise<void> => {
    await initCryptoBackend(client);
    const firstSync = waitForFirstSync(client);
    await (client as any).startClient({ initialSyncLimit: 30, cryptoStore: _cryptoStore } as any);

    try {
        await (client as any).store?.startup?.();
    } catch (e) {
        console.warn('client.store.startup failed or not available', e);
    }

    try {
        // Preload local history from the persistent store before network responses arrive
        const rs = client.getRooms();
        for (const r of rs) {
            try {
                r.getLiveTimeline();
            } catch (_) {
                // ignore
            }
        }
    } catch (e) {
        console.warn('Preload local history failed', e);
    }

    await firstSync;
    try {
        bindOutboxToClient(client);
    } catch (e) {
        console.warn('bindOutboxToClient failed', e);
    }
    try {
        bindSelfDestructWatcher(client);
    } catch (e) {
        console.warn('bindSelfDestructWatcher failed', e);
    }
    if (secureProfile) {
        setSecureCloudProfileForClient(client, secureProfile);
    }
};

export const initClient = async (homeserverUrl: string, accessToken?: string, userId?: string): Promise<MatrixClient> => {
    const options: ICreateClientOpts = {
        baseUrl: homeserverUrl,
    };
    if (!_idbStore) {
        try {
            _idbStore = new IndexedDBStore({
                indexedDB: (globalThis as any).indexedDB,
                localStorage: (globalThis as any).localStorage,
                dbName: 'econix-matrix',
            } as any);
            await _idbStore.startup();
        } catch (e) {
            console.warn('IndexedDBStore unavailable, falling back to memory store.', e);
            _idbStore = null;
        }
    }
    if (!_cryptoStore && (globalThis as any).indexedDB) {
        try {
            _cryptoStore = new IndexedDBCryptoStore((globalThis as any).indexedDB, 'econix-matrix-crypto');
        } catch (e) {
            console.warn('IndexedDBCryptoStore unavailable.', e);
            _cryptoStore = null;
        }
    }

    if (!_idbStore) {
        try {
            _idbStore = new MemoryStore({ localStorage: (globalThis as any).localStorage } as any);
            await (_idbStore as any).startup?.();
        } catch (e) {
            console.warn('MemoryStore unavailable.', e);
            _idbStore = null;
        }
    }

    if (_idbStore) {
        (options as any).store = _idbStore;
    }
    if (_cryptoStore) {
        (options as any).cryptoStore = _cryptoStore as any;
    }

    if (!_scheduler) {
        _scheduler = new MatrixScheduler();
    }
    (options as any).scheduler = _scheduler as any;

    if (accessToken && userId) {
        options.accessToken = accessToken;
        options.userId = userId;
    }
    return createClient(options);
};

export interface LoginOptions {
    secureProfile?: SecureCloudProfile;
    totpCode?: string;
    totpSessionId?: string;
}

export class TotpRequiredError extends Error {
    public readonly sessionId?: string;
    public readonly flows: Array<{ stages?: string[] }>;
    public readonly isValidationError: boolean;

    constructor(
        message: string,
        options: {
            sessionId?: string | null;
            flows?: Array<{ stages?: string[] }>;
            validationError?: boolean;
            cause?: unknown;
        } = {},
    ) {
        super(message);
        this.name = 'TotpRequiredError';
        this.sessionId = options.sessionId ?? undefined;
        this.flows = options.flows ?? [];
        this.isValidationError = Boolean(options.validationError);
        if (options.cause !== undefined) {
            try {
                (this as any).cause = options.cause;
            } catch {
                // ignore assignment failures in restricted environments
            }
        }
    }
}

export const login = async (

    homeserverUrl: string,
    username: string,
    password: string,
    options: LoginOptions = {},

): Promise<MatrixClient> => {
    const client = await initClient(homeserverUrl);

    const identifier = {
        type: 'm.id.user',
        user: username,
    } as const;

    const trimmedTotp = typeof options.totpCode === 'string' ? options.totpCode.trim() : undefined;
    let authPayload: { type: string; code: string; session?: string } | undefined = undefined;
    let totpAttempted = false;
    let sessionHint = options.totpSessionId ?? undefined;

    const performLogin = async () => {
        const payload: Record<string, any> = {
            identifier,
            password,
        };
        if (authPayload) {
            payload.auth = authPayload;
        }
        return await client.login('m.login.password', payload);
    };

    while (true) {
        if (trimmedTotp && !totpAttempted && !authPayload) {
            authPayload = {
                type: 'm.login.totp',
                code: trimmedTotp,
                ...(sessionHint ? { session: sessionHint } : {}),
            };
            totpAttempted = true;
        }

        try {
            await performLogin();
            break;
        } catch (error: any) {
            const matrixError = error ?? {};
            const flows: Array<{ stages?: string[] }> = Array.isArray(matrixError?.data?.flows)
                ? matrixError.data.flows
                : [];
            const sessionId = matrixError?.data?.session ?? sessionHint;
            const requiresTotp = flows.some((flow) => Array.isArray(flow?.stages) && flow.stages.includes('m.login.totp'));

            if (matrixError?.errcode === 'M_FORBIDDEN' && requiresTotp) {
                sessionHint = sessionId ?? sessionHint;
                if (trimmedTotp) {
                    if (totpAttempted && authPayload) {
                        throw new TotpRequiredError(
                            matrixError?.data?.error || matrixError?.message || 'Неверный одноразовый код или код истёк.',
                            {
                                sessionId: sessionHint,
                                flows,
                                validationError: true,
                                cause: error,
                            },
                        );
                    }

                    authPayload = {
                        type: 'm.login.totp',
                        code: trimmedTotp,
                        ...(sessionHint ? { session: sessionHint } : {}),
                    };
                    totpAttempted = true;
                    continue;
                }

                throw new TotpRequiredError(
                    'Эта учётная запись защищена двухфакторной аутентификацией. Введите код из приложения TOTP.',
                    {
                        sessionId: sessionHint,
                        flows,
                        validationError: false,
                        cause: error,
                    },
                );
            }

            throw new Error(matrixError?.data?.error || matrixError?.message || 'Вход не выполнен.');
        }
    }

    await bootstrapAuthenticatedClient(client, options.secureProfile);

    return client;
};

export const register = async (homeserverUrl: string, username: string, password: string): Promise<MatrixClient> => {
    const client = await initClient(homeserverUrl);
    let sessionId: string | null = null;
    let hasAttemptedDummy = false;
    let registerResponse: Awaited<ReturnType<typeof client.register>> | null = null;

    while (true) {
        try {
            registerResponse = await client.register(
                username,
                password,
                sessionId,
                sessionId ? { type: "m.login.dummy", session: sessionId } : { type: "m.login.dummy" },
                undefined,
                undefined,
                true,
            );
            break;
        } catch (error: any) {
            const matrixError = error ?? {};
            const flows: Array<{ stages?: string[] }> = Array.isArray(matrixError?.data?.flows)
                ? matrixError.data.flows
                : [];
            const stages = flows.flatMap((flow) => flow.stages ?? []);

            if (!hasAttemptedDummy && matrixError?.data?.session && flows.length > 0) {
                if (stages.every((stage) => stage === "m.login.dummy") && stages.includes("m.login.dummy")) {
                    sessionId = matrixError.data.session;
                    hasAttemptedDummy = true;
                    continue;
                }

                if (stages.includes("m.login.recaptcha")) {
                    throw new Error(
                        "Сервер требует прохождения капчи. Откройте официальный клиент или веб-интерфейс homeserver'а, чтобы завершить регистрацию.",
                    );
                }

                if (stages.includes("m.login.email.identity")) {
                    throw new Error(
                        "Сервер требует подтверждение email. Завершите регистрацию через официальный клиент и повторите попытку входа.",
                    );
                }

                throw new Error(
                    "Сервер требует дополнительные шаги регистрации, которые пока не поддерживаются. Используйте официальный клиент homeserver'а.",
                );
            }

            if (matrixError?.errcode === "M_USER_IN_USE") {
                throw new Error("Имя пользователя уже занято. Попробуйте другой логин.");
            }

            if (matrixError?.errcode === "M_INVALID_USERNAME") {
                throw new Error("Некорректный логин. Используйте только латиницу, цифры и символы -_.");
            }

            if (matrixError?.errcode === "M_WEAK_PASSWORD") {
                throw new Error("Пароль слишком простой. Добавьте буквы разного регистра, цифры и символы.");
            }

            if (matrixError?.errcode === "M_FORBIDDEN") {
                const rawMessage = (matrixError?.data?.error || matrixError?.message || "").toLowerCase();
                if (rawMessage.includes("registration") && rawMessage.includes("disabled")) {
                    throw new Error(
                        "Регистрация отключена на этом сервере. Свяжитесь с администратором или выберите другой homeserver.",
                    );
                }
            }

            throw new Error(matrixError?.data?.error || matrixError?.message || "Регистрация не удалась.");
        }
    }

    const userId = registerResponse?.user_id || username;
    return await login(homeserverUrl, userId, password);
};

export const loginWithToken = async (homeserverUrl: string, loginToken: string): Promise<MatrixClient> => {
    if (!loginToken) {
        throw new Error('Login token is required.');
    }

    const client = await initClient(homeserverUrl);
    await client.login('m.login.token', { token: loginToken });
    await bootstrapAuthenticatedClient(client);
    return client;
};

export interface GenerateQrLoginOptions {
    pollIntervalMs?: number;
    signal?: AbortSignal;
    fetchFn?: typeof fetch;
}

export interface QrLoginHandle {
    matrixUri?: string | null;
    expiresAt?: number | null;
    fallbackUrl?: string | null;
    pollLoginToken: (options?: { signal?: AbortSignal; pollIntervalMs?: number; timeoutMs?: number }) => Promise<string>;
    cancel: () => Promise<void>;
}

const buildSsoFallbackUrl = (homeserverUrl: string): string => {
    try {
        const url = new URL('/_matrix/client/v3/login/sso/redirect', homeserverUrl);
        url.searchParams.set('redirectUrl', 'https://matrix.to/#/');
        return url.toString();
    } catch (err) {
        console.warn('Failed to build SSO fallback URL', err);
        return homeserverUrl;
    }
};

const readErrorMessage = async (response: Response): Promise<string> => {
    try {
        const text = await response.text();
        if (!text) return '';
        try {
            const parsed = JSON.parse(text);
            return parsed?.error || parsed?.message || text;
        } catch {
            return text;
        }
    } catch {
        return '';
    }
};

export const generateQrLogin = async (homeserverUrl: string, options: GenerateQrLoginOptions = {}): Promise<QrLoginHandle> => {
    const fetchFn = options.fetchFn ?? (typeof fetch !== 'undefined' ? fetch.bind(globalThis) : undefined);
    if (!fetchFn) {
        throw new Error('QR login requires an environment with fetch support.');
    }

    const requestController = new AbortController();
    const externalSignal = options.signal;
    if (externalSignal) {
        if (externalSignal.aborted) {
            throw createAbortError();
        }
        const abortListener = () => requestController.abort();
        externalSignal.addEventListener('abort', abortListener, { once: true });
        requestController.signal.addEventListener(
            'abort',
            () => {
                externalSignal.removeEventListener('abort', abortListener);
            },
            { once: true },
        );
    }

    const codeUrl = new URL('/_matrix/client/v3/login/qr/code', homeserverUrl);
    const response = await fetchFn(codeUrl.toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: requestController.signal,
    });

    if (!response.ok) {
        const errorMessage = await readErrorMessage(response);
        const baseError = errorMessage || 'Сервер не поддерживает вход по QR-коду.';
        throw new Error(baseError);
    }

    const payload: any = await response.json().catch(() => ({}));
    const pollingToken: string | undefined =
        payload?.polling?.token ?? payload?.polling_token ?? payload?.pollingToken ?? payload?.token;

    if (!pollingToken) {
        throw new Error('Сервер не вернул идентификатор QR-сессии.');
    }

    const matrixUri: string | null =
        payload?.qr_code?.uri ?? payload?.qrUri ?? payload?.uri ?? payload?.qr_code_uri ?? payload?.qrCode?.uri ?? null;
    const expiresAt: number | null =
        typeof payload?.expires_at === 'number'
            ? payload.expires_at
            : typeof payload?.expires_in_ms === 'number'
            ? Date.now() + payload.expires_in_ms
            : null;

    const pollUrl =
        payload?.polling?.url ??
        payload?.polling_url ??
        (() => {
            const url = new URL('/_matrix/client/v3/login/qr/attempt', homeserverUrl);
            return url.toString();
        })();

    const cancelUrl: string | null =
        payload?.polling?.cancel_url ??
        payload?.cancel_url ??
        (() => {
            try {
                const url = new URL('/_matrix/client/v3/login/qr/attempt', homeserverUrl);
                return url.toString();
            } catch (err) {
                console.warn('Failed to build QR cancel URL', err);
                return null;
            }
        })();

    const defaultInterval =
        typeof payload?.polling?.interval_ms === 'number'
            ? Math.max(payload.polling.interval_ms, 1000)
            : Math.max(options.pollIntervalMs ?? 5000, 1000);

    const fallbackUrl: string | null = payload?.fallback_url ?? buildSsoFallbackUrl(homeserverUrl);

    const pollLoginToken = async ({ signal, pollIntervalMs, timeoutMs }: { signal?: AbortSignal; pollIntervalMs?: number; timeoutMs?: number } = {}): Promise<string> => {
        const interval = Math.max(pollIntervalMs ?? defaultInterval, 1000);
        const startedAt = Date.now();
        const loopController = new AbortController();

        const abortHandler = () => {
            loopController.abort();
        };

        const cleanup = () => {
            if (signal) {
                signal.removeEventListener('abort', abortHandler);
            }
        };

        if (signal) {
            if (signal.aborted) {
                throw createAbortError();
            }
            signal.addEventListener('abort', abortHandler, { once: true });
        }

        try {
            while (true) {
                if (requestController.signal.aborted || loopController.signal.aborted) {
                    throw createAbortError();
                }

                if (typeof timeoutMs === 'number' && timeoutMs > 0 && Date.now() - startedAt > timeoutMs) {
                    throw new Error('Превышено время ожидания подтверждения QR-входа.');
                }

                if (expiresAt && Date.now() >= expiresAt) {
                    throw new Error('QR-код истёк. Повторите попытку.');
                }

                const attemptResponse = await fetchFn(pollUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ token: pollingToken }),
                    signal: requestController.signal,
                });

                if (attemptResponse.ok) {
                    const result: any = await attemptResponse.json().catch(() => ({}));
                    const loginToken: string | undefined =
                        result?.login_token ?? result?.loginToken ?? result?.token ?? result?.access_token;
                    if (loginToken) {
                        cleanup();
                        return loginToken;
                    }
                } else if (![401, 403, 404].includes(attemptResponse.status)) {
                    const message = await readErrorMessage(attemptResponse);
                    throw new Error(message || 'Не удалось проверить состояние QR-входа.');
                }

                await delay(interval);
            }
        } finally {
            cleanup();
        }
    };

    const cancel = async () => {
        requestController.abort();
        if (!cancelUrl) return;
        try {
            await fetchFn(cancelUrl, {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token: pollingToken }),
            });
        } catch (err) {
            console.warn('Failed to cancel QR login session', err);
        }
    };

    return {
        matrixUri,
        expiresAt,
        fallbackUrl,
        pollLoginToken,
        cancel,
    } satisfies QrLoginHandle;
};

export const findOrCreateSavedMessagesRoom = async (client: MatrixClient): Promise<string> => {
    const userId = client.getUserId()!;
    // FIX: The type 'm.direct' is not present in the SDK's AccountDataEvents type definitions.
    // Casting to `any` bypasses this strict type check for a valid, but untyped, event.
    const directRooms = client.getAccountData('m.direct' as any)?.getContent() || {};
    
    // Check if a DM with self already exists in account data
    if (directRooms[userId] && directRooms[userId].length > 0) {
        const roomId = directRooms[userId][0];
        if (client.getRoom(roomId)) {
            return roomId;
        }
    }

    // Alternative check: find a room with only us as a member
    const rooms = client.getRooms();
    for (const room of rooms) {
        if (room.getJoinedMemberCount() === 1 && room.getMember(userId)) {
            const updatedDirectRooms = { ...directRooms, [userId]: [room.roomId] };
            // FIX: The type 'm.direct' is not present in the SDK's AccountDataEvents type definitions.
            // Casting to `any` bypasses this strict type check for a valid, but untyped, event.
            // FIX: The content is cast to 'any' because the SDK's incomplete typings cause TypeScript to infer an incorrect type for the `setAccountData` content argument when the event type is 'any'.
            await client.setAccountData('m.direct' as any, updatedDirectRooms as any);
            return room.roomId;
        }
    }

    // If no room is found, create a new one
    console.log("No Saved Messages room found, creating one...");
    const { room_id: newRoomId } = await client.createRoom({
        visibility: Visibility.Private,
        is_direct: true,
        // No need to invite self, createRoom adds creator to the room
    });
    
    // Update m.direct account data
    const updatedDirectRooms = { ...directRooms, [userId]: [newRoomId] };
    // FIX: The type 'm.direct' is not present in the SDK's AccountDataEvents type definitions.
    // Casting to `any` bypasses this strict type check for a valid, but untyped, event.
    // FIX: The content is cast to 'any' because the SDK's incomplete typings cause TypeScript to infer an incorrect type for the `setAccountData` content argument when the event type is 'any'.
    await client.setAccountData('m.direct' as any, updatedDirectRooms as any);
    
    console.log(`Created and registered Saved Messages room: ${newRoomId}`);
    return newRoomId;
};


export const mxcToHttp = (client: MatrixClient, mxcUrl: string | null | undefined, size?: number): string | null => {
    if (!mxcUrl || !mxcUrl.startsWith('mxc://')) {
        return mxcUrl || null;
    }
    try {
        if (size) {
            return client.mxcUrlToHttp(mxcUrl, size, size, 'scale', true);
        }
        return client.mxcUrlToHttp(mxcUrl);
    } catch (e) {
        console.error("Failed to convert mxc URL:", e);
        return null;
    }
};

export type SharedMediaCategory = 'media' | 'files' | 'links' | 'voice';

export interface RoomMediaItem {
    eventId: string;
    roomId: string;
    timestamp: number;
    senderId: string;
    senderName: string;
    senderAvatarUrl: string | null;
    body?: string;
    mimetype?: string;
    size?: number;
    url?: string | null;
    thumbnailUrl?: string | null;
    info?: Record<string, unknown> | null;
    eventType: 'm.image' | 'm.video' | 'm.audio' | 'm.file' | 'm.sticker' | 'm.location';
    category: SharedMediaCategory;
    isVoiceMessage?: boolean;
    linkUrl?: string | null;
    geoUri?: string | null;
}

export interface RoomMediaSummary {
    itemsByCategory: Record<SharedMediaCategory, RoomMediaItem[]>;
    countsByCategory: Record<SharedMediaCategory, number>;
    hasMore: boolean;
    eventIds: string[];
}

export interface RoomMediaPaginationOptions {
    limit?: number;
    knownEventIds?: Set<string>;
}

export interface RoomMediaPaginationResult {
    itemsByCategory: Record<SharedMediaCategory, RoomMediaItem[]>;
    countsByCategory: Record<SharedMediaCategory, number>;
    newEventIds: string[];
    hasMore: boolean;
}

const createCategoryBuckets = (): Record<SharedMediaCategory, RoomMediaItem[]> => ({
    media: [],
    files: [],
    links: [],
    voice: [],
});

const thumbnailCache = new Map<string, string | null>();

const getThumbnailFromCache = (
    client: MatrixClient,
    mxcUrl: string | undefined,
    size?: number,
): string | null => {
    if (!mxcUrl) {
        return null;
    }
    const key = `${mxcUrl}|${size ?? 0}`;
    if (thumbnailCache.has(key)) {
        return thumbnailCache.get(key) ?? null;
    }
    const httpUrl = mxcToHttp(client, mxcUrl, size);
    thumbnailCache.set(key, httpUrl ?? null);
    return httpUrl ?? null;
};

const deriveSenderInfo = (client: MatrixClient, room: MatrixRoom, senderId: string) => {
    const member = room.getMember?.(senderId);
    const senderName = member?.name || senderId;
    const senderAvatarUrl = member?.getMxcAvatarUrl ? mxcToHttp(client, member.getMxcAvatarUrl(), 96) : null;
    return { senderName, senderAvatarUrl };
};

const buildMediaItemsFromEvent = (
    client: MatrixClient,
    room: MatrixRoom,
    event: MatrixEvent,
): RoomMediaItem[] => {
    const eventType = event.getType();
    const items: RoomMediaItem[] = [];
    const eventId = event.getId() || event.getTxnId();
    if (!eventId) {
        return items;
    }

    if (eventType !== EventType.RoomMessage && eventType !== EventType.Sticker) {
        return items;
    }

    const content: any = event.getContent() ?? {};
    const msgtype = content.msgtype;

    const senderId = event.getSender() || '';
    const { senderName, senderAvatarUrl } = deriveSenderInfo(client, room, senderId);
    const timestamp = event.getTs?.() ?? Date.now();
    const commonBase: Partial<RoomMediaItem> = {
        eventId,
        roomId: room.roomId,
        timestamp,
        senderId,
        senderName,
        senderAvatarUrl,
        body: typeof content.body === 'string' ? content.body : undefined,
        mimetype: typeof content?.info?.mimetype === 'string' ? content.info.mimetype : undefined,
        size: typeof content?.info?.size === 'number' ? content.info.size : undefined,
        info: typeof content?.info === 'object' && content.info ? content.info as Record<string, unknown> : null,
    };

    const pushItem = (item: RoomMediaItem) => {
        items.push(item);
    };

    const ensureMainUrl = (mxcUrl?: string | null, sizeHint?: number) => {
        if (!mxcUrl) return null;
        return mxcToHttp(client, mxcUrl, sizeHint ?? undefined);
    };

    if (eventType === EventType.Sticker) {
        const thumbnail = getThumbnailFromCache(client, content?.info?.thumbnail_url || content?.info?.thumbnail_file?.url, 256);
        pushItem({
            ...commonBase,
            eventType: 'm.sticker',
            category: 'media',
            thumbnailUrl: thumbnail ?? ensureMainUrl(content?.url ?? null, 320),
            url: ensureMainUrl(content?.url ?? null),
        } as RoomMediaItem);
        return items;
    }

    switch (msgtype) {
        case MsgType.Image: {
            const mxcUrl = content?.file?.url || content?.url;
            const thumbMxc = content?.info?.thumbnail_file?.url || content?.info?.thumbnail_url;
            const thumbnailUrl = getThumbnailFromCache(client, thumbMxc, 512) ?? ensureMainUrl(mxcUrl, 512);
            pushItem({
                ...commonBase,
                eventType: 'm.image',
                category: 'media',
                url: ensureMainUrl(mxcUrl),
                thumbnailUrl,
            } as RoomMediaItem);
            break;
        }
        case MsgType.Video: {
            const mxcUrl = content?.file?.url || content?.url;
            const thumbMxc = content?.info?.thumbnail_file?.url || content?.info?.thumbnail_url;
            const thumbnailUrl = getThumbnailFromCache(client, thumbMxc, 512);
            pushItem({
                ...commonBase,
                eventType: 'm.video',
                category: 'media',
                url: ensureMainUrl(mxcUrl),
                thumbnailUrl: thumbnailUrl ?? ensureMainUrl(mxcUrl, 256),
            } as RoomMediaItem);
            break;
        }
        case MsgType.Audio: {
            const isVoice = Boolean(content?.['org.matrix.msc3245.voice'] || content?.voice);
            const thumbMxc = content?.info?.thumbnail_file?.url || content?.info?.thumbnail_url;
            const thumbnailUrl = getThumbnailFromCache(client, thumbMxc, 256);
            pushItem({
                ...commonBase,
                eventType: 'm.audio',
                category: isVoice ? 'voice' : 'media',
                url: ensureMainUrl(content?.file?.url || content?.url),
                thumbnailUrl,
                isVoiceMessage: isVoice,
            } as RoomMediaItem);
            break;
        }
        case MsgType.File: {
            const mxcUrl = content?.file?.url || content?.url;
            const thumbMxc = content?.info?.thumbnail_file?.url || content?.info?.thumbnail_url;
            pushItem({
                ...commonBase,
                eventType: 'm.file',
                category: 'files',
                url: ensureMainUrl(mxcUrl),
                thumbnailUrl: getThumbnailFromCache(client, thumbMxc, 256),
            } as RoomMediaItem);
            break;
        }
        case MsgType.Location: {
            const thumbMxc = content?.info?.thumbnail_file?.url || content?.info?.thumbnail_url;
            const externalUrl = typeof content?.external_url === 'string' ? content.external_url : undefined;
            const geoUri = typeof content?.geo_uri === 'string' ? content.geo_uri : undefined;
            pushItem({
                ...commonBase,
                eventType: 'm.location',
                category: 'links',
                url: externalUrl || geoUri || undefined,
                linkUrl: externalUrl || geoUri || null,
                geoUri: geoUri || null,
                thumbnailUrl: getThumbnailFromCache(client, thumbMxc, 256),
            } as RoomMediaItem);
            break;
        }
        default:
            break;
    }

    return items;
};

const mergeItemsIntoBuckets = (
    buckets: Record<SharedMediaCategory, RoomMediaItem[]>,
    items: RoomMediaItem[],
) => {
    for (const item of items) {
        buckets[item.category].push(item);
    }
};

const toCounts = (buckets: Record<SharedMediaCategory, RoomMediaItem[]>): Record<SharedMediaCategory, number> => ({
    media: buckets.media.length,
    files: buckets.files.length,
    links: buckets.links.length,
    voice: buckets.voice.length,
});

const sortBuckets = (buckets: Record<SharedMediaCategory, RoomMediaItem[]>) => {
    for (const key of Object.keys(buckets) as SharedMediaCategory[]) {
        buckets[key] = buckets[key].sort((a, b) => b.timestamp - a.timestamp);
    }
};

export const getRoomMediaSummary = (
    client: MatrixClient,
    room: MatrixRoom,
    options?: { limit?: number },
): RoomMediaSummary => {
    const limit = options?.limit ?? 50;
    const buckets = createCategoryBuckets();
    const timeline = room.getLiveTimeline?.();
    const events = timeline?.getEvents?.() ?? [];
    const sortedEvents = [...events].sort((a, b) => (b.getTs?.() ?? 0) - (a.getTs?.() ?? 0));
    const eventIds = new Set<string>();

    for (const event of sortedEvents) {
        if (eventIds.size >= limit) {
            break;
        }
        const items = buildMediaItemsFromEvent(client, room, event);
        if (!items.length) continue;
        mergeItemsIntoBuckets(buckets, items);
        const id = event.getId() || event.getTxnId();
        if (id) {
            eventIds.add(id);
        }
    }

    sortBuckets(buckets);
    const hasMore = Boolean(room.canPaginate?.('b', timeline)) || (timeline?.getPaginationToken?.('b') ?? null) != null;

    return {
        itemsByCategory: buckets,
        countsByCategory: toCounts(buckets),
        hasMore,
        eventIds: Array.from(eventIds),
    };
};

export const paginateRoomMedia = async (
    client: MatrixClient,
    room: MatrixRoom,
    options: RoomMediaPaginationOptions = {},
): Promise<RoomMediaPaginationResult> => {
    const { limit = 30, knownEventIds = new Set<string>() } = options;
    const buckets = createCategoryBuckets();
    const timeline = room.getLiveTimeline?.();
    if (!timeline) {
        return {
            itemsByCategory: buckets,
            countsByCategory: toCounts(buckets),
            newEventIds: [],
            hasMore: false,
        };
    }

    const canPaginate = room.canPaginate?.('b', timeline) ?? Boolean(timeline.getPaginationToken?.('b'));
    if (!canPaginate) {
        return {
            itemsByCategory: buckets,
            countsByCategory: toCounts(buckets),
            newEventIds: [],
            hasMore: false,
        };
    }

    const ok = await client.paginateEventTimeline(timeline, { backwards: true, limit });
    if (!ok) {
        return {
            itemsByCategory: buckets,
            countsByCategory: toCounts(buckets),
            newEventIds: [],
            hasMore: room.canPaginate?.('b', timeline) ?? false,
        };
    }

    const events = timeline.getEvents?.() ?? [];
    const sortedEvents = [...events].sort((a, b) => (b.getTs?.() ?? 0) - (a.getTs?.() ?? 0));
    const newIds = new Set<string>();
    for (const event of sortedEvents) {
        const id = event.getId() || event.getTxnId();
        if (!id || knownEventIds.has(id)) {
            continue;
        }
        const items = buildMediaItemsFromEvent(client, room, event);
        if (!items.length) continue;
        mergeItemsIntoBuckets(buckets, items);
        newIds.add(id);
        if (newIds.size >= limit) {
            break;
        }
    }

    sortBuckets(buckets);
    const hasMore = room.canPaginate?.('b', timeline) ?? Boolean(timeline.getPaginationToken?.('b'));

    return {
        itemsByCategory: buckets,
        countsByCategory: toCounts(buckets),
        newEventIds: Array.from(newIds),
        hasMore,
    };
};

// ===== Space hierarchy helpers =====

export const SPACE_ROOM_TYPE = 'm.space';

export interface SpaceRoomSummary {
    roomId: string;
    name: string;
    topic?: string;
    avatarUrl: string | null;
    roomType?: string | null;
    canonicalAlias?: string | null;
    numJoinedMembers?: number;
    worldReadable?: boolean;
    guestCanJoin?: boolean;
    isSpace: boolean;
    parentIds: string[];
}

export interface SpaceHierarchyRelation {
    viaServers: string[];
    suggested: boolean;
    order?: string;
}

export interface SpaceHierarchyNode extends SpaceRoomSummary {
    relation?: SpaceHierarchyRelation;
    children: SpaceHierarchyNode[];
    depth: number;
}

export interface SpaceHierarchyOptions {
    limit?: number;
    maxDepth?: number;
    suggestedOnly?: boolean;
    from?: string;
}

export interface SpaceHierarchyResult {
    root: SpaceHierarchyNode | null;
    rooms: Record<string, SpaceRoomSummary>;
    nextBatch?: string;
}

export interface SpaceChildOptions {
    viaServers?: string[];
    order?: string;
    suggested?: boolean;
    canonical?: boolean;
}

export const isSpaceRoom = (room?: MatrixRoom | null): boolean => {
    if (!room) {
        return false;
    }
    try {
        return room.getType?.() === SPACE_ROOM_TYPE;
    } catch (error) {
        console.warn('Failed to read room type for space detection', error);
        return false;
    }
};

export const getJoinedSpaces = (client: MatrixClient): MatrixRoom[] => {
    return client
        .getRooms()
        .filter(room => room.getMyMembership?.() === 'join' && isSpaceRoom(room));
};

export interface CreateSpaceOptions {
    name: string;
    topic?: string;
    isPublic?: boolean;
    invite?: string[];
    alias?: string;
    powerLevelContentOverride?: Record<string, unknown>;
}

export const createSpace = async (client: MatrixClient, options: CreateSpaceOptions): Promise<string> => {
    const {
        name,
        topic,
        isPublic = false,
        invite,
        alias,
        powerLevelContentOverride,
    } = options;

    const createOptions: ICreateRoomOpts = {
        name,
        topic,
        visibility: isPublic ? Visibility.Public : Visibility.Private,
        preset: isPublic ? Preset.PublicChat : Preset.PrivateChat,
        creation_content: { type: SPACE_ROOM_TYPE },
    };

    if (alias) {
        createOptions.room_alias_name = alias;
    }
    if (invite?.length) {
        createOptions.invite = invite;
    }
    if (powerLevelContentOverride) {
        createOptions.power_level_content_override = powerLevelContentOverride as any;
    }

    const { room_id } = await client.createRoom(createOptions);
    return room_id;
};

export const linkRoomToSpace = async (
    client: MatrixClient,
    spaceId: string,
    childRoomId: string,
    options?: SpaceChildOptions,
): Promise<void> => {
    const viaServers = options?.viaServers?.filter(Boolean) ?? [];
    const childContent: Record<string, unknown> = {};
    if (viaServers.length) {
        childContent.via = viaServers;
    }
    if (options?.order) {
        childContent.order = options.order;
    }
    if (typeof options?.suggested === 'boolean') {
        childContent.suggested = options.suggested;
    }

    await client.sendStateEvent(spaceId, EventType.SpaceChild, childContent, childRoomId);

    const parentContent: Record<string, unknown> = {};
    if (viaServers.length) {
        parentContent.via = viaServers;
    }
    if (typeof options?.canonical === 'boolean') {
        parentContent.canonical = options.canonical;
    }

    await client.sendStateEvent(childRoomId, EventType.SpaceParent, parentContent, spaceId);
};

export const unlinkRoomFromSpace = async (
    client: MatrixClient,
    spaceId: string,
    childRoomId: string,
): Promise<void> => {
    await client.sendStateEvent(spaceId, EventType.SpaceChild, {}, childRoomId);
    await client.sendStateEvent(childRoomId, EventType.SpaceParent, {}, spaceId);
};

type HierarchyEdge = {
    childId: string;
    relation: SpaceHierarchyRelation;
};

const ensureSpaceSummary = (
    summaries: Map<string, SpaceRoomSummary>,
    client: MatrixClient,
    room: Partial<HierarchyRoom> & { room_id: string },
): SpaceRoomSummary => {
    if (!summaries.has(room.room_id)) {
        const initialAvatar = room.avatar_url !== undefined ? mxcToHttp(client, room.avatar_url || null) : null;
        const initialRoomType = room.room_type ?? null;
        summaries.set(room.room_id, {
            roomId: room.room_id,
            name: room.name || room.canonical_alias || room.room_id,
            topic: typeof room.topic === 'string' ? room.topic : undefined,
            avatarUrl: initialAvatar,
            roomType: initialRoomType,
            canonicalAlias: room.canonical_alias ?? null,
            numJoinedMembers: room.num_joined_members,
            worldReadable: room.world_readable,
            guestCanJoin: room.guest_can_join,
            isSpace: initialRoomType === SPACE_ROOM_TYPE,
            parentIds: [],
        });
    }

    const summary = summaries.get(room.room_id)!;
    if (typeof room.name === 'string' && room.name.trim().length > 0) {
        summary.name = room.name;
    } else if (!summary.name && typeof room.canonical_alias === 'string') {
        summary.name = room.canonical_alias;
    }
    if (typeof room.topic === 'string') {
        summary.topic = room.topic;
    }
    if (room.avatar_url !== undefined) {
        summary.avatarUrl = mxcToHttp(client, room.avatar_url || null);
    }
    if (room.room_type !== undefined) {
        summary.roomType = room.room_type ?? null;
        summary.isSpace = summary.isSpace || room.room_type === SPACE_ROOM_TYPE;
    }
    if (room.canonical_alias !== undefined) {
        summary.canonicalAlias = room.canonical_alias ?? null;
    }
    if (room.num_joined_members !== undefined) {
        summary.numJoinedMembers = room.num_joined_members;
    }
    if (room.world_readable !== undefined) {
        summary.worldReadable = room.world_readable;
    }
    if (room.guest_can_join !== undefined) {
        summary.guestCanJoin = room.guest_can_join;
    }

    return summary;
};

export const getSpaceHierarchy = async (
    client: MatrixClient,
    spaceId: string,
    options?: SpaceHierarchyOptions,
): Promise<SpaceHierarchyResult> => {
    const hierarchy = await (client as any).getRoomHierarchy(
        spaceId,
        options?.limit,
        options?.maxDepth,
        options?.suggestedOnly ?? false,
        options?.from,
    );

    const rooms = (hierarchy?.rooms as HierarchyRoom[] | undefined) ?? [];
    const summaries = new Map<string, SpaceRoomSummary>();
    const edges = new Map<string, HierarchyEdge[]>();

    if (!rooms.length) {
        // Ensure we still have a summary entry for the requested space if it is known locally.
        const localRoom = client.getRoom(spaceId);
        if (localRoom) {
            summaries.set(spaceId, {
                roomId: localRoom.roomId,
                name: localRoom.name || localRoom.roomId,
                topic: localRoom.currentState.getStateEvents(EventType.RoomTopic, '')?.getContent()?.topic,
                avatarUrl: mxcToHttp(client, localRoom.getMxcAvatarUrl()),
                roomType: localRoom.getType() || null,
                canonicalAlias:
                    localRoom.currentState.getStateEvents(EventType.RoomCanonicalAlias, '')?.getContent()?.alias || null,
                numJoinedMembers: localRoom.getJoinedMemberCount(),
                worldReadable: undefined,
                guestCanJoin: undefined,
                isSpace: isSpaceRoom(localRoom),
                parentIds: [],
            });
        }
    }

    rooms.forEach(room => {
        const summary = ensureSpaceSummary(summaries, client, room);
        const childRelations = room.children_state || [];
        if (!edges.has(room.room_id)) {
            edges.set(room.room_id, []);
        }

        childRelations.forEach(relation => {
            const childId = relation.state_key;
            if (!childId) {
                return;
            }

            ensureSpaceSummary(summaries, client, { room_id: childId });
            const childSummary = summaries.get(childId)!;
            if (!childSummary.parentIds.includes(room.room_id)) {
                childSummary.parentIds.push(room.room_id);
            }

            const viaServers = Array.isArray(relation.content?.via)
                ? (relation.content?.via as string[]).filter((value): value is string => !!value)
                : [];
            const relationInfo: SpaceHierarchyRelation = {
                viaServers,
                suggested: !!relation.content?.suggested,
                order: relation.content?.order,
            };

            const list = edges.get(room.room_id)!;
            const existingIndex = list.findIndex(edge => edge.childId === childId);
            if (existingIndex >= 0) {
                list[existingIndex] = { childId, relation: relationInfo };
            } else {
                list.push({ childId, relation: relationInfo });
            }
        });
    });

    const buildNode = (
        roomId: string,
        relation: SpaceHierarchyRelation | undefined,
        depth: number,
    ): SpaceHierarchyNode => {
        const summary = summaries.get(roomId) ?? {
            roomId,
            name: roomId,
            topic: undefined,
            avatarUrl: null,
            roomType: null,
            canonicalAlias: null,
            numJoinedMembers: undefined,
            worldReadable: undefined,
            guestCanJoin: undefined,
            isSpace: false,
            parentIds: [],
        };

        const childEdges = edges.get(roomId) ?? [];
        const children = childEdges
            .map(edge => buildNode(edge.childId, edge.relation, depth + 1))
            .sort((a, b) => {
                const aOrder = a.relation?.order ?? '';
                const bOrder = b.relation?.order ?? '';
                if (aOrder && bOrder && aOrder !== bOrder) {
                    return aOrder.localeCompare(bOrder);
                }
                if (aOrder && !bOrder) {
                    return -1;
                }
                if (!aOrder && bOrder) {
                    return 1;
                }
                return a.name.localeCompare(b.name);
            });

        return {
            ...summary,
            parentIds: [...summary.parentIds],
            relation,
            children,
            depth,
        };
    };

    const root = summaries.has(spaceId) ? buildNode(spaceId, undefined, 0) : null;

    const roomsRecord: Record<string, SpaceRoomSummary> = {};
    summaries.forEach(summary => {
        roomsRecord[summary.roomId] = {
            ...summary,
            parentIds: [...summary.parentIds],
        };
    });

    return {
        root,
        rooms: roomsRecord,
        nextBatch: hierarchy?.next_batch,
    };
};

const URL_REGEX = /(https?:\/\/[^\s]+)/;


type SendMessageInput = string | { body: string; formattedBody?: string; format?: string };

export function sendMessage(
    client: MatrixClient,
    roomId: string,
    input: SendMessageInput,
    replyToEvent?: MatrixEvent,
    threadRootId?: string,
    roomMembers: MatrixUser[] = []
): Promise<{ event_id: string }> {
    return (async () => {
        const payload = typeof input === 'string' ? { body: input } : input;
        const body = payload.body;
        const mentionedUserIds = new Set<string>();
        const formattedBodyParts: string[] = [];
        const parts = body.split(/(@[a-zA-Z0-9\._-]*)/g);

        parts.forEach(part => {
            if (part.startsWith('@')) {
                const member = roomMembers.find(m => m.displayName === part.substring(1) || m.userId === part);
                if (member) {
                    mentionedUserIds.add(member.userId);
                    formattedBodyParts.push(`<a href="https://matrix.to/#/${member.userId}">${member.displayName}</a>`);
                    return;
                }
            }
            formattedBodyParts.push(part.replace(/</g, '&lt;').replace(/>/g, '&gt;'));
        });

        const content: any = {
            msgtype: MsgType.Text,
            body: body,
        };

        if (payload.formattedBody) {
            content.format = payload.format ?? 'org.matrix.custom.html';
            content.formatted_body = payload.formattedBody;
        }

        if (mentionedUserIds.size > 0) {
            content.format = content.format ?? 'org.matrix.custom.html';
            if (!content.formatted_body) {
                content.formatted_body = formattedBodyParts.join('');
            }
            content['m.mentions'] = {
                user_ids: Array.from(mentionedUserIds),
            };
        }

        const urlMatch = body.match(URL_REGEX);
        if (urlMatch) {
            try {
                // FIX: The `getUrlPreview` method requires a timestamp as its second argument. Passing `Date.now()` to satisfy this requirement.
                const previewData = await client.getUrlPreview(urlMatch[0], Date.now());
                if (previewData && Object.keys(previewData).length > 0) {
                    const imageUrl = previewData['og:image'] ? mxcToHttp(client, previewData['og:image']) : undefined;

                    content['custom.url_preview'] = {
                        url: previewData['og:url'] || urlMatch[0],
                        image: imageUrl,
                        title: previewData['og:title'],
                        description: previewData['og:description'],
                        siteName: previewData['og:site_name'],
                    };
                }
            } catch (e) {
                console.warn('Failed to get URL preview:', e);
            }
        }

        if (threadRootId) {
            content['m.relates_to'] = {
                'rel_type': 'm.thread',
                'event_id': threadRootId,
                ...(replyToEvent && {
                    'm.in_reply_to': {
                        'event_id': replyToEvent.getId(),
                    }
                }),
            };
        } else if (replyToEvent) {
            content['m.relates_to'] = {
                'm.in_reply_to': {
                    'event_id': replyToEvent.getId(),
                },
            };
        }

        let ttlForMessage = getNextMessageTTL(roomId);
        if (ttlForMessage == null) {
            ttlForMessage = await getRoomTTL(client, roomId);
        }
        if (typeof ttlForMessage === 'number' && ttlForMessage > 0) {
            const expiresAt = Date.now() + ttlForMessage;
            content[SELF_DESTRUCT_CONTENT_KEY] = {
                ttlMs: ttlForMessage,
                expiresAt,
            };
        }

        const queueOutbox = async () => {
            const localId = await enqueueOutbox(roomId, EventType.RoomMessage, content, {
                threadRootId,
                replyToEventId: replyToEvent?.getId(),
            });
            clearNextMessageTTL(roomId);
            return { event_id: localId };
        };

        if (isOffline()) {
            return queueOutbox();
        }

        try {
            const result = await client.sendEvent(roomId, EventType.RoomMessage, content);
            clearNextMessageTTL(roomId);
            return result;
        } catch (error: any) {
            if (shouldQueueFromError(error)) {
                return queueOutbox();
            }
            throw error;
        }
    })();
}

export const compressImage = (file: File, maxWidth = 1280): Promise<File> => {
    if (!file.type.startsWith('image/')) {
        return Promise.resolve(file); // Don't compress non-images
    }

    return new Promise((resolve, reject) => {
        const img = document.createElement('img');
        img.src = URL.createObjectURL(file);
        img.onload = () => {
            URL.revokeObjectURL(img.src);
            if (img.width <= maxWidth) {
                return resolve(file); // Don't upscale or re-compress if already small enough
            }

            const canvas = document.createElement('canvas');
            const scale = maxWidth / img.width;
            canvas.width = maxWidth;
            canvas.height = img.height * scale;
            
            const ctx = canvas.getContext('2d');
            if (!ctx) {
                return reject(new Error('Could not get canvas context'));
            }
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            canvas.toBlob(
                (blob) => {
                    if (!blob) {
                        return reject(new Error('Canvas to Blob failed'));
                    }
                    const newFileName = file.name.replace(/\.[^/.]+$/, "") + ".jpg";
                    const newFile = new File([blob], newFileName, { type: 'image/jpeg', lastModified: Date.now() });
                    resolve(newFile);
                },
                'image/jpeg',
                0.8 // 80% quality
            );
        };
        img.onerror = (error) => {
            URL.revokeObjectURL(img.src);
            reject(error);
        };
    });
};


export const sendImageMessage = async (client: MatrixClient, roomId: string, file: File): Promise<{ event_id: string }> => {
    const compressedFile = await compressImage(file);

    const content = {
        body: compressedFile.name,
        info: {
            mimetype: compressedFile.type,
            size: compressedFile.size,
        },
        msgtype: MsgType.Image,
        url: undefined as unknown as string,
    };
    const sendDirect = async () => {
        const { content_uri: mxcUrl } = await client.uploadContent(compressedFile, {
            name: compressedFile.name,
            type: compressedFile.type,
        });
        return client.sendEvent(roomId, EventType.RoomMessage, { ...content, url: mxcUrl } as any);
    };

    const queueOutbox = async () => {
        const attachment = await serializeOutboxAttachment(compressedFile, {
            name: compressedFile.name,
            contentPath: 'url',
            kind: 'image',
        });
        const localId = await enqueueOutbox(roomId, EventType.RoomMessage, content, { attachments: [attachment] });
        return { event_id: localId };
    };

    if (isOffline()) {
        return queueOutbox();
    }

    try {
        return await sendDirect();
    } catch (error) {
        if (shouldQueueFromError(error)) {
            return queueOutbox();
        }
        throw error;
    }
};

export const sendAudioMessage = async (client: MatrixClient, roomId: string, file: Blob, duration: number): Promise<{ event_id: string }> => {
    const content = {
        body: "Voice Message",
        info: {
            mimetype: file.type,
            size: file.size,
            duration: Math.round(duration * 1000), // duration in milliseconds
        },
        msgtype: MsgType.Audio,
        url: undefined as unknown as string,
    };
    const sendDirect = async () => {
        const { content_uri: mxcUrl } = await client.uploadContent(file, {
            name: "voice-message.ogg",
            type: file.type,
        });
        return client.sendEvent(roomId, EventType.RoomMessage, { ...content, url: mxcUrl } as any);
    };

    const queueOutbox = async () => {
        const attachment = await serializeOutboxAttachment(file, {
            name: 'voice-message.ogg',
            contentPath: 'url',
            kind: 'audio',
        });
        const localId = await enqueueOutbox(roomId, EventType.RoomMessage, content, { attachments: [attachment] });
        return { event_id: localId };
    };

    if (isOffline()) {
        return queueOutbox();
    }

    try {
        return await sendDirect();
    } catch (error) {
        if (shouldQueueFromError(error)) {
            return queueOutbox();
        }
        throw error;
    }
};


export const sendFileMessage = async (client: MatrixClient, roomId: string, file: File): Promise<{ event_id: string }> => {
    const content = {
        body: file.name,
        info: {
            mimetype: file.type,
            size: file.size,
        },
        msgtype: MsgType.File,
        url: undefined as unknown as string,
    };
    const sendDirect = async () => {
        const { content_uri: mxcUrl } = await client.uploadContent(file, {
            name: file.name,
            type: file.type,
        });
        return client.sendEvent(roomId, EventType.RoomMessage, { ...content, url: mxcUrl } as any);
    };

    const queueOutbox = async () => {
        const attachment = await serializeOutboxAttachment(file, {
            name: file.name,
            contentPath: 'url',
            kind: 'file',
        });
        const localId = await enqueueOutbox(roomId, EventType.RoomMessage, content, { attachments: [attachment] });
        return { event_id: localId };
    };

    if (isOffline()) {
        return queueOutbox();
    }

    try {
        return await sendDirect();
    } catch (error) {
        if (shouldQueueFromError(error)) {
            return queueOutbox();
        }
        throw error;
    }
};

export const sendStickerMessage = async (client: MatrixClient, roomId: string, stickerUrl: string, body: string, info: Sticker['info']): Promise<{ event_id: string }> => {
    const content = {
        body,
        info,
        url: stickerUrl,
        msgtype: 'm.sticker',
    };
    // The matrix-js-sdk doesn't have m.sticker in its standard event types, so we cast to any.
    if (isOffline()) {
        const localId = await enqueueOutbox(roomId, 'm.sticker', content);
        return { event_id: localId };
    }

    try {
        return await client.sendEvent(roomId, 'm.sticker' as any, content);
    } catch (error) {
        if (shouldQueueFromError(error)) {
            const localId = await enqueueOutbox(roomId, 'm.sticker', content);
            return { event_id: localId };
        }
        throw error;
    }
};

export const sendGifMessage = async (client: MatrixClient, roomId: string, gif: Gif): Promise<{ event_id: string }> => {
    // We send GIFs as m.image events. We add a custom flag to help our UI distinguish it.
    const { url, title, dims } = gif;

    // FIX: The `uploadContentFromUrl` method does not exist on the MatrixClient type.
    // The correct procedure is to fetch the content from the URL, convert it to a Blob,
    // and then upload it using `uploadContent`.
    const content = {
        body: title,
        info: {
            mimetype: 'image/gif',
            w: dims[0],
            h: dims[1],
            'xyz.amorgan.is_gif': true,
        },
        msgtype: MsgType.Image,
        url: undefined as unknown as string,
    };
    const sendDirect = async () => {
        const response = await fetch(url);
        const blob = await response.blob();
        const { content_uri: mxcUrl } = await client.uploadContent(blob, {
            name: title,
            type: 'image/gif',
        });
        return client.sendEvent(roomId, EventType.RoomMessage, { ...content, url: mxcUrl } as any);
    };

    const queueOutbox = async () => {
        const attachment = createRemoteOutboxAttachment(url, {
            name: title,
            mimeType: 'image/gif',
            kind: 'image',
            contentPath: 'url',
        });
        const localId = await enqueueOutbox(roomId, EventType.RoomMessage, content, { attachments: [attachment] });
        return { event_id: localId };
    };

    if (isOffline()) {
        return queueOutbox();
    }

    try {
        return await sendDirect();
    } catch (error) {
        if (shouldQueueFromError(error)) {
            return queueOutbox();
        }
        throw error;
    }
};

export const sendReaction = async (client: MatrixClient, roomId: string, eventId: string, emoji: string): Promise<void> => {
    const content = {
        'm.relates_to': {
            'rel_type': RelationType.Annotation,
            'event_id': eventId,
            'key': emoji,
        },
    };
    if (isOffline()) {
        await enqueueOutbox(roomId, EventType.Reaction, content);
        return;
    }

    try {
        await client.sendEvent(roomId, EventType.Reaction, content as any);
    } catch (error) {
        if (shouldQueueFromError(error)) {
            await enqueueOutbox(roomId, EventType.Reaction, content);
            return;
        }
        throw error;
    }
};

export const sendTypingIndicator = async (client: MatrixClient, roomId: string, isTyping: boolean): Promise<void> => {
    try {
        await client.sendTyping(roomId, isTyping, 6000);
    } catch (error) {
        console.error("Failed to send typing indicator:", error);
    }
};

export const editMessage = async (client: MatrixClient, roomId: string, eventId: string, newBody: string): Promise<void> => {
    const content = {
        'body': `* ${newBody}`,
        'msgtype': MsgType.Text,
        'm.new_content': {
            'body': newBody,
            'msgtype': MsgType.Text,
        },
        'm.relates_to': {
            'rel_type': RelationType.Replace,
            'event_id': eventId,
        },
    };
    await client.sendEvent(roomId, EventType.RoomMessage, content as any);
};

export const deleteMessage = async (client: MatrixClient, roomId: string, eventId: string): Promise<void> => {
    try {
        await client.redactEvent(roomId, eventId);
    } catch (error)
        {
        console.error("Failed to delete message:", error);
    }
};

export const forwardMessage = async (client: MatrixClient, targetRoomId: string, originalEvent: MatrixEvent): Promise<{ event_id: string }> => {
    const originalContent = originalEvent.getContent();
    const newContent = { ...originalContent };

    // Remove relation to not make it a reply in the new room
    delete newContent['m.relates_to'];

    if (originalContent.msgtype === MsgType.Text) {
        const senderDisplayName = originalEvent.sender?.name || originalEvent.getSender();
        newContent.body = `Forwarded message from ${senderDisplayName}:\n${originalContent.body}`;
        if (originalContent.formatted_body) {
            newContent.formatted_body = `<blockquote><p>Forwarded message from ${senderDisplayName}:</p>${originalContent.formatted_body}</blockquote>`;
        }
    }

    // FIX: The `getType()` method returns a generic `string`, which is not assignable to the
    // specific event type keys expected by `sendEvent`. Casting to `any` bypasses this
    // strict type check.
    return client.sendEvent(targetRoomId, originalEvent.getType() as any, newContent);
};

export const sendReadReceipt = async (client: MatrixClient, roomId: string, eventId: string): Promise<void> => {
    try {
        const room = client.getRoom(roomId);
        const event = room?.findEventById(eventId);
        if (event) {
            await client.sendReadReceipt(event);
        } else {
            console.warn(`Could not find event ${eventId} in room ${roomId} to mark as read.`);
        }
    } catch (error) {
        console.error("Failed to send read receipt:", error);
    }
};

export const setDisplayName = async (client: MatrixClient, newName: string): Promise<void> => {
    try {
        await client.setDisplayName(newName);
    } catch (error) {
        console.error("Failed to set display name:", error);
        throw error;
    }
};

export const setAvatar = async (client: MatrixClient, file: File): Promise<void> => {
    try {
        const { content_uri: mxcUrl } = await client.uploadContent(file, {
            name: file.name,
            type: file.type,
        });
        await client.setAvatarUrl(mxcUrl);
    } catch (error) {
        console.error("Failed to set avatar:", error);
        throw error;
    }
};

const SLOW_MODE_EVENT_TYPE = 'org.matrix.msc3946.room.slow_mode';

export const createRoom = async (client: MatrixClient, options: RoomCreationOptions): Promise<string> => {
    try {
        const slowModeSeconds = typeof options.slowModeSeconds === 'number'
            ? Math.max(0, Math.floor(options.slowModeSeconds))
            : undefined;

        const createOptions: ICreateRoomOpts = {
            name: options.name,
            topic: options.topic,
            visibility: options.isPublic ? Visibility.Public : Visibility.Private,
            preset: options.isPublic
                ? Preset.PublicChat
                : options.isEncrypted
                    ? Preset.TrustedPrivateChat
                    : Preset.PrivateChat,
        };

        if (options.roomAliasName) {
            createOptions.room_alias_name = options.roomAliasName;
        }

        const creationContent: Record<string, unknown> = {};
        if (options.disableFederation) {
            creationContent['m.federate'] = false;
        }
        if (Object.keys(creationContent).length > 0) {
            createOptions.creation_content = creationContent;
        }

        if (options.mode === 'channel') {
            createOptions.power_level_content_override = {
                users_default: 0,
                events_default: 0,
                state_default: 50,
                notifications: { room: 50 },
                events: {
                    [EventType.RoomMessage]: 50,
                    'm.room.encrypted': 50,
                    [EventType.Reaction]: 50,
                    [EventType.RoomRedaction]: 50,
                    'm.sticker': 50,
                },
            } as any;
        }

        const initialState: NonNullable<ICreateRoomOpts['initial_state']> = [];

        if (options.isEncrypted) {
            initialState.push({
                // @ts-ignore - matrix-js-sdk typings do not expose m.room.encryption as a valid state key
                type: EventType.RoomEncryption,
                state_key: '',
                content: {
                    algorithm: 'm.megolm.v1.aes-sha2',
                },
            });
        }

        const joinRule = options.requireInvite || !options.isPublic ? 'invite' : 'public';
        initialState.push({
            type: EventType.RoomJoinRules,
            state_key: '',
            content: { join_rule: joinRule },
        } as any);

        if (options.historyVisibility) {
            initialState.push({
                type: EventType.RoomHistoryVisibility,
                state_key: '',
                content: { history_visibility: options.historyVisibility },
            } as any);
        }

        if (slowModeSeconds && slowModeSeconds > 0) {
            initialState.push({
                type: SLOW_MODE_EVENT_TYPE as unknown as EventType,
                state_key: '',
                content: {
                    enabled: true,
                    seconds: slowModeSeconds,
                },
            } as any);
        }

        if (initialState.length > 0) {
            createOptions.initial_state = initialState;
        }

        const { room_id } = await client.createRoom(createOptions);

        if (options.initialPost) {
            try {
                await client.sendTextMessage(room_id, options.initialPost);
            } catch (error) {
                console.error('Failed to send initial announcement:', error);
            }
        }

        return room_id;
    } catch(error) {
        console.error("Failed to create room:", error);
        throw error;
    }
};

export const inviteUser = async (client: MatrixClient, roomId: string, userId: string): Promise<void> => {
    try {
        await client.invite(roomId, userId);
    } catch (error) {
        console.error(`Failed to invite ${userId} to ${roomId}:`, error);
        throw error; // Re-throw to be handled by the UI
    }
};

export const setPinnedMessages = async (client: MatrixClient, roomId: string, eventIds: string[]): Promise<void> => {
    try {
        // FIX: The matrix-js-sdk has an incomplete typing for state events, not including m.room.pinned_events
        // in the expected enum. Using @ts-ignore to bypass this check.
        // @ts-ignore
        await client.sendStateEvent(roomId, EventType.RoomPinnedEvents, { pinned: eventIds }, "");
    } catch (error) {
        console.error("Failed to set pinned messages:", error);
        throw error;
    }
};

export const paginateRoomHistory = async (client: MatrixClient, room: MatrixRoom, limit = 30): Promise<boolean> => {
    if (!room) return false;
    try {
        const eventsPaginated = await client.paginateEventTimeline(room.getLiveTimeline(), { backwards: true, limit });
        return eventsPaginated;
    } catch (error) {
        console.error("Failed to paginate room history:", error);
        return false;
    }
};

export const sendPollStart = async (client: MatrixClient, roomId: string, question: string, options: string[]): Promise<{ event_id: string }> => {
    const answers = options.map((opt, i) => ({
        id: `option_${i}_${Date.now()}`,
        'org.matrix.msc1767.text': opt,
    }));
    
    const content = {
        'org.matrix.msc1767.text': `[POLL] ${question}`,
        'm.poll.start': { // Using stable prefix
            question: {
                'org.matrix.msc1767.text': question
            },
            answers: answers,
        },
        "msgtype": "m.text"
    };
    
    // FIX: Cast custom event type to `any` to bypass strict SDK type checks.
    // Using custom event type as it might not be in the SDK's EventType enum
    return client.sendEvent(roomId, 'm.poll.start' as any, content);
};

export const sendPollResponse = async (client: MatrixClient, roomId: string, pollStartEventId: string, answerId: string): Promise<{ event_id: string }> => {
    const content = {
        'm.relates_to': {
            'rel_type': 'm.reference',
            'event_id': pollStartEventId
        },
        'm.poll.response': { // Using stable prefix
            answers: [answerId]
        }
    };
    // FIX: Cast custom event type to `any` to bypass strict SDK type checks.
    // Using custom event type as it might not be in the SDK's EventType enum
    return client.sendEvent(roomId, 'm.poll.response' as any, content);
};

export const translateText = async (text: string): Promise<string> => {
    try {
        const settings = _translationSettingsCache || getTranslationSettings();
        const baseUrl = settings?.baseUrl?.trim();
        if (!baseUrl) {
            // No translation endpoint configured. Return original text.
            return text;
        }
        const targetLanguage = navigator.language;
        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
        };
        if (settings?.apiKey) {
            // Use standard Bearer scheme. Servers can ignore if not needed.
            headers['Authorization'] = `Bearer ${settings.apiKey}`;
        }
        if (settings?.headers) {
            for (const [k, v] of Object.entries(settings.headers)) {
                if (v != null) headers[k] = String(v);
            }
        }
        const response = await fetch(baseUrl, {
            method: 'POST',
            headers,
            body: JSON.stringify({
                text,
                target_lang: targetLanguage,
            }),
        });
        if (!response.ok) {
            const errorBody = await response.text().catch(() => '');
            const msg = `Translation error ${response.status}: ${errorBody || response.statusText}`;
            console.warn(msg);
            _translationErrorHandler?.(msg);
            return text; // fall back to original
        }
        let data: any = null;
        try {
            data = await response.json();
        } catch (e) {
            const msg = 'Invalid JSON from translation server';
            console.warn(msg, e);
            _translationErrorHandler?.(msg);
            return text;
        }
        const translated =
            (typeof data?.translated_text === 'string' && data.translated_text) ||
            (typeof data?.translation === 'string' && data.translation) ||
            null;
        if (!translated) {
            const msg = "Unexpected translation response. Missing 'translated_text'.";
            console.warn(msg, data);
            _translationErrorHandler?.(msg);
            return text;
        }
        return translated;
    } catch (error: any) {
        const msg = `Translate failed: ${error?.message || String(error)}`;
        console.error(msg, error);
        _translationErrorHandler?.(msg);
        return text;
    }
};

// ========= Group Calls & Screen Share helpers =========
// Simple bridge to external SFU (Jitsi/LiveKit) or cascaded peer-connections
export type SfuKind = 'jitsi' | 'livekit' | 'other' | 'cascade';

const groupCallCoordinators = new Map<string, GroupCallCoordinator>();
const makeGroupCallKey = (roomId: string, sessionId: string) => `${roomId}::${sessionId}`;

const randomGroupSessionId = () => `call_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;

const buildParticipantRecord = (
  userId: string,
  displayName: string,
  avatarUrl?: string | null,
  role: GroupCallRole = 'host',
): SerializedGroupCallParticipant => ({
  userId,
  displayName,
  avatarUrl,
  role,
  isMuted: false,
  isVideoMuted: false,
  isScreensharing: false,
  lastActive: Date.now(),
});

export type GroupCallParticipant = CoordinatorParticipant;

export interface StartGroupCallOptions {
  sfuBaseUrl?: string;        // e.g. https://call.example.com
  sfuKind?: SfuKind;          // 'jitsi' | 'livekit' | 'cascade'
  topic?: string;             // optional display topic
  openIn?: 'webview' | 'browser';
  sessionId?: string;
  role?: GroupCallRole;
}

export interface StartGroupCallResult {
  url: string;
  sessionId: string;
  state: GroupCallStateEventContent;
}

export async function createGroupCallCoordinator(
  client: MatrixClient,
  roomId: string,
  sessionId: string,
  localMember: { userId: string; displayName: string; avatarUrl?: string | null; role?: GroupCallRole },
  options?: { constraints?: MediaStreamConstraints; iceServers?: RTCIceServer[] },
): Promise<GroupCallCoordinator> {
  const key = makeGroupCallKey(roomId, sessionId);
  const existing = groupCallCoordinators.get(key);
  if (existing) return existing;
  const coordinator = await GroupCallCoordinator.create({
    client,
    roomId,
    sessionId,
    localMember: { ...localMember },
    constraints: options?.constraints,
    iceServers: options?.iceServers,
  });
  groupCallCoordinators.set(key, coordinator);
  coordinator.on('disposed', () => {
    groupCallCoordinators.delete(key);
  });
  return coordinator;
}

export function getGroupCallCoordinator(roomId: string, sessionId: string): GroupCallCoordinator | undefined {
  return groupCallCoordinators.get(makeGroupCallKey(roomId, sessionId));
}

export async function leaveGroupCallCoordinator(roomId: string, sessionId: string): Promise<void> {
  const key = makeGroupCallKey(roomId, sessionId);
  const coordinator = groupCallCoordinators.get(key);
  if (!coordinator) return;
  await coordinator.leave();
  groupCallCoordinators.delete(key);
}

export function getGroupCallParticipantsFromState(
  client: MatrixClient,
  roomId: string,
  sessionId: string,
): SerializedGroupCallParticipant[] {
  const room = client.getRoom(roomId);
  if (!room) return [];
  try {
    const event = room.currentState?.getStateEvents(
      GROUP_CALL_PARTICIPANTS_EVENT_TYPE as unknown as EventType,
      sessionId,
    ) as unknown as { getContent?: () => GroupCallParticipantsContent } | undefined;
    const content = event?.getContent?.();
    if (!content || !Array.isArray(content.participants)) {
      return [];
    }
    return content.participants;
  } catch (error) {
    console.warn('Failed to read group call participants', error);
    return [];
  }
}

/**
 * Create a group call URL and announce it into the room.
 * Also synchronises the initial state for Matrix based participant discovery.
 */
export async function startGroupCall(client: MatrixClient, roomId: string, opts: StartGroupCallOptions = {}): Promise<StartGroupCallResult> {
  const userId = client.getUserId() || 'unknown';
  const sessionId = opts.sessionId || randomGroupSessionId();
  const sfuBase = opts.sfuBaseUrl || (typeof import.meta !== 'undefined' ? (import.meta as any).env?.VITE_SFU_BASE_URL : undefined);
  const callKind: SfuKind = opts.sfuKind || (sfuBase ? 'other' : 'cascade');
  const url = sfuBase
    ? `${sfuBase.replace(/\/+$/, '')}/room/${encodeURIComponent(roomId)}?user=${encodeURIComponent(userId)}&session=${encodeURIComponent(sessionId)}`
    : `matrix:group-call/${encodeURIComponent(roomId)}/${sessionId}`;

  const userProfile = client.getUser(userId);
  const displayName = userProfile?.displayName || userId;
  const avatarUrl = userProfile?.avatarUrl ?? null;
  const participant = buildParticipantRecord(userId, displayName, avatarUrl, opts.role ?? 'host');

  const content: any = {
    msgtype: 'm.notice',
    body: opts.topic ? `Group call: ${opts.topic}` : 'Group call started',
    'org.matrix.call.group': { url, kind: callKind, session_id: sessionId },
  };
  try {
    await client.sendEvent(roomId, EventType.RoomMessage, content);
  } catch (error) {
    console.warn('Failed to send group call announcement', error);
  }

  const state: GroupCallStateEventContent = {
    sessionId,
    startedBy: userId,
    startedAt: Date.now(),
    kind: callKind,
    url,
    topic: opts.topic ?? null,
    participants: [participant],
    coWatch: { active: false },
  };

  try {
    await client.sendStateEvent(roomId, GROUP_CALL_STATE_EVENT_TYPE as unknown as EventType, state, sessionId);
    await client.sendStateEvent(roomId, GROUP_CALL_PARTICIPANTS_EVENT_TYPE as unknown as EventType, {
      sessionId,
      participants: state.participants,
      updatedAt: Date.now(),
    }, sessionId);
  } catch (error) {
    console.error('Failed to publish group call state', error);
  }

  return { url, sessionId, state };
}

/**
 * Join a group call by opening an internal Tauri WebView window if available, otherwise a browser tab.
 */
export async function joinGroupCall(roomId: string, url: string, title = 'Group Call'): Promise<void> {
  try {
    // Tauri 2.x global marker
    if (typeof (window as any).__TAURI__ !== 'undefined') {
      const windowApi = await import('@tauri-apps/api/window');
      const WebviewWindow = (windowApi as any).WebviewWindow;
      if (WebviewWindow) {
        const win = new WebviewWindow(`call-${Date.now()}`, { title, url });
        await win.setFocus();
        return;
      }
      console.warn('Tauri WebviewWindow API не найдена, fallback на браузер.');
    }
  } catch (_) {
    // ignore and fallback
  }
  window.open(url, '_blank', 'noopener,noreferrer');
}

/**
 * Wrapper for screen capture.
 */
export async function getDisplayMedia(constraints: DisplayMediaStreamOptions = { video: { frameRate: 15 } }): Promise<MediaStream> {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
    throw new Error('Screen share is not supported in this environment');
  }
  return await navigator.mediaDevices.getDisplayMedia(constraints);
}

/**
 * Enumerate media devices.
 */
export async function enumerateDevices(): Promise<MediaDeviceInfo[]> {
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  return await navigator.mediaDevices.enumerateDevices();
}

/**
 * Swap video track on a given MediaStream in-place.
 */
export function swapVideoTrack(stream: MediaStream, newTrack: MediaStreamTrack): MediaStream {
  const old = stream.getVideoTracks()[0];
  if (old) {
    stream.removeTrack(old);
    old.stop();
  }
  stream.addTrack(newTrack);
  return stream;
}

// ========= TTL (Time To Live) Message Management =========
// In-memory storage for per-room TTL settings and next message TTL
const roomTTLCache = new Map<string, number | null>();
const nextMessageTTLCache = new Map<string, number | null>();
const SELF_DESTRUCT_CONTENT_KEY = 'com.matrix_messenger.self_destruct';
const HIDDEN_ROOM_TAG = 'com.matrix_messenger.hidden';

const selfDestructTimers = new Map<string, ReturnType<typeof setTimeout>>();
const selfDestructBindings = new WeakMap<MatrixClient, () => void>();

/**
 * Get the default TTL for a room (in milliseconds).
 * Returns null if no TTL is set.
 */
export async function getRoomTTL(client: MatrixClient, roomId: string): Promise<number | null> {
  try {
    // Check cache first
    if (roomTTLCache.has(roomId)) {
      return roomTTLCache.get(roomId) || null;
    }

    // Try to get from room account data or state event
    const room = client.getRoom(roomId);
    if (!room) return null;

    // FIX: Room account data access may not be fully typed. Cast to any if needed.
    const accountData = room.getAccountData('m.room.ttl' as any);
    if (accountData) {
      const ttl = accountData.getContent()?.ttl;
      roomTTLCache.set(roomId, ttl || null);
      return ttl || null;
    }

    return null;
  } catch (error) {
    console.error('Failed to get room TTL:', error);
    return null;
  }
}

/**
 * Set the default TTL for a room (in milliseconds).
 * Pass null to disable TTL.
 */
export async function setRoomTTL(client: MatrixClient, roomId: string, ttlMs: number | null): Promise<void> {
  try {
    const room = client.getRoom(roomId);
    if (!room) throw new Error('Room not found');

    // Store in room account data
    // FIX: Room account data types may be incomplete. Cast to any.
    await client.setRoomAccountData(roomId, 'm.room.ttl' as any, {
      ttl: ttlMs,
    });

    // Update cache
    roomTTLCache.set(roomId, ttlMs);
  } catch (error) {
    console.error('Failed to set room TTL:', error);
    throw error;
  }
}

/**
 * Set TTL for the next message only (in milliseconds).
 * This is stored in memory and applied to the next sent message.
 */
export function setNextMessageTTL(roomId: string, ttlMs: number | null): void {
  nextMessageTTLCache.set(roomId, ttlMs);
}

/**
 * Get the TTL set for the next message (in milliseconds).
 * Returns null if no TTL is set.
 */
export function getNextMessageTTL(roomId: string): number | null {
  return nextMessageTTLCache.get(roomId) || null;
}

/**
 * Clear the next message TTL after sending.
 */
export function clearNextMessageTTL(roomId: string): void {
  nextMessageTTLCache.delete(roomId);
}

const makeSelfDestructKey = (roomId: string, eventId: string) => `${roomId}/${eventId}`;

const cancelSelfDestructTimer = (roomId: string, eventId: string) => {
  const key = makeSelfDestructKey(roomId, eventId);
  const timer = selfDestructTimers.get(key);
  if (timer) {
    clearTimeout(timer);
    selfDestructTimers.delete(key);
  }
};

const scheduleSelfDestruct = (client: MatrixClient, roomId: string, eventId: string, expiresAt: number) => {
  if (!eventId || !roomId || Number.isNaN(expiresAt)) return;
  const key = makeSelfDestructKey(roomId, eventId);
  const delay = Math.max(expiresAt - Date.now(), 0);
  cancelSelfDestructTimer(roomId, eventId);
  if (delay <= 0) {
    void client.redactEvent(roomId, eventId, undefined, { reason: 'Self-destruct timer elapsed' }).catch(error => {
      console.warn('Failed to redact expired event', error);
    });
    return;
  }
  const timeout = setTimeout(() => {
    selfDestructTimers.delete(key);
    void client.redactEvent(roomId, eventId, undefined, { reason: 'Self-destruct timer elapsed' }).catch(error => {
      console.warn('Failed to redact event after TTL', error);
    });
  }, delay);
  selfDestructTimers.set(key, timeout);
};

const extractSelfDestruct = (event: MatrixEvent): { expiresAt: number } | null => {
  const content = event.getContent();
  const payload = content?.[SELF_DESTRUCT_CONTENT_KEY];
  if (!payload || typeof payload !== 'object') return null;
  const expiresAt = typeof payload.expiresAt === 'number' ? payload.expiresAt : undefined;
  const ttlMs = typeof payload.ttlMs === 'number' ? payload.ttlMs : undefined;
  if (typeof expiresAt === 'number' && Number.isFinite(expiresAt)) {
    return { expiresAt };
  }
  if (typeof ttlMs === 'number' && Number.isFinite(ttlMs)) {
    return { expiresAt: event.getTs() + ttlMs };
  }
  return null;
};

export const bindSelfDestructWatcher = (client: MatrixClient): void => {
  if (selfDestructBindings.has(client)) {
    return;
  }

  const onTimeline = (event: MatrixEvent, room?: MatrixRoom) => {
    if (!room) return;
    const eventId = event.getId();
    if (!eventId) return;
    const info = extractSelfDestruct(event);
    if (!info) return;
    scheduleSelfDestruct(client, room.roomId, eventId, info.expiresAt);
  };

  const onRedaction = (event: MatrixEvent, room?: MatrixRoom) => {
    if (!room) return;
    const targetId = event.getRedacts?.();
    if (typeof targetId === 'string') {
      cancelSelfDestructTimer(room.roomId, targetId);
    }
  };

  client.on(RoomEvent.Timeline, onTimeline);
  client.on(RoomEvent.Redaction, onRedaction as any);

  client.getRooms().forEach(room => {
    const events = room.getLiveTimeline().getEvents();
    events.forEach(ev => {
      const info = extractSelfDestruct(ev);
      if (info && ev.getId()) {
        scheduleSelfDestruct(client, room.roomId, ev.getId()!, info.expiresAt);
      }
    });
  });

  selfDestructBindings.set(client, () => {
    client.removeListener(RoomEvent.Timeline, onTimeline);
    client.removeListener(RoomEvent.Redaction, onRedaction as any);
  });
};

const readRoomTags = (room: MatrixRoom): Record<string, any> => {
  const tags: Record<string, any> = {};
  try {
    const accountData = room.getAccountData('m.tag' as any);
    const accountTags = accountData?.getContent()?.tags;
    if (accountTags && typeof accountTags === 'object') {
      Object.assign(tags, accountTags);
    }
  } catch (error) {
    // ignore
  }
  const runtimeTags = (room as any).tags;
  if (runtimeTags && typeof runtimeTags === 'object') {
    Object.assign(tags, runtimeTags);
  }
  return tags;
};

export const isRoomHidden = (client: MatrixClient, roomId: string): boolean => {
  const room = client.getRoom(roomId);
  if (!room) return false;
  return Boolean(readRoomTags(room)[HIDDEN_ROOM_TAG]);
};

export const setRoomHidden = async (client: MatrixClient, roomId: string, hidden: boolean): Promise<void> => {
  const room = client.getRoom(roomId);
  try {
    if (hidden) {
      if (typeof client.setRoomTag === 'function') {
        await client.setRoomTag(roomId, HIDDEN_ROOM_TAG, { hidden: true });
      } else {
        await client.setRoomAccountData(roomId, 'm.tag' as any, { tags: { [HIDDEN_ROOM_TAG]: { hidden: true } } });
      }
    } else if (typeof client.deleteRoomTag === 'function') {
      await client.deleteRoomTag(roomId, HIDDEN_ROOM_TAG);
    } else {
      const tags = room ? readRoomTags(room) : {};
      delete tags[HIDDEN_ROOM_TAG];
      await client.setRoomAccountData(roomId, 'm.tag' as any, { tags });
    }
  } catch (error) {
    console.warn('Failed to update hidden tag', error);
  }

  if (room) {
    (room as any).tags = readRoomTags(room);
    if (hidden) {
      (room as any).tags[HIDDEN_ROOM_TAG] = { hidden: true };
    } else {
      delete (room as any).tags[HIDDEN_ROOM_TAG];
    }
  }
};

export const getHiddenRoomIds = (client: MatrixClient): string[] =>
  client
    .getRooms()
    .filter(room => Boolean(readRoomTags(room)[HIDDEN_ROOM_TAG]))
    .map(room => room.roomId);
