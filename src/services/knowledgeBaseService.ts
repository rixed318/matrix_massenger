import { Room, RoomEvent } from "matrix-js-sdk/src/models/room";
import type { MatrixClient, MatrixEvent } from "matrix-js-sdk/src/client";
import { upsertIndexEntries, queryLocalMessages, type IndexedMessageRecord, type LocalSearchQuery } from "./localIndexStore";

export const KNOWLEDGE_EVENT_TYPE = "com.matrix_messenger.doc";

export interface KnowledgeDocSourceReference {
  roomId: string;
  eventId: string;
  senderId?: string;
}

export interface KnowledgeDocDraft {
  title: string;
  body: string;
  tags?: string[];
  summary?: string;
  spaceId?: string | null;
  channelId?: string | null;
  sources: KnowledgeDocSourceReference[];
}

export interface KnowledgeDocument extends KnowledgeDocDraft {
  id: string;
  roomId: string;
  createdAt: number;
  updatedAt: number;
  authorId: string;
}

export interface KnowledgeDocSearchOptions {
  term?: string;
  spaceId?: string | null;
  channelId?: string | null;
  tags?: string[];
  limit?: number;
}

type KnowledgeDocListener = (docs: KnowledgeDocument[]) => void;

const documents = new Map<string, KnowledgeDocument>();
const listeners = new Set<KnowledgeDocListener>();
const clientBindings = new WeakMap<MatrixClient, () => void>();

const normaliseTags = (tags?: string[]): string[] => {
  if (!Array.isArray(tags)) return [];
  return tags
    .map(tag => tag?.trim())
    .filter((tag): tag is string => Boolean(tag))
    .map(tag => tag.toLowerCase());
};

const emit = () => {
  const payload = getKnowledgeDocuments();
  listeners.forEach(listener => {
    try {
      listener(payload);
    } catch (error) {
      console.warn("knowledgeBaseService listener error", error);
    }
  });
};

const tokenize = (input: string): string[] => {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9а-яё\s]+/gi, " ")
    .split(/\s+/)
    .filter(Boolean);
};

const buildIndexPayload = (doc: KnowledgeDocument): IndexedMessageRecord => {
  const sourceText = [doc.title, doc.summary, doc.body, normaliseTags(doc.tags).join(" ")]
    .filter(Boolean)
    .join("\n");
  return {
    eventId: doc.id,
    roomId: doc.roomId,
    sender: doc.authorId,
    timestamp: doc.updatedAt,
    body: sourceText,
    tokens: tokenize(sourceText),
    tags: ["knowledge-base", ...normaliseTags(doc.tags)],
    reactions: [],
    hasMedia: false,
    mediaTypes: [],
  };
};

const trackDocument = (doc: KnowledgeDocument) => {
  const existing = documents.get(doc.id);
  if (existing && existing.updatedAt >= doc.updatedAt) {
    return;
  }
  documents.set(doc.id, doc);
  void upsertIndexEntries(doc.roomId, [buildIndexPayload(doc)], []);
  emit();
};

const parseKnowledgeEvent = (event: MatrixEvent): KnowledgeDocument | null => {
  if (event.getType() !== KNOWLEDGE_EVENT_TYPE) return null;
  const content = event.getContent<Record<string, unknown>>();
  if (!content) return null;

  const title = typeof content.title === "string" && content.title.trim().length ? content.title.trim() : "";
  const body = typeof content.body === "string" ? content.body : "";
  if (!title && !body) return null;

  const summary = typeof content.summary === "string" ? content.summary : undefined;
  const createdAt = typeof content.created_at === "number" ? content.created_at : event.getTs();
  const updatedAt = typeof content.updated_at === "number" ? content.updated_at : createdAt;
  const authorId = typeof content.author === "string" ? content.author : event.getSender() || "";
  const tags = Array.isArray(content.tags)
    ? content.tags.filter((tag): tag is string => typeof tag === "string")
    : [];
  const sources = Array.isArray(content.sources)
    ? content.sources
        .map(source => {
          if (!source || typeof source !== "object") return null;
          const roomId = typeof (source as any).roomId === "string" ? (source as any).roomId : undefined;
          const eventId = typeof (source as any).eventId === "string" ? (source as any).eventId : undefined;
          const senderId = typeof (source as any).senderId === "string" ? (source as any).senderId : undefined;
          if (!roomId || !eventId) return null;
          return { roomId, eventId, senderId };
        })
        .filter((value): value is KnowledgeDocSourceReference => value !== null)
    : [];
  const spaceId = typeof content.space_id === "string" ? content.space_id : null;
  const channelId = typeof content.channel_id === "string" ? content.channel_id : null;
  const roomId = event.getRoomId();
  if (!roomId) return null;

  return {
    id: event.getId() ?? event.getTxnId() ?? `${roomId}:${event.getTs()}`,
    roomId,
    title,
    body,
    summary,
    tags,
    sources,
    spaceId,
    channelId,
    createdAt,
    updatedAt,
    authorId,
  };
};

