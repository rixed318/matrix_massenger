/* eslint-disable @typescript-eslint/no-explicit-any */
import { MatrixEvent, Room, RoomEvent } from "matrix-js-sdk/src/models/room";
import { IContent } from "matrix-js-sdk/src/models/event";
import type { EventTimeline } from "matrix-js-sdk/src/models/event-timeline";
import type { MatrixClient } from "matrix-js-sdk/src/client";
import { RelationType, EventType } from "matrix-js-sdk";
import * as matrixService from "./matrixService";
import type { MessageTranscript } from "./transcriptionService";
import {
  getSmartCollections as loadSmartCollections,
  loadRoomIndex as loadRoomFromStore,
  queryLocalMessages,
  upsertIndexEntries,
  type IndexedMessageRecord,
  type LocalSearchQuery,
  type SmartCollectionSummary,
} from "./localIndexStore";
export type { LocalSearchQuery } from "./localIndexStore";

export type MediaType = "image" | "video" | "file" | "link";

export interface MediaItem {
  id: string;               // stable local id `${eventId}:${idx}` for multi-link messages
  eventId: string;
  roomId: string;
  type: MediaType;
  mxcUrl?: string;
  thumbnailMxc?: string;
  fileName?: string;
  size?: number;
  mimetype?: string;
  sender: string;           // MXID
  timestamp: number;
  body?: string;
  url?: string;             // http(s) for links, or resolved mxc http for attachments (for downloads)
}

export interface IndexedMessageMetadata extends IndexedMessageRecord {}

export interface SmartCollection extends SmartCollectionSummary {
  roomIds?: string[];
}

export interface MediaQuery {
  type?: MediaType;
  text?: string;
  fromTs?: number;
  toTs?: number;
}

type RoomIndex = {
  items: MediaItem[];
  messages: IndexedMessageMetadata[];
  lastEventTs?: number;
  complete?: boolean; // true when fully backfilled to room start for current session
};

const inMemory: Map<string, RoomIndex> = new Map();

const key = (roomId: string) => `mediaIndex:${roomId}`;

function load(roomId: string): RoomIndex {
  if (inMemory.has(roomId)) return inMemory.get(roomId)!;
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(key(roomId)) : null;
    if (raw) {
      const parsed: RoomIndex = JSON.parse(raw);
      parsed.messages = parsed.messages ?? [];
      inMemory.set(roomId, parsed);
      void hydrateFromPersistent(roomId);
      return parsed;
    }
  } catch {}
  const empty: RoomIndex = { items: [], messages: [], complete: false };
  inMemory.set(roomId, empty);
  void hydrateFromPersistent(roomId);
  return empty;
}

function persist(roomId: string) {
  try {
    const data = inMemory.get(roomId);
    if (!data) return;
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(key(roomId), JSON.stringify(data));
    }
  } catch {}
}

async function hydrateFromPersistent(roomId: string) {
  try {
    const persisted = await loadRoomFromStore(roomId);
    if (!persisted) return;
    const existing = inMemory.get(roomId) ?? { items: [], messages: [], complete: false };
    existing.items = dedupeById([...existing.items, ...persisted.media]).sort((a, b) => a.timestamp - b.timestamp);
    existing.messages = dedupeMessages([...existing.messages, ...persisted.messages]).sort((a, b) => a.timestamp - b.timestamp);
    inMemory.set(roomId, existing);
  } catch (error) {
    console.warn("Failed to hydrate index", error);
  }
}

