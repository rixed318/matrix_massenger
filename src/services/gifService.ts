import {
    Gif,
    GifFavorite,
    GifSearchHistoryEntry,
    GifSearchOptions,
    GifSearchResult,
} from '../types';

const API_BASE = (import.meta.env.VITE_GIF_API_BASE as string | undefined) ?? 'https://tenor.googleapis.com/v2';
const API_KEY = import.meta.env.VITE_GIF_API_KEY as string | undefined;
const CLIENT_KEY = (import.meta.env.VITE_GIF_CLIENT_KEY as string | undefined) ?? 'matrix-messenger';
const DEFAULT_LIMIT = 24;
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 минут
const HISTORY_LIMIT = 15;
const STORE_FILE = 'gif-cache.store';
const FAVORITES_KEY = 'favorites';
const HISTORY_KEY = 'history';
const PAGE_PREFIX = 'page:';

type GifFavoritesUpdateSource = 'local' | 'remote';

type FavoriteListener = (favorites: GifFavorite[], source: GifFavoritesUpdateSource) => void;

type CachedPage = {
    key: string;
    items: Gif[];
    nextCursor?: string;
    query?: string;
    timestamp: number;
};

type TenorMedia = {
    url: string;
    dims?: [number, number];
};

type TenorResult = {
    id: string;
    title?: string;
    content_description?: string;
    media_formats: {
        gif?: TenorMedia;
        mediumgif?: TenorMedia;
        tinygif?: TenorMedia;
        nanogif?: TenorMedia;
    };
};

type TenorResponse = {
    results: TenorResult[];
    next?: string;
};

type PageKind = 'search' | 'trending';

type MetaRecord = { key: string; value: unknown };

const isBrowser = typeof window !== 'undefined';
const isTauriRuntime = isBrowser && Boolean((window as any).__TAURI__);

const memoryPages = new Map<string, CachedPage>();
const memoryMeta = new Map<string, unknown>();

let favoritesCache: GifFavorite[] = [];
let favoritesLoaded = false;
let historyCache: GifSearchHistoryEntry[] = [];
let historyLoaded = false;

const favoriteListeners = new Set<FavoriteListener>();

let dbPromise: Promise<IDBDatabase | null> | null = null;

function createCacheKey(kind: PageKind, query: string | undefined, cursor?: string, limit?: number): string {
    const normalizedQuery = (query ?? '').trim().toLowerCase();
    const cursorKey = cursor ?? 'start';
    return `${kind}:${normalizedQuery}:${cursorKey}:${limit ?? DEFAULT_LIMIT}`;
}

function ensureApiKey(): void {
    if (!API_KEY) {
        throw new Error('GIF API key is not configured. Set VITE_GIF_API_KEY in your environment.');
    }
}

async function openDb(): Promise<IDBDatabase | null> {
    if (!isBrowser || typeof indexedDB === 'undefined') {
        return null;
    }
    if (!dbPromise) {
        dbPromise = new Promise((resolve, reject) => {
            const request = indexedDB.open('matrix-messenger-gifs', 1);
            request.onupgradeneeded = () => {
                const db = request.result;
                if (!db.objectStoreNames.contains('pages')) {
                    db.createObjectStore('pages', { keyPath: 'key' });
                }
                if (!db.objectStoreNames.contains('meta')) {
                    db.createObjectStore('meta', { keyPath: 'key' });
                }
            };
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        }).catch(() => null);
    }
    return dbPromise;
}

async function idbGetPage(key: string): Promise<CachedPage | null> {
    const db = await openDb();
    if (!db) {
        return (memoryPages.get(key) as CachedPage | undefined) ?? null;
    }
    return new Promise<CachedPage | null>(resolve => {
        const tx = db.transaction('pages', 'readonly');
        const store = tx.objectStore('pages');
        const request = store.get(key);
        request.onsuccess = () => {
            resolve((request.result as CachedPage | undefined) ?? null);
        };
        request.onerror = () => {
            resolve((memoryPages.get(key) as CachedPage | undefined) ?? null);
        };
    });
}

async function idbPutPage(record: CachedPage): Promise<void> {
    const db = await openDb();
    memoryPages.set(record.key, record);
    if (!db) return;
    await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('pages', 'readwrite');
        const store = tx.objectStore('pages');
        store.put(record);
        tx.oncomplete = () => resolve();
        tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
        tx.onerror = () => reject(tx.error ?? new Error('IndexedDB error'));
    }).catch(() => undefined);
}

