// Local persistent storage for message search index.
// Provides IndexedDB implementation for web builds and
// delegates to Tauri (sqlite) when running in the desktop shell.

import { invoke } from "@tauri-apps/api/core";
import type { MediaItem } from "./mediaIndexService";

export interface IndexedMessageRecord {
  eventId: string;
  roomId: string;
  sender: string;
  timestamp: number;
  body?: string;
  tokens: string[];
  tags: string[];
  reactions: string[];
  hasMedia: boolean;
  mediaTypes: string[];
  transcriptText?: string;
  transcriptStatus?: string;
  transcriptLanguage?: string;
  transcriptTokens?: string[];
  transcriptUpdatedAt?: number;
  transcriptError?: string;
  transcriptDurationMs?: number;
}

export interface PersistedRoomIndex {
  media: MediaItem[];
  messages: IndexedMessageRecord[];
}

export interface SmartCollectionSummary {
  id: string;
  label: string;
  description: string;
  count: number;
  token: string;
}

export interface LocalSearchQuery {
  term?: string;
  roomId?: string;
  senders?: string[];
  fromTs?: number;
  toTs?: number;
  hasMedia?: boolean;
  limit?: number;
  mediaTypes?: string[];
}

const isTauri = typeof window !== "undefined" && (window as any).__TAURI_IPC__;

// -----------------------------
// IndexedDB implementation
// -----------------------------

const DB_NAME = "matrix-messenger-index";
const DB_VERSION = 1;
const STORE_MESSAGES = "messages";
const STORE_MEDIA = "media";

type IDBDatabasePromise = Promise<IDBDatabase | null>;
let idbPromise: IDBDatabasePromise | null = null;

function openIndexedDb(): IDBDatabasePromise {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  if (!idbPromise) {
    idbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_MESSAGES)) {
          const messageStore = db.createObjectStore(STORE_MESSAGES, { keyPath: "key" });
          messageStore.createIndex("byRoom", "roomId", { unique: false });
          messageStore.createIndex("bySender", "sender", { unique: false });
          messageStore.createIndex("byTimestamp", "timestamp", { unique: false });
        }
        if (!db.objectStoreNames.contains(STORE_MEDIA)) {
          db.createObjectStore(STORE_MEDIA, { keyPath: "id" });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    }).catch(() => null);
  }
  return idbPromise;
}

async function idbTransaction(mode: IDBTransactionMode): Promise<IDBTransaction | null> {
  const db = await openIndexedDb();
  if (!db) return null;
  return db.transaction([STORE_MESSAGES, STORE_MEDIA], mode);
}

async function idbUpsert(messages: IndexedMessageRecord[], mediaItems: MediaItem[]): Promise<void> {
  const tx = await idbTransaction("readwrite");
  if (!tx) return;
  const messageStore = tx.objectStore(STORE_MESSAGES);
  const mediaStore = tx.objectStore(STORE_MEDIA);
  for (const message of messages) {
    const payload = {
      ...message,
      key: `${message.roomId}:${message.eventId}`,
      tokenString: ` ${message.tokens.join(" ")} `,
    };
    messageStore.put(payload);
  }
  for (const item of mediaItems) {
    mediaStore.put(item);
  }
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  }).catch(() => undefined);
}

async function idbLoadRoom(roomId: string): Promise<PersistedRoomIndex | null> {
  const tx = await idbTransaction("readonly");
  if (!tx) return null;
  const messageStore = tx.objectStore(STORE_MESSAGES);
  const mediaStore = tx.objectStore(STORE_MEDIA);
  const messages: IndexedMessageRecord[] = [];
  const request = messageStore.index("byRoom").openCursor(IDBKeyRange.only(roomId));
  await new Promise<void>((resolve, reject) => {
    request.onsuccess = () => {
      const cursor = request.result;
      if (cursor) {
        const value = cursor.value;
        const { key: _key, tokenString: _tokenString, ...rest } = value;
        messages.push(rest as IndexedMessageRecord);
        cursor.continue();
      } else {
        resolve();
      }
    };
    request.onerror = () => reject(request.error);
  }).catch(() => undefined);

  const media: MediaItem[] = [];
  const mediaRequest = mediaStore.openCursor();
  await new Promise<void>((resolve, reject) => {
    mediaRequest.onsuccess = () => {
      const cursor = mediaRequest.result;
      if (cursor) {
        const value = cursor.value as MediaItem;
        if (value.roomId === roomId) {
          media.push(value);
        }
        cursor.continue();
      } else {
        resolve();
      }
    };
    mediaRequest.onerror = () => reject(mediaRequest.error);
  }).catch(() => undefined);

  return { messages, media };
}

