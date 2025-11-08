import { MatrixClient, MatrixEvent, MatrixRoom, MatrixUser, Sticker, Gif } from '../types';
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
    IndexedDBStore, IndexedDBCryptoStore, ClientEvent, MemoryStore, MatrixScheduler, Preset} from 'matrix-js-sdk';
import type { HierarchyRoom } from 'matrix-js-sdk';


// ===== Offline Outbox Queue (IndexedDB/SQLite) =====
type OutboxPayload = {
    id: string;                 // local id (txn-like)
    roomId: string;
    type: string;
    content: any;
    ts: number;
    attempts: number;
    threadRootId?: string;
    replyToEventId?: string;
};

export type OutboxEvent =
  | { kind: 'status'; online: boolean; syncing: boolean }
  | { kind: 'enqueued'; item: OutboxPayload }
  | { kind: 'progress'; id: string; attempts: number }
  | { kind: 'sent'; id: string; serverEventId: string }
  | { kind: 'error'; id: string; error: any };

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
            const sendRes = await _boundClient.sendEvent(item.roomId, item.type as any, item.content);
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

const enqueueOutbox = async (roomId: string, type: string, content: any, opts?: { threadRootId?: string; replyToEventId?: string }) => {
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
    };
    await idbPut(payload);
    _outboxEmitter.emit({ kind: 'enqueued', item: payload });
    return id;
};
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
    secureCloudProfiles.set(client, profile);
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
let _idbStore: IndexedDBStore | null = null;
let _cryptoStore: IndexedDBCryptoStore | null = null;
let _scheduler: MatrixScheduler | null = null;

/**
 * Dynamically load Olm if available. Works in browser and Tauri.
 * Safe to call many times.
 */
export const ensureOlm = async (): Promise<void> => {
    if ((globalThis as any).Olm && typeof (globalThis as any).Olm.init === 'function') {
        await (globalThis as any).Olm.init();
        return;
    }
    try {
        const mod: any = await import(/* webpackIgnore: true */ '@matrix-org/olm');
        if (mod?.init) {
            await mod.init();
            (globalThis as any).Olm = mod;
        }
    } catch (e) {
        console.warn('Olm not available. E2EE will be disabled.', e);
    }
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

export const login = async (

    homeserverUrl: string,
    username: string,
    password: string,
    secureProfile?: SecureCloudProfile,

): Promise<MatrixClient> => {
    const client = await initClient(homeserverUrl);
    await client.loginWithPassword(username, password);
    await ensureOlm();
    try {
        await (client as any).initCrypto();
        (client as any).setGlobalErrorOnUnknownDevices?.(false);
    } catch (e) {
        console.warn('initCrypto failed or not supported', e);
    }
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
        try { r.getLiveTimeline(); } catch (_) {}
    }
} catch (e) {
    console.warn('Preload local history failed', e);
}


    await firstSync;
    try { bindOutboxToClient(client); } catch (e) { console.warn('bindOutboxToClient failed', e); }
    if (secureProfile) {
        setSecureCloudProfileForClient(client, secureProfile);
    }
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