async function idbGetMeta<T>(key: string): Promise<T | null> {
    const db = await openDb();
    if (!db) {
        return (memoryMeta.get(key) as T | undefined) ?? null;
    }
    return new Promise<T | null>(resolve => {
        const tx = db.transaction('meta', 'readonly');
        const store = tx.objectStore('meta');
        const request = store.get(key);
        request.onsuccess = () => {
            const result = request.result as MetaRecord | undefined;
            resolve(result ? (result.value as T) : null);
        };
        request.onerror = () => {
            resolve((memoryMeta.get(key) as T | undefined) ?? null);
        };
    });
}

async function idbPutMeta(key: string, value: unknown): Promise<void> {
    const db = await openDb();
    memoryMeta.set(key, value);
    if (!db) return;
    await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('meta', 'readwrite');
        const store = tx.objectStore('meta');
        store.put({ key, value });
        tx.oncomplete = () => resolve();
        tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
        tx.onerror = () => reject(tx.error ?? new Error('IndexedDB error'));
    }).catch(() => undefined);
}

async function tauriInvoke<T>(command: string, payload: Record<string, unknown>): Promise<T> {
    try {
        const { invoke } = await import('@tauri-apps/api/core');
        return await invoke<T>(command, payload);
    } catch (error) {
        throw error;
    }
}

async function tauriGet<T>(key: string): Promise<T | null> {
    if (!isTauriRuntime) {
        return (memoryMeta.get(key) as T | undefined) ?? null;
    }
    try {
        const value = await tauriInvoke<any>('plugin:store|get', { store: STORE_FILE, key });
        if (value === null || typeof value === 'undefined') {
            return null;
        }
        return value as T;
    } catch (error) {
        console.warn('Failed to read from Tauri store', error);
        return (memoryMeta.get(key) as T | undefined) ?? null;
    }
}

async function tauriSet(key: string, value: unknown): Promise<void> {
    if (!isTauriRuntime) {
        memoryMeta.set(key, value);
        return;
    }
    try {
        await tauriInvoke('plugin:store|set', { store: STORE_FILE, key, value });
        await tauriInvoke('plugin:store|save', { store: STORE_FILE });
    } catch (error) {
        console.warn('Failed to write to Tauri store', error);
        memoryMeta.set(key, value);
    }
}

async function tauriGetPage(key: string): Promise<CachedPage | null> {
    if (!isTauriRuntime) {
        return (memoryPages.get(key) as CachedPage | undefined) ?? null;
    }
    try {
        const value = await tauriInvoke<any>('plugin:store|get', { store: STORE_FILE, key: `${PAGE_PREFIX}${key}` });
        if (value === null || typeof value === 'undefined') {
            return null;
        }
        return value as CachedPage;
    } catch (error) {
        console.warn('Failed to read cached GIF page from Tauri store', error);
        return (memoryPages.get(key) as CachedPage | undefined) ?? null;
    }
}

async function tauriSetPage(record: CachedPage): Promise<void> {
    memoryPages.set(record.key, record);
    if (!isTauriRuntime) return;
    try {
        await tauriInvoke('plugin:store|set', { store: STORE_FILE, key: `${PAGE_PREFIX}${record.key}`, value: record });
        await tauriInvoke('plugin:store|save', { store: STORE_FILE });
    } catch (error) {
        console.warn('Failed to persist GIF page to Tauri store', error);
    }
}

async function loadCachedPage(key: string): Promise<CachedPage | null> {
    const [tauriCache, idbCache] = await Promise.all([tauriGetPage(key), idbGetPage(key)]);
    return tauriCache ?? idbCache;
}

async function persistCachedPage(record: CachedPage): Promise<void> {
    await Promise.all([tauriSetPage(record), idbPutPage(record)]);
}

async function readMeta<T>(key: string): Promise<T | null> {
    const [tauriValue, idbValue] = await Promise.all([tauriGet<T>(key), idbGetMeta<T>(key)]);
    return tauriValue ?? idbValue;
}

async function writeMeta(key: string, value: unknown): Promise<void> {
    await Promise.all([tauriSet(key, value), idbPutMeta(key, value)]);
}

function mapTenorGif(result: TenorResult): Gif | null {
    const gifMedia = result.media_formats.gif ?? result.media_formats.mediumgif ?? null;
    const previewMedia =
        result.media_formats.tinygif ??
        result.media_formats.nanogif ??
        gifMedia ??
        null;
    if (!gifMedia || !gifMedia.url) {
        return null;
    }
    const dims = Array.isArray(gifMedia.dims) && gifMedia.dims.length === 2
        ? (gifMedia.dims as [number, number])
        : ([0, 0] as [number, number]);
    const title = (result.title ?? result.content_description ?? '').trim() || 'GIF';
    return {
        id: result.id,
        url: gifMedia.url,
        previewUrl: previewMedia?.url ?? gifMedia.url,
        title,
        dims,
    };
}

