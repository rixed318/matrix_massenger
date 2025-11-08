/* eslint-disable @typescript-eslint/no-explicit-any */
import { MatrixEvent, Room, RoomEvent } from "matrix-js-sdk/src/models/room";
import { IContent } from "matrix-js-sdk/src/models/event";
import type { EventTimeline } from "matrix-js-sdk/src/models/event-timeline";
import type { MatrixClient } from "matrix-js-sdk/src/client";
import * as matrixService from "./matrixService";

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

export interface MediaQuery {
  type?: MediaType;
  text?: string;
  fromTs?: number;
  toTs?: number;
}

type RoomIndex = {
  items: MediaItem[];
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
      inMemory.set(roomId, parsed);
      return parsed;
    }
  } catch {}
  const empty: RoomIndex = { items: [], complete: false };
  inMemory.set(roomId, empty);
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

const URL_REGEX = /\bhttps?:\/\/[^\s<>"'`]+/gi;

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

  if (isImage(m)) {
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
  for (const ev of events) {
    if (ev.getType() !== "m.room.message") continue;
    const items = intoItems(roomId, ev);
    if (items.length) idx.items.push(...items);
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
      if (items.length) idx.items.push(...items);
    }
    scanned += step;
  }

  // normalize sort and unique by id
  idx.items = dedupeById(idx.items).sort((a, b) => a.timestamp - b.timestamp);
  idx.lastEventTs = Date.now();
  idx.complete = scanned >= backfillLimit ? false : !room.canPaginate("b", live);
  inMemory.set(roomId, idx);
  persist(roomId);
}

function dedupeById(items: MediaItem[]): MediaItem[] {
  const seen = new Set<string>();
  const out: MediaItem[] = [];
  for (const it of items) {
    if (!seen.has(it.id)) { seen.add(it.id); out.push(it); }
  }
  return out;
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
    if (!items.length) return;
    const idx = load(roomId);
    idx.items.push(...items);
    idx.items = dedupeById(idx.items).sort((a, b) => a.timestamp - b.timestamp);
    inMemory.set(roomId, idx);
    persist(roomId);
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