async function idbGetAllMessages(): Promise<IndexedMessageRecord[]> {
  const tx = await idbTransaction("readonly");
  if (!tx) return [];
  const store = tx.objectStore(STORE_MESSAGES);
  const request = store.getAll();
  const rows = await new Promise<any[]>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result ?? []);
    request.onerror = () => reject(request.error);
  }).catch(() => []);
  return rows.map(row => {
    const { key: _key, tokenString: _tokenString, ...rest } = row;
    return rest as IndexedMessageRecord;
  });
}

function matchesQuery(record: IndexedMessageRecord, query: LocalSearchQuery, mentionTarget?: string): boolean {
  if (query.roomId && record.roomId !== query.roomId) return false;
  if (query.senders && query.senders.length && !query.senders.includes(record.sender)) return false;
  if (typeof query.fromTs === "number" && record.timestamp < query.fromTs) return false;
  if (typeof query.toTs === "number" && record.timestamp > query.toTs) return false;
  if (query.hasMedia && !record.hasMedia) return false;
  if (query.mediaTypes && query.mediaTypes.length) {
    const hasAny = query.mediaTypes.some(type => record.mediaTypes.includes(type));
    if (!hasAny) return false;
  }
  if (mentionTarget && !record.tokens.some(token => token.includes(mentionTarget))) return false;
  if (query.term && query.term.trim()) {
    const needle = query.term.trim().toLowerCase();
  const haystack = [record.body ?? "", record.sender, record.tags.join(" "), record.reactions.join(" "), record.transcriptText ?? ""]
    .join(" ")
    .toLowerCase();
    if (!haystack.includes(needle)) {
      const tokens = record.tokens.join(" ");
      if (!tokens.includes(needle)) return false;
    }
  }
  return true;
}

async function idbQuery(query: LocalSearchQuery, mentionTarget?: string): Promise<IndexedMessageRecord[]> {
  const rows = await idbGetAllMessages();
  const filtered = rows.filter(row => matchesQuery(row, query, mentionTarget));
  if (typeof query.limit === "number" && filtered.length > query.limit) {
    return filtered.sort((a, b) => b.timestamp - a.timestamp).slice(0, query.limit);
  }
  return filtered.sort((a, b) => b.timestamp - a.timestamp);
}

async function idbSmartCollections(userId: string): Promise<SmartCollectionSummary[]> {
  const rows = await idbGetAllMessages();
  if (!rows.length) return [];
  const important = rows.filter(row =>
    row.tags.some(tag => tag.toLowerCase() === "important") ||
    row.reactions.some(r => r === "⭐" || r === "🔥" || r === "❗")
  );
  const normalizedUser = userId.toLowerCase();
  const mentions = rows.filter(row =>
    row.tokens.some(token => token.includes(normalizedUser)) ||
    (row.body ?? "").toLowerCase().includes(`@${normalizedUser}`)
  );
  const smart: SmartCollectionSummary[] = [];
  if (important.length) {
    smart.push({
      id: "important",
      label: "Важно",
      description: "Сообщения с тегом important или отмеченные реакциями",
      count: important.length,
      token: "smart:important",
    });
  }
  if (mentions.length) {
    smart.push({
      id: "mentions",
      label: "Пропущенные упоминания",
      description: "Сообщения, где вас упомянули",
      count: mentions.length,
      token: "smart:mentions",
    });
  }
  return smart;
}