export const sendMessage = async (
    client: MatrixClient,
    roomId: string,
    body: string,
    replyToEvent?: MatrixEvent,
    threadRootId?: string,
    roomMembers: MatrixUser[] = []
): Promise<{ event_id: string }> => {
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

    if (mentionedUserIds.size > 0) {
        content.format = 'org.matrix.custom.html';
        content.formatted_body = formattedBodyParts.join('');
        content['m.mentions'] = {
            user_ids: Array.from(mentionedUserIds),
        };
    }

    const urlMatch = body.match(/(https?:\/\/[^\s]+)/);
    if (urlMatch) {
        try {
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
        } catch (e) { /* ignore preview errors */ }
    }

    if (threadRootId) {
        content['m.relates_to'] = {
            'rel_type': 'm.thread',
            'event_id': threadRootId,
            ...(replyToEvent && {
                "m.in_reply_to": { "event_id": replyToEvent.getId() }
            })
        };
    } else if (replyToEvent) {
        content['m.relates_to'] = { "m.in_reply_to": { "event_id": replyToEvent.getId() } };
    }

    // If offline or not yet syncing, enqueue to outbox and return local id.
    if (!navigator.onLine) {
        const localId = await enqueueOutbox(roomId, EventType.RoomMessage as any, content, { threadRootId, replyToEventId: replyToEvent?.getId?.() });
        return { event_id: localId };
    }

    try {
        const res = await client.sendEvent(roomId, EventType.RoomMessage, content as any);
        return res;
    } catch (err) {
        // Network/server issue: save to outbox for retry
        const localId = await enqueueOutbox(roomId, EventType.RoomMessage as any, content, { threadRootId, replyToEventId: replyToEvent?.getId?.() });
        return { event_id: localId };
    }
};


    if (mentionedUserIds.size > 0) {
        content.format = 'org.matrix.custom.html';
        content.formatted_body = formattedBodyParts.join('');
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
            console.warn("Failed to get URL preview:", e);
        }
    }
    
    if (threadRootId) {
        content['m.relates_to'] = {
            'rel_type': 'm.thread',
            'event_id': threadRootId,
            ...(replyToEvent && {
                "m.in_reply_to": {
                    "event_id": replyToEvent.getId(),
                }
            })
        };
    } else if (replyToEvent) {
        content['m.relates_to'] = {
            "m.in_reply_to": {
                "event_id": replyToEvent.getId(),
            },
        };
    }

    return client.sendEvent(roomId, EventType.RoomMessage, content);
};

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

    const { content_uri: mxcUrl } = await client.uploadContent(compressedFile, {
        name: compressedFile.name,
        type: compressedFile.type,
    });

    const content = {
        body: compressedFile.name,
        info: {
            mimetype: compressedFile.type,
            size: compressedFile.size,
        },
        msgtype: MsgType.Image,
        url: mxcUrl,
    };

    return client.sendEvent(roomId, EventType.RoomMessage, content as any);
};

export const sendAudioMessage = async (client: MatrixClient, roomId: string, file: Blob, duration: number): Promise<{ event_id: string }> => {
    const { content_uri: mxcUrl } = await client.uploadContent(file, {
        name: "voice-message.ogg",
        type: file.type,
    });

    const content = {
        body: "Voice Message",
        info: {
            mimetype: file.type,
            size: file.size,
            duration: Math.round(duration * 1000), // duration in milliseconds
        },
        msgtype: MsgType.Audio,
        url: mxcUrl,
    };

    return client.sendEvent(roomId, EventType.RoomMessage, content as any);
};


export const sendFileMessage = async (client: MatrixClient, roomId: string, file: File): Promise<{ event_id: string }> => {
    const { content_uri: mxcUrl } = await client.uploadContent(file, {
        name: file.name,
        type: file.type,
    });

    const content = {
        body: file.name,
        info: {
            mimetype: file.type,
            size: file.size,
        },
        msgtype: MsgType.File,
        url: mxcUrl,
    };

    return client.sendEvent(roomId, EventType.RoomMessage, content as any);
};

export const sendStickerMessage = async (client: MatrixClient, roomId: string, stickerUrl: string, body: string, info: Sticker['info']): Promise<{ event_id: string }> => {
    const content = {
        body,
        info,
        url: stickerUrl,
        msgtype: 'm.sticker',
    };
    // The matrix-js-sdk doesn't have m.sticker in its standard event types, so we cast to any.
    return client.sendEvent(roomId, 'm.sticker' as any, content);
};