function mxcToHttp(mxc?: string, width?: number, height?: number, method: "scale" | "crop" = "scale") {
  if (!mxc) return undefined;
  const client = matrixService.getClient?.() as MatrixClient | undefined;
  if (client?.mxcUrlToHttp) return client.mxcUrlToHttp(mxc, width, height, method);
  // Fallback: raw mxc
  return mxc.replace(/^mxc:\/\//, "mxc://");
}

function isImage(m: IContent) {
  return m?.msgtype === "m.image" || (m?.info && typeof m.info.mimetype === "string" && m.info.mimetype.startsWith("image/"));
}
function isVideo(m: IContent) {
  return m?.msgtype === "m.video" || (m?.info && typeof m.info.mimetype === "string" && m.info.mimetype.startsWith("video/"));
}
function isFile(m: IContent) {
  return m?.msgtype === "m.file" || m?.file != null || (!!m?.url && !isImage(m) && !isVideo(m));
}

function isLocation(m: IContent) {
  return m?.msgtype === "m.location";
}

const URL_REGEX = /\bhttps?:\/\/[^\s<>"'`]+/gi;

type TranscriptStatus = "pending" | "completed" | "error";

const TRANSCRIPT_RELATION_KEY = "econix.transcript";
const TRANSCRIPT_EVENT_FIELD = "econix.transcript";

function extractLinks(body?: string): string[] {
  if (!body) return [];
  const matches = body.match(URL_REGEX);
  if (!matches) return [];
  // De-duplicate while preserving order
  const seen = new Set<string>();
  const out: string[] = [];
  for (const u of matches) {
    const clean = u.replace(/[),.;:]+$/, "");
    if (!seen.has(clean)) { seen.add(clean); out.push(clean); }
  }
  return out;
}

function intoItems(roomId: string, ev: MatrixEvent): MediaItem[] {
  const m = ev.getContent() as IContent;
  const relationKey = ev.getRelation?.()?.key;
  if (relationKey === TRANSCRIPT_RELATION_KEY) return [];
  const items: MediaItem[] = [];
  const ts = ev.getTs();
  const sender = ev.getSender() || "";
  const base = {
    eventId: ev.getId() || `${ev.getTxnId() || "pending"}`,
    roomId,
    sender,
    timestamp: ts,
    body: typeof m?.body === "string" ? m.body : undefined,
  };

  if (isLocation(m)) {
    const geoUri = typeof (m as any)?.geo_uri === "string"
      ? (m as any).geo_uri as string
      : typeof (m as any)?.["m.location"]?.uri === "string"
        ? (m as any)["m.location"].uri as string
        : undefined;
    const externalUrl = typeof (m as any)?.external_url === "string" ? (m as any).external_url as string : undefined;
    items.push({
      ...base,
      id: `${base.eventId}:0`,
      type: "link",
      url: externalUrl || geoUri,
    });
  } else if (isImage(m)) {
    items.push({
      ...base,
      id: `${base.eventId}:0`,
      type: "image",
      mxcUrl: (m.file?.url || m.url) as string | undefined,
      thumbnailMxc: (m.info?.thumbnail_file?.url || m.info?.thumbnail_url) as string | undefined,
      fileName: m.body,
      size: m.info?.size,
      mimetype: (m.info?.mimetype as string) || "image/*",
      url: mxcToHttp(m.file?.url || m.url),
    });
  } else if (isVideo(m)) {
    items.push({
      ...base,
      id: `${base.eventId}:0`,
      type: "video",
      mxcUrl: (m.file?.url || m.url) as string | undefined,
      thumbnailMxc: (m.info?.thumbnail_file?.url || m.info?.thumbnail_url) as string | undefined,
      fileName: m.body,
      size: m.info?.size,
      mimetype: (m.info?.mimetype as string) || "video/*",
      url: mxcToHttp(m.file?.url || m.url),
    });
  } else if (isFile(m)) {
    items.push({
      ...base,
      id: `${base.eventId}:0`,
      type: "file",
      mxcUrl: (m.file?.url || m.url) as string | undefined,
      fileName: m.body,
      size: m.info?.size,
      mimetype: (m.info?.mimetype as string) || "application/octet-stream",
      url: mxcToHttp(m.file?.url || m.url),
    });
  }

  const links = extractLinks(base.body);
  links.forEach((url, i) => {
    items.push({
      ...base,
      id: `${base.eventId}:${i + 1}`,
      type: "link",
      url,
    });
  });

  return items;
}

function tokenize(body?: string): string[] {
  if (!body) return [];
  return body
    .toLowerCase()
    .split(/[^\p{L}\p{N}@#:+]+/u)
    .map(part => part.trim())
    .filter(Boolean);
}

function extractTags(content: IContent): string[] {
  const tags: string[] = [];
  const possible = [
    (content as any)?.tags,
    (content as any)?.["m.tags"],
    (content as any)?.["matrix_messenger.tags"],
  ];
  for (const entry of possible) {
    if (!entry) continue;
    if (Array.isArray(entry)) {
      entry.forEach(v => {
        if (typeof v === "string") tags.push(v);
      });
    } else if (typeof entry === "object") {
      Object.values(entry).forEach(v => {
        if (typeof v === "string") tags.push(v);
      });
    }
  }
  return Array.from(new Set(tags.map(tag => tag.trim()).filter(Boolean)));
}

function collectReactions(room: Room | null | undefined, ev: MatrixEvent): string[] {
  if (!room) return [];
  const id = ev.getId();
  if (!id) return [];
  const related = (room as any).getRelatedEventsForEvent?.(id, RelationType.Annotation, EventType.Reaction) as MatrixEvent[] | undefined;
  if (!related) return [];
  const keys = new Set<string>();
  for (const reaction of related) {
    if (reaction.isRedacted()) continue;
    const key = reaction.getRelation()?.key;
    if (typeof key === "string") keys.add(key);
  }
  return Array.from(keys);
}

function collectTranscript(room: Room | null | undefined, ev: MatrixEvent): MessageTranscript | null {
  if (!room) return null;
  const id = ev.getId();
  if (!id) return null;
  const related = (room as any).getRelatedEventsForEvent?.(id, RelationType.Annotation, EventType.RoomMessage) as MatrixEvent[] | undefined;
  if (!related || !related.length) return null;
  let latest: MatrixEvent | null = null;
  for (const candidate of related) {
    const relation = candidate.getRelation?.();
    if (relation?.key !== TRANSCRIPT_RELATION_KEY) continue;
    if (candidate.isRedacted?.()) continue;
    if (!latest) {
      latest = candidate;
      continue;
    }
    const tsA = candidate.getTs?.() ?? 0;
    const tsB = latest.getTs?.() ?? 0;
    if (tsA >= tsB) {
      latest = candidate;
    }
  }
  if (!latest) return null;
  const content: any = latest.getContent?.() ?? {};
  const meta: any = content?.[TRANSCRIPT_EVENT_FIELD] ?? {};
  const statusRaw = typeof meta.status === "string" ? meta.status : undefined;
  const status: TranscriptStatus = statusRaw === "pending" || statusRaw === "error" || statusRaw === "completed" ? statusRaw : "completed";
  const text = typeof meta.text === "string" ? meta.text : (typeof content.body === "string" ? content.body : undefined);
  return {
    status,
    text: status === "completed" ? text : undefined,
    language: typeof meta.language === "string" ? meta.language : undefined,
    updatedAt: typeof meta.updatedAt === "number" ? meta.updatedAt : latest.getTs?.(),
    error: typeof meta.error === "string" ? meta.error : undefined,
    attempts: typeof meta.attempts === "number" ? meta.attempts : undefined,
    eventId: latest.getId?.() ?? undefined,
    durationMs: typeof meta.durationMs === "number" ? meta.durationMs : undefined,
  };
}

function intoMetadata(roomId: string, ev: MatrixEvent, mediaItems: MediaItem[], room: Room | null): IndexedMessageMetadata | null {
  const id = ev.getId();
  if (!id) return null;
  const sender = ev.getSender() || "";
  const timestamp = ev.getTs();
  const content = ev.getContent() as IContent;
  const relationKey = ev.getRelation?.()?.key;
  if (relationKey === TRANSCRIPT_RELATION_KEY) return null;
  const body = typeof content?.body === "string" ? content.body : undefined;
  let tokens = Array.from(new Set([...tokenize(body), sender.toLowerCase()]));
  const tags = extractTags(content);
  const reactions = collectReactions(room, ev);
  const mediaTypes = mediaItems.map(item => item.type);
  const hasMedia = mediaTypes.length > 0;
  const transcript = collectTranscript(room, ev);
  let transcriptTokens: string[] = [];
  if (transcript?.status === "completed" && transcript.text) {
    transcriptTokens = tokenize(transcript.text);
    tokens = Array.from(new Set([...tokens.filter(token => !transcriptTokens.includes(token)), ...transcriptTokens, sender.toLowerCase()]));
  }
  if (!body && !tokens.length && !tags.length && !reactions.length && !transcriptTokens.length) return null;
  return {
    eventId: id,
    roomId,
    sender,
    timestamp,
    body,
    tokens,
    tags,
    reactions,
    hasMedia,
    mediaTypes,
    transcriptText: transcript?.text,
    transcriptStatus: transcript?.status,
    transcriptLanguage: transcript?.language,
    transcriptTokens,
    transcriptUpdatedAt: transcript?.updatedAt,
    transcriptError: transcript?.error,
    transcriptDurationMs: transcript?.durationMs,
  };
}

export async function indexRoom(roomId: string, opts: { backfillLimit?: number; step?: number } = {}): Promise<void> {
  const backfillLimit = opts.backfillLimit ?? 5000;
  const step = Math.max(10, Math.min(500, opts.step ?? 200));

  const client = matrixService.getClient?.() as MatrixClient | undefined;
  if (!client) throw new Error("matrixService.getClient() is required");

  const room = client.getRoom(roomId);
  if (!room) throw new Error("Room not found");

  const idx = load(roomId);

  // scan visible timeline first
  const live = room.getLiveTimeline();
  const events = live.getEvents();
  const messageBatch: IndexedMessageMetadata[] = [];
  const mediaBatch: MediaItem[] = [];
  for (const ev of events) {
    if (ev.getType() !== "m.room.message") continue;
    const items = intoItems(roomId, ev);
    if (items.length) {
      idx.items.push(...items);
      mediaBatch.push(...items);
    }
    const metadata = intoMetadata(roomId, ev, items, room);
    if (metadata) {
      idx.messages.push(metadata);
      messageBatch.push(metadata);
    }
  }

  // back paginate up to limit
  let scanned = 0;
  let tl: EventTimeline | null = live;
  while (scanned < backfillLimit && tl && room.getPendingEvents().length >= 0) {
    const can = room.canPaginate("b", tl);
    if (!can) break;
    const ok = await client.paginateEventTimeline(tl, { backwards: true, limit: step });
    if (!ok) break;
    const evs = tl.getEvents();
    for (const ev of evs) {
      if (ev.getType() !== "m.room.message") continue;
      const items = intoItems(roomId, ev);
      if (items.length) {
        idx.items.push(...items);
        mediaBatch.push(...items);
      }
      const metadata = intoMetadata(roomId, ev, items, room);
      if (metadata) {
        idx.messages.push(metadata);
        messageBatch.push(metadata);
      }
    }
    scanned += step;
  }

  // normalize sort and unique by id
  idx.items = dedupeById(idx.items).sort((a, b) => a.timestamp - b.timestamp);
  idx.messages = dedupeMessages(idx.messages).sort((a, b) => a.timestamp - b.timestamp);
  idx.lastEventTs = Date.now();
  idx.complete = scanned >= backfillLimit ? false : !room.canPaginate("b", live);
  inMemory.set(roomId, idx);
  persist(roomId);
  if (messageBatch.length || mediaBatch.length) {
    void upsertIndexEntries(roomId, messageBatch, mediaBatch);
  }
}

function dedupeById(items: MediaItem[]): MediaItem[] {
  const seen = new Set<string>();
  const out: MediaItem[] = [];
  for (const it of items) {
    if (!seen.has(it.id)) { seen.add(it.id); out.push(it); }
  }
  return out;
}

function dedupeMessages(items: IndexedMessageMetadata[]): IndexedMessageMetadata[] {
  const seen = new Set<string>();
  const out: IndexedMessageMetadata[] = [];
  for (const it of items) {
    const key = `${it.roomId}:${it.eventId}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push(it);
    }
  }
  return out;
}

export function applyTranscriptUpdate(roomId: string, eventId: string, transcript: MessageTranscript): void {
  const idx = load(roomId);
  const target = idx.messages.find(m => m.eventId === eventId);
  if (!target) return;
  const previousTranscriptTokens = target.transcriptTokens ?? [];
  const baseTokens = target.tokens.filter(token => !previousTranscriptTokens.includes(token));
  let newTokens: string[] = [];
  if (transcript.status === "completed" && transcript.text) {
    newTokens = tokenize(transcript.text);
  }
  target.tokens = Array.from(new Set([...baseTokens, ...newTokens]));
  target.transcriptTokens = newTokens;
  target.transcriptText = transcript.text;
  target.transcriptStatus = transcript.status;
  target.transcriptLanguage = transcript.language;
  target.transcriptUpdatedAt = transcript.updatedAt ?? Date.now();
  target.transcriptError = transcript.error;
  target.transcriptDurationMs = transcript.durationMs;
  idx.messages = dedupeMessages(idx.messages).sort((a, b) => a.timestamp - b.timestamp);
  inMemory.set(roomId, idx);
  persist(roomId);
  void upsertIndexEntries(roomId, [target], []);
}

interface CaptionRecord {
  id: string;
  callId: string;
  text: string;
  language?: string;
  translatedText?: string;
  targetLanguage?: string;
  timestamp: number;
  sender: string;
}

export function recordCallCaption(roomId: string, caption: CaptionRecord): void {
  if (!caption?.id || !caption.text) return;
  const idx = load(roomId);
  const tokens = tokenize(caption.text);
  const translated = caption.translatedText ?? caption.text;
  const transcriptTokens = tokenize(translated);
  const metadata: IndexedMessageMetadata = {
    eventId: caption.id,
    roomId,
    sender: caption.sender,
    timestamp: caption.timestamp,
    body: caption.text,
    tokens,
    tags: ['call.caption'],
    reactions: [],
    hasMedia: false,
    mediaTypes: [],
    transcriptText: translated,
    transcriptStatus: 'completed',
    transcriptLanguage: caption.translatedText ? (caption.targetLanguage ?? caption.language) : caption.language,
    transcriptTokens,
    transcriptUpdatedAt: Date.now(),
  };
  idx.messages = dedupeMessages([
    ...idx.messages.filter(m => m.eventId !== caption.id),
    metadata,
  ]).sort((a, b) => a.timestamp - b.timestamp);
  inMemory.set(roomId, idx);
  persist(roomId);
  void upsertIndexEntries(roomId, [metadata], []);
}

export function startLiveIndexing(roomId: string) {
  const client = matrixService.getClient?.() as MatrixClient | undefined;
  if (!client) return;
  const room = client.getRoom(roomId);
  if (!room) return;

  // ensure cache loaded
  load(roomId);

  const handler = (ev: MatrixEvent, rm: Room | undefined, toStartOfTimeline?: boolean) => {
    if (rm?.roomId !== roomId) return;
    if (toStartOfTimeline) return;
    if (ev.getType() !== "m.room.message") return;
    const items = intoItems(roomId, ev);
    const metadata = intoMetadata(roomId, ev, items, room);
    if (!items.length && !metadata) return;
    const idx = load(roomId);
    if (items.length) {
      idx.items.push(...items);
      idx.items = dedupeById(idx.items).sort((a, b) => a.timestamp - b.timestamp);
    }
    if (metadata) {
      idx.messages.push(metadata);
      idx.messages = dedupeMessages(idx.messages).sort((a, b) => a.timestamp - b.timestamp);
    }
    inMemory.set(roomId, idx);
    persist(roomId);
    if (items.length || metadata) {
      void upsertIndexEntries(roomId, metadata ? [metadata] : [], items);
    }
  };

  client.on(RoomEvent.Timeline, handler);
  return () => client.removeListener(RoomEvent.Timeline, handler);
}

export function query(roomId: string, q: MediaQuery = {}): MediaItem[] {
  const idx = load(roomId);
  let items = idx.items.slice();
  if (q.type) items = items.filter(i => i.type === q.type);
  if (typeof q.fromTs === "number") items = items.filter(i => i.timestamp >= q.fromTs!);
  if (typeof q.toTs === "number") items = items.filter(i => i.timestamp <= q.toTs!);
  if (q.text && q.text.trim().length) {
    const needle = q.text.trim().toLowerCase();
    items = items.filter(i =>
      (i.fileName?.toLowerCase().includes(needle)) ||
      (i.body?.toLowerCase().includes(needle)) ||
      (i.url?.toLowerCase().includes(needle)) ||
      (i.sender?.toLowerCase().includes(needle))
    );
  }
  return items;
}

export function clear(roomId: string) {
  inMemory.delete(roomId);
  try { localStorage.removeItem(key(roomId)); } catch {}
}

export function mxcPreview(item: MediaItem, size = 256) {
  if (item.thumbnailMxc) return mxcToHttp(item.thumbnailMxc, size, size, "crop");
  if (item.mxcUrl) return mxcToHttp(item.mxcUrl, size, size, "scale");
  return undefined;
}

export function mxcDownload(item: MediaItem) {
  if (item.mxcUrl) return mxcToHttp(item.mxcUrl);
  return item.url;
}

function buildMentionTarget(userId?: string | null) {
  if (!userId) return undefined;
  const normalized = userId.toLowerCase();
  const local = normalized.includes(":") ? normalized.split(":")[0].replace(/^@/, "") : normalized.replace(/^@/, "");
  return local;
}

function inMemorySearch(query: LocalSearchQuery, mentionTarget?: string): IndexedMessageMetadata[] {
  const all = Array.from(inMemory.values()).flatMap(idx => idx.messages);
  const filtered = all.filter(record => {
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
    if (query.term && query.term.trim().length) {
      const needle = query.term.trim().toLowerCase();
      const haystack = [record.body ?? "", record.sender, record.tags.join(" "), record.reactions.join(" ")]
        .join(" ")
        .toLowerCase();
      if (!haystack.includes(needle)) {
        const tokens = record.tokens.join(" ");
        if (!tokens.includes(needle)) return false;
      }
    }
    return true;
  });
  const sorted = filtered.sort((a, b) => b.timestamp - a.timestamp);
  if (typeof query.limit === "number") {
    return sorted.slice(0, query.limit);
  }
  return sorted;
}

function resolveSmartQuery(token: string, mentionTarget?: string): Partial<LocalSearchQuery> & { mentionTarget?: string } {
  if (token === "smart:important") {
    return { term: "important" };
  }
  if (token === "smart:mentions" && mentionTarget) {
    return { mentionTarget };
  }
  return {};
}

export async function searchLocalMessages(query: LocalSearchQuery, userId?: string | null): Promise<IndexedMessageMetadata[]> {
  const mentionTarget = buildMentionTarget(userId);
  let effectiveQuery: LocalSearchQuery = { ...query };
  if (effectiveQuery.term && effectiveQuery.term.startsWith("smart:")) {
    const resolved = resolveSmartQuery(effectiveQuery.term, mentionTarget);
    effectiveQuery = { ...effectiveQuery, ...resolved };
    delete (effectiveQuery as any).mentionTarget;
    if (!resolved.term) {
      effectiveQuery.term = "";
    }
  }
  const smartMentionTarget = (query.term && query.term.startsWith("smart:")) ? mentionTarget : undefined;
  try {
    const persistent = await queryLocalMessages(effectiveQuery, smartMentionTarget ?? mentionTarget);
    if (persistent.length) return persistent;
  } catch (error) {
    console.warn("Local persistent query failed", error);
  }
  return inMemorySearch(effectiveQuery, smartMentionTarget ?? mentionTarget);
}

export async function getSmartCollections(userId: string): Promise<SmartCollection[]> {
  try {
    const smart = await loadSmartCollections(userId);
    return smart.map(collection => ({
      ...collection,
      roomIds: Array.isArray((collection as SmartCollection).roomIds)
        ? (collection as SmartCollection).roomIds
        : [],
    }));
  } catch (error) {
    console.warn("Failed to load smart collections", error);
    return [];
  }
}