async function fetchFromApi(kind: PageKind, params: { query?: string; cursor?: string; limit?: number }): Promise<TenorResponse> {
    ensureApiKey();
    const url = new URL(`${API_BASE}/${kind === 'trending' ? 'trending' : 'search'}`);
    url.searchParams.set('key', API_KEY!);
    url.searchParams.set('client_key', CLIENT_KEY);
    url.searchParams.set('media_filter', 'gif,tinygif,nanogif,mediumgif');
    url.searchParams.set('limit', String(params.limit ?? DEFAULT_LIMIT));
    url.searchParams.set('q', params.query ?? '');
    if (params.cursor) {
        url.searchParams.set('pos', params.cursor);
    }
    const navigatorLocale = typeof navigator !== 'undefined'
        ? (navigator.languages?.[0] ?? navigator.language ?? 'en')
        : 'en';
    const locale = navigatorLocale.split('-')[0];
    url.searchParams.set('locale', locale);
    const response = await fetch(url.toString());
    if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(`GIF API responded with ${response.status}: ${text || response.statusText}`);
    }
    return (await response.json()) as TenorResponse;
}

async function ensureFavoritesLoaded(): Promise<void> {
    if (favoritesLoaded) return;
    const stored = await readMeta<GifFavorite[]>(FAVORITES_KEY);
    favoritesCache = Array.isArray(stored)
        ? stored
              .map(item => sanitizeFavorite(item))
              .filter((item): item is GifFavorite => Boolean(item))
        : [];
    favoritesLoaded = true;
}

async function ensureHistoryLoaded(): Promise<void> {
    if (historyLoaded) return;
    const stored = await readMeta<GifSearchHistoryEntry[]>(HISTORY_KEY);
    historyCache = Array.isArray(stored)
        ? stored
              .map(item => ({
                  query: typeof item.query === 'string' ? item.query : '',
                  timestamp: typeof item.timestamp === 'number' ? item.timestamp : Date.now(),
              }))
              .filter(item => Boolean(item.query))
        : [];
    historyLoaded = true;
}

function sanitizeFavorite(value: unknown): GifFavorite | null {
    if (!value || typeof value !== 'object') {
        return null;
    }
    const candidate = value as Partial<GifFavorite> & { dims?: [number, number] };
    if (!candidate.id || !candidate.url || !candidate.previewUrl) {
        return null;
    }
    const dims = Array.isArray(candidate.dims) && candidate.dims.length === 2
        ? ([Number(candidate.dims[0]) || 0, Number(candidate.dims[1]) || 0] as [number, number])
        : ([0, 0] as [number, number]);
    return {
        id: String(candidate.id),
        url: String(candidate.url),
        previewUrl: String(candidate.previewUrl),
        title: typeof candidate.title === 'string' ? candidate.title : 'GIF',
        dims,
        addedAt: typeof candidate.addedAt === 'number' ? candidate.addedAt : Date.now(),
    };
}

async function recordSearchHistory(query: string): Promise<void> {
    if (!query.trim()) return;
    await ensureHistoryLoaded();
    const normalized = query.trim();
    historyCache = [{ query: normalized, timestamp: Date.now() }, ...historyCache.filter(item => item.query !== normalized)].slice(
        0,
        HISTORY_LIMIT,
    );
    await writeMeta(HISTORY_KEY, historyCache);
}

async function updateFavorites(next: GifFavorite[], source: GifFavoritesUpdateSource): Promise<GifFavorite[]> {
    favoritesCache = next;
    favoritesLoaded = true;
    await writeMeta(FAVORITES_KEY, favoritesCache);
    favoriteListeners.forEach(listener => {
        try {
            listener([...favoritesCache], source);
        } catch (error) {
            console.warn('GIF favorite listener failed', error);
        }
    });
    return favoritesCache;
}

export async function getTrendingGifs(options: GifSearchOptions = {}): Promise<GifSearchResult> {
    const cacheKey = createCacheKey('trending', undefined, options.cursor, options.limit);
    const cached = !options.forceRefresh && !options.cursor ? await loadCachedPage(cacheKey) : null;
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
        return {
            items: cached.items,
            nextCursor: cached.nextCursor,
            fromCache: true,
        };
    }
    try {
        const response = await fetchFromApi('trending', options);
        const items = response.results.map(mapTenorGif).filter((gif): gif is Gif => Boolean(gif));
        const record: CachedPage = {
            key: cacheKey,
            items,
            nextCursor: response.next,
            timestamp: Date.now(),
        };
        await persistCachedPage(record);
        return {
            items,
            nextCursor: response.next,
            fromCache: false,
        };
    } catch (error) {
        console.error('Failed to fetch trending GIFs', error);
        if (cached) {
            return {
                items: cached.items,
                nextCursor: cached.nextCursor,
                fromCache: true,
                error: (error as Error).message,
            };
        }
        return {
            items: [],
            fromCache: false,
            error: (error as Error).message,
        };
    }
}

