import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import type { Gif, GifFavorite, GifSearchHistoryEntry, GifSearchResult } from '@matrix-messenger/core';

const STORAGE_KEY = '@matrix-messenger/mobile-gif-store';
const API_BASE =
  (Constants.expoConfig?.extra as Record<string, any> | undefined)?.gifApiBase ??
  process.env.EXPO_PUBLIC_GIF_API_BASE ??
  'https://tenor.googleapis.com/v2';
const API_KEY =
  (Constants.expoConfig?.extra as Record<string, any> | undefined)?.gifApiKey ??
  process.env.EXPO_PUBLIC_GIF_API_KEY;
const CLIENT_KEY =
  (Constants.expoConfig?.extra as Record<string, any> | undefined)?.gifClientKey ??
  process.env.EXPO_PUBLIC_GIF_CLIENT_KEY ??
  'matrix-messenger-mobile';

if (!API_KEY) {
  console.warn('Tenor GIF API key is not configured. Set EXPO_PUBLIC_GIF_API_KEY or expo.extra.gifApiKey');
}

type StorePayload = {
  favorites?: GifFavorite[];
  history?: GifSearchHistoryEntry[];
};

const readStore = async (): Promise<StorePayload> => {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as StorePayload;
    return parsed ?? {};
  } catch (error) {
    console.warn('Failed to read GIF store', error);
    return {};
  }
};

const writeStore = async (payload: StorePayload) => {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch (error) {
    console.warn('Failed to persist GIF store', error);
  }
};

const mapTenorGif = (entry: any): Gif => {
  const formats = entry?.media_formats ?? {};
  const preferred = formats?.mediumgif ?? formats?.gif ?? formats?.tinygif ?? formats?.nanogif;
  const dims = preferred?.dims ?? [0, 0];
  return {
    id: entry?.id ?? String(Math.random()),
    title: entry?.title ?? entry?.content_description ?? 'GIF',
    url: preferred?.url ?? '',
    width: dims[0] ?? 0,
    height: dims[1] ?? 0,
  } as Gif;
};

const fetchTenor = async (path: string, params: Record<string, string>): Promise<GifSearchResult> => {
  if (!API_KEY) {
    return { items: [], nextCursor: undefined, error: 'GIF API key is not configured', fromCache: true };
  }
  const query = new URLSearchParams({ key: API_KEY, client_key: CLIENT_KEY, ...params }).toString();
  const response = await fetch(`${API_BASE}/${path}?${query}`);
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(errorText || 'Failed to fetch GIFs');
  }
  const payload = (await response.json()) as { results: any[]; next?: string };
  return {
    items: payload.results?.map(mapTenorGif) ?? [],
    nextCursor: payload.next,
    fromCache: false,
  };
};

export const getTrendingMobileGifs = (options?: { limit?: number; cursor?: string }): Promise<GifSearchResult> =>
  fetchTenor('trending', {
    limit: String(options?.limit ?? 24),
    pos: options?.cursor ?? '',
  });

export const searchMobileGifs = (
  query: string,
  options?: { limit?: number; cursor?: string },
): Promise<GifSearchResult> =>
  fetchTenor('search', {
    q: query,
    limit: String(options?.limit ?? 24),
    pos: options?.cursor ?? '',
  });

export const loadGifFavorites = async (): Promise<GifFavorite[]> => {
  const store = await readStore();
  return store.favorites ?? [];
};

export const toggleGifFavoriteMobile = async (gif: Gif): Promise<GifFavorite[]> => {
  const store = await readStore();
  const existing = store.favorites ?? [];
  const has = existing.some(item => item.id === gif.id);
  const nextFavorites = has
    ? existing.filter(item => item.id !== gif.id)
    : [{ id: gif.id, url: gif.url, previewUrl: gif.url, addedAt: Date.now() }, ...existing];
  await writeStore({ ...store, favorites: nextFavorites });
  return nextFavorites;
};

export const loadGifHistory = async (): Promise<GifSearchHistoryEntry[]> => {
  const store = await readStore();
  return store.history ?? [];
};

export const appendGifHistory = async (query: string): Promise<GifSearchHistoryEntry[]> => {
  const store = await readStore();
  const existing = store.history ?? [];
  const filtered = existing.filter(entry => entry.query.toLowerCase() !== query.toLowerCase());
  const nextHistory: GifSearchHistoryEntry[] = [{ query, lastUsedAt: Date.now() }, ...filtered].slice(0, 15);
  await writeStore({ ...store, history: nextHistory });
  return nextHistory;
};