export const sendGifMessage = async (client: MatrixClient, roomId: string, gif: Gif): Promise<{ event_id: string }> => {
    // We send GIFs as m.image events. We add a custom flag to help our UI distinguish it.
    const { url, title, dims } = gif;
    
    // FIX: The `uploadContentFromUrl` method does not exist on the MatrixClient type.
    // The correct procedure is to fetch the content from the URL, convert it to a Blob,
    // and then upload it using `uploadContent`.
    const response = await fetch(url);
    const blob = await response.blob();
    const { content_uri: mxcUrl } = await client.uploadContent(blob, {
        name: title,
        type: 'image/gif',
    });

    const content = {
        body: title,
        info: {
            mimetype: 'image/gif',
            w: dims[0],
            h: dims[1],
            'xyz.amorgan.is_gif': true,
        },
        msgtype: MsgType.Image,
        url: mxcUrl,
    };

    return client.sendEvent(roomId, EventType.RoomMessage, content as any);
};

export const sendReaction = async (client: MatrixClient, roomId: string, eventId: string, emoji: string): Promise<void> => {
    const content = {
        'm.relates_to': {
            'rel_type': RelationType.Annotation,
            'event_id': eventId,
            'key': emoji,
        },
    };
    await client.sendEvent(roomId, EventType.Reaction, content as any);
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

export const createRoom = async (client: MatrixClient, options: { name: string, topic?: string, isPublic: boolean, isEncrypted: boolean }): Promise<string> => {
    try {
        // FIX: Replaced `RoomCreateOptions` with the correct type `ICreateRoomOpts`.
        const createOptions: ICreateRoomOpts = {
            name: options.name,
            topic: options.topic,
            // FIX: Use Visibility enum instead of string literals for type safety.
            visibility: options.isPublic ? Visibility.Public : Visibility.Private,
        };
        if (options.isEncrypted) {
            createOptions.initial_state = [
                {
                    // FIX: This is a typing issue in the matrix-js-sdk where `m.room.encryption` is not
                    // considered a valid key of `TimelineEvents`. Using @ts-ignore is a safe workaround
                    // to bypass this strict compiler check for state events.
                    // @ts-ignore
                    type: EventType.RoomEncryption,
                    state_key: "",
                    content: {
                        algorithm: "m.megolm.v1.aes-sha2",
                    },
                },
            ];
        }
        const { room_id } = await client.createRoom(createOptions);
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
// Simple bridge to external SFU (Jitsi/LiveKit) and MSC3401-compatible notice
export type SfuKind = 'jitsi' | 'livekit' | 'other';

export interface StartGroupCallOptions {
  sfuBaseUrl?: string;        // e.g. https://call.example.com
  sfuKind?: SfuKind;          // 'jitsi' | 'livekit'
  topic?: string;             // optional display topic
  openIn?: 'webview' | 'browser';
}

/**
 * Create a group call URL and announce it into the room.
 * Sends m.notice with {"org.matrix.call.group": { url, kind }}.
 * Falls back to `${sfuBaseUrl}/room/<roomId>?user=<userId>`.
 */
export async function startGroupCall(client: MatrixClient, roomId: string, opts: StartGroupCallOptions = {}): Promise<{ url: string }> {
  const userId = client.getUserId() || 'unknown';
  const sfuBase = opts.sfuBaseUrl || (typeof import.meta !== 'undefined' ? (import.meta as any).env?.VITE_SFU_BASE_URL : undefined);
  if (!sfuBase) {
    throw new Error('SFU base URL is not configured. Set VITE_SFU_BASE_URL or pass opts.sfuBaseUrl');
  }
  const url = `${sfuBase.replace(/\/+$/, '')}/room/${encodeURIComponent(roomId)}?user=${encodeURIComponent(userId)}`;
  const content: any = {
    msgtype: 'm.notice',
    body: opts.topic ? `Group call: ${opts.topic}` : 'Group call started',
    'org.matrix.call.group': { url, kind: opts.sfuKind || 'other' },
  };
  await client.sendEvent(roomId, 'm.room.message', content);
  return { url };
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