export async function searchGifs(query: string, options: GifSearchOptions = {}): Promise<GifSearchResult> {
    const normalized = query.trim();
    if (!normalized) {
        return getTrendingGifs(options);
    }
    const cacheKey = createCacheKey('search', normalized, options.cursor, options.limit);
    const cached = !options.forceRefresh && !options.cursor ? await loadCachedPage(cacheKey) : null;
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
        return {
            items: cached.items,
            nextCursor: cached.nextCursor,
            query: normalized,
            fromCache: true,
        };
    }
    try {
        const response = await fetchFromApi('search', { ...options, query: normalized });
        const items = response.results.map(mapTenorGif).filter((gif): gif is Gif => Boolean(gif));
        const record: CachedPage = {
            key: cacheKey,
            items,
            nextCursor: response.next,
            query: normalized,
            timestamp: Date.now(),
        };
        await persistCachedPage(record);
        await recordSearchHistory(normalized);
        return {
            items,
            nextCursor: response.next,
            query: normalized,
            fromCache: false,
        };
    } catch (error) {
        console.error('Failed to search GIFs', error);
        if (cached) {
            return {
                items: cached.items,
                nextCursor: cached.nextCursor,
                query: normalized,
                fromCache: true,
                error: (error as Error).message,
            };
        }
        return {
            items: [],
            query: normalized,
            fromCache: false,
            error: (error as Error).message,
        };
    }
}

export async function getGifFavorites(): Promise<GifFavorite[]> {
    await ensureFavoritesLoaded();
    return [...favoritesCache].sort((a, b) => b.addedAt - a.addedAt);
}

export async function isGifFavorite(id: string): Promise<boolean> {
    await ensureFavoritesLoaded();
    return favoritesCache.some(item => item.id === id);
}

export async function addGifToFavorites(gif: Gif): Promise<GifFavorite[]> {
    await ensureFavoritesLoaded();
    if (favoritesCache.some(item => item.id === gif.id)) {
        return favoritesCache;
    }
    const entry: GifFavorite = {
        ...gif,
        addedAt: Date.now(),
    };
    const updated = [entry, ...favoritesCache];
    return updateFavorites(updated, 'local');
}

export async function removeGifFromFavorites(gifId: string): Promise<GifFavorite[]> {
    await ensureFavoritesLoaded();
    const updated = favoritesCache.filter(item => item.id !== gifId);
    return updateFavorites(updated, 'local');
}

export async function toggleGifFavorite(gif: Gif): Promise<GifFavorite[]> {
    await ensureFavoritesLoaded();
    if (favoritesCache.some(item => item.id === gif.id)) {
        return removeGifFromFavorites(gif.id);
    }
    return addGifToFavorites(gif);
}

export async function replaceGifFavoritesFromRemote(favorites: GifFavorite[]): Promise<GifFavorite[]> {
    const sanitized = favorites
        .map(item => sanitizeFavorite(item))
        .filter((item): item is GifFavorite => Boolean(item));
    return updateFavorites(sanitized, 'remote');
}

export function subscribeToGifFavorites(listener: FavoriteListener): () => void {
    favoriteListeners.add(listener);
    if (favoritesLoaded) {
        try {
            listener([...favoritesCache], 'local');
        } catch (error) {
            console.warn('GIF favorite listener failed', error);
        }
    }
    return () => {
        favoriteListeners.delete(listener);
    };
}

export async function getGifSearchHistory(): Promise<GifSearchHistoryEntry[]> {
    await ensureHistoryLoaded();
    return [...historyCache].sort((a, b) => b.timestamp - a.timestamp);
}

export async function clearGifSearchHistory(): Promise<void> {
    historyCache = [];
    historyLoaded = true;
    await writeMeta(HISTORY_KEY, historyCache);
}

export async function removeGifSearchHistoryEntry(query: string): Promise<void> {
    await ensureHistoryLoaded();
    historyCache = historyCache.filter(item => item.query !== query);
    await writeMeta(HISTORY_KEY, historyCache);
}

export function hasGifApiKey(): boolean {
    return Boolean(API_KEY);
}

export type { GifFavoritesUpdateSource };