async function idbDeleteRoom(roomId: string): Promise<void> {
  const tx = await idbTransaction("readwrite");
  if (!tx) return;
  const messageStore = tx.objectStore(STORE_MESSAGES);
  const mediaStore = tx.objectStore(STORE_MEDIA);
  const completion = new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
  const removeMessages = new Promise<void>((resolve, reject) => {
    const index = messageStore.index("byRoom");
    const request = index.openCursor(IDBKeyRange.only(roomId));
    request.onsuccess = () => {
      const cursor = request.result;
      if (cursor) {
        cursor.delete();
        cursor.continue();
      } else {
        resolve();
      }
    };
    request.onerror = () => reject(request.error);
  });
  const removeMedia = new Promise<void>((resolve, reject) => {
    const request = mediaStore.openCursor();
    request.onsuccess = () => {
      const cursor = request.result;
      if (cursor) {
        const value = cursor.value as MediaItem;
        if (value.roomId === roomId) {
          cursor.delete();
        }
        cursor.continue();
      } else {
        resolve();
      }
    };
    request.onerror = () => reject(request.error);
  });
  await Promise.all([removeMessages.catch(() => undefined), removeMedia.catch(() => undefined)]);
  await completion.catch(() => undefined);
}

async function idbClearAll(): Promise<void> {
  const tx = await idbTransaction("readwrite");
  if (!tx) return;
  const messageStore = tx.objectStore(STORE_MESSAGES);
  const mediaStore = tx.objectStore(STORE_MEDIA);
  await Promise.all([
    new Promise<void>((resolve, reject) => {
      const request = messageStore.clear();
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    }).catch(() => undefined),
    new Promise<void>((resolve, reject) => {
      const request = mediaStore.clear();
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    }).catch(() => undefined),
  ]);
}

// -----------------------------
// Public API
// -----------------------------

export async function upsertIndexEntries(roomId: string, messages: IndexedMessageRecord[], mediaItems: MediaItem[]): Promise<void> {
  if (!messages.length && !mediaItems.length) return;
  if (isTauri) {
    try {
      await invoke("upsert_index_records", { payload: { roomId, messages, mediaItems } });
      return;
    } catch (error) {
      console.warn("Failed to persist index via Tauri", error);
    }
  }
  await idbUpsert(messages, mediaItems);
}

export async function loadRoomIndex(roomId: string): Promise<PersistedRoomIndex | null> {
  if (isTauri) {
    try {
      const result = await invoke<PersistedRoomIndex | null>("load_room_index", { roomId });
      if (result) return result;
    } catch (error) {
      console.warn("Failed to load index via Tauri", error);
    }
  }
  return idbLoadRoom(roomId);
}

export async function queryLocalMessages(query: LocalSearchQuery, mentionTarget?: string): Promise<IndexedMessageRecord[]> {
  if (isTauri) {
    try {
      const result = await invoke<IndexedMessageRecord[]>("query_local_index", { query, mentionTarget });
      if (Array.isArray(result)) return result;
    } catch (error) {
      console.warn("Local sqlite query failed", error);
    }
  }
  return idbQuery(query, mentionTarget);
}

export async function getSmartCollections(userId: string): Promise<SmartCollectionSummary[]> {
  if (isTauri) {
    try {
      const result = await invoke<SmartCollectionSummary[]>("get_smart_collections", { userId });
      if (Array.isArray(result)) return result;
    } catch (error) {
      console.warn("Fetching smart collections via Tauri failed", error);
    }
  }
  return idbSmartCollections(userId);
}

export async function purgeRoomIndex(roomId: string): Promise<void> {
  if (!roomId) return;
  if (isTauri) {
    try {
      await invoke("purge_room_index", { roomId });
      return;
    } catch (error) {
      console.warn("Failed to purge room index via Tauri", error);
    }
  }
  await idbDeleteRoom(roomId);
}

export async function purgeRoomsFromIndex(roomIds: string[]): Promise<void> {
  if (!Array.isArray(roomIds) || !roomIds.length) return;
  await Promise.all(roomIds.map(roomId => purgeRoomIndex(roomId)));
}

export async function clearLocalIndex(): Promise<void> {
  if (isTauri) {
    try {
      await invoke("clear_index_store");
      return;
    } catch (error) {
      console.warn("Failed to clear index via Tauri", error);
    }
  }
  await idbClearAll();
}