const ingestRoomTimeline = (room: Room) => {
  const events = room.getLiveTimeline()?.getEvents?.();
  if (!events || !Array.isArray(events)) return;
  for (const event of events) {
    if (event.getType() !== KNOWLEDGE_EVENT_TYPE) continue;
    const doc = parseKnowledgeEvent(event);
    if (doc) {
      trackDocument(doc);
    }
  }
};

const attachToClient = (client: MatrixClient) => {
  if (clientBindings.has(client)) {
    return;
  }

  const handler = (event: MatrixEvent, room?: Room) => {
    if (!room || event.getType() !== KNOWLEDGE_EVENT_TYPE) {
      return;
    }
    const doc = parseKnowledgeEvent(event);
    if (doc) {
      trackDocument(doc);
    }
  };

  client.getRooms().forEach(room => ingestRoomTimeline(room));
  client.on(RoomEvent.Timeline, handler);
  clientBindings.set(client, () => {
    client.removeListener(RoomEvent.Timeline, handler);
  });
};

export const bindKnowledgeBaseToClient = (client: MatrixClient): (() => void) => {
  attachToClient(client);
  return () => {
    const dispose = clientBindings.get(client);
    dispose?.();
    clientBindings.delete(client);
  };
};

export const subscribeKnowledgeDocuments = (listener: KnowledgeDocListener): (() => void) => {
  listeners.add(listener);
  listener(getKnowledgeDocuments());
  return () => listeners.delete(listener);
};

export const getKnowledgeDocuments = (): KnowledgeDocument[] => {
  return Array.from(documents.values()).sort((a, b) => b.updatedAt - a.updatedAt);
};

export const getKnowledgeDocumentsBySource = (eventIds: string[]): KnowledgeDocument[] => {
  if (!eventIds.length) return [];
  const lookup = new Set(eventIds);
  return getKnowledgeDocuments().filter(doc => doc.sources.some(source => lookup.has(source.eventId)));
};

export const searchKnowledgeDocuments = async (
  options: KnowledgeDocSearchOptions = {},
): Promise<KnowledgeDocument[]> => {
  const { term, spaceId, channelId, tags, limit } = options;
  const desiredTags = normaliseTags(tags);
  const filteredBase = getKnowledgeDocuments().filter(doc => {
    if (spaceId && doc.spaceId !== spaceId) return false;
    if (channelId && doc.channelId !== channelId) return false;
    if (desiredTags.length > 0) {
      const docTags = normaliseTags(doc.tags);
      if (!desiredTags.every(tag => docTags.includes(tag))) {
        return false;
      }
    }
    return true;
  });

  if (!term) {
    return typeof limit === "number" ? filteredBase.slice(0, limit) : filteredBase;
  }

  const query: LocalSearchQuery = {
    term,
    limit: limit ?? 100,
  };
  const rows = await queryLocalMessages(query);
  const ids = new Set(rows.map(row => row.eventId));
  return filteredBase.filter(doc => ids.has(doc.id));
};

export const createKnowledgeDocument = async (
  client: MatrixClient,
  draft: KnowledgeDocDraft,
): Promise<KnowledgeDocument> => {
  attachToClient(client);
  const now = Date.now();
  const authorId = client.getUserId() ?? "";
  const tags = normaliseTags(draft.tags);
  const roomId = draft.channelId ?? draft.spaceId ?? draft.sources[0]?.roomId ?? client.getUserId() ?? "";
  const content = {
    title: draft.title,
    body: draft.body,
    summary: draft.summary ?? draft.body.slice(0, 280),
    tags,
    sources: draft.sources,
    space_id: draft.spaceId ?? null,
    channel_id: draft.channelId ?? null,
    created_at: now,
    updated_at: now,
    author: authorId,
    version: 1,
  };

  const response = await client.sendEvent(roomId, KNOWLEDGE_EVENT_TYPE as any, content);
  const eventId = typeof (response as any)?.event_id === "string" ? (response as any).event_id : response?.event_id;
  const doc: KnowledgeDocument = {
    id: eventId ?? `${roomId}:${now}`,
    roomId,
    title: draft.title,
    body: draft.body,
    summary: content.summary,
    tags,
    sources: draft.sources,
    spaceId: draft.spaceId ?? null,
    channelId: draft.channelId ?? null,
    createdAt: now,
    updatedAt: now,
    authorId,
  };
  trackDocument(doc);
  return doc;
};

