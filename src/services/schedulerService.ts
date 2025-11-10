import { ClientEvent, RoomEvent } from 'matrix-js-sdk';
import { MatrixClient, MatrixEvent, ScheduledMessage, ScheduledMessageRecurrence, DraftAttachment, DraftContent, DraftAttachmentKind, LocationContentPayload } from '../types';
import { computeLocalTimestamp } from '../utils/timezone';
import { onBotBridgeWebhook, BotBridgeWebhookPayload } from './botBridgeWebhook';
import { sendNotification } from './notificationService';

export const SCHEDULED_MESSAGES_EVENT_TYPE = 'com.matrix_messenger.scheduled';

const SCHEDULER_STATE_VERSION = 2;

type SchedulerCache = {
    byRoom: Map<string, ScheduledMessage[]>;
};

const schedulerCache = new WeakMap<MatrixClient, SchedulerCache>();

const getSchedulerCache = (client: MatrixClient): SchedulerCache => {
    let cache = schedulerCache.get(client);
    if (!cache) {
        cache = { byRoom: new Map() };
        schedulerCache.set(client, cache);
    }
    return cache;
};

const updateCacheForRoom = (client: MatrixClient, roomId: string, messages: ScheduledMessage[]): void => {
    if (!roomId) {
        return;
    }
    const cache = getSchedulerCache(client);
    cache.byRoom.set(roomId, sortScheduledMessages(messages));
};

const removeCacheForRoom = (client: MatrixClient, roomId: string): void => {
    if (!roomId) {
        return;
    }
    const cache = getSchedulerCache(client);
    cache.byRoom.set(roomId, []);
};

const flattenCache = (client: MatrixClient): ScheduledMessage[] => {
    const cache = schedulerCache.get(client);
    if (!cache) {
        return [];
    }
    return Array.from(cache.byRoom.values()).flat().sort((a, b) => {
        const nextA = a.nextOccurrenceAt ?? a.sendAtUtc ?? a.sendAt;
        const nextB = b.nextOccurrenceAt ?? b.sendAtUtc ?? b.sendAt;
        return nextA - nextB;
    });
};

const sortScheduledMessages = (messages: ScheduledMessage[]): ScheduledMessage[] =>
    [...messages].sort((a, b) => {
        const nextA = a.nextOccurrenceAt ?? a.sendAtUtc ?? a.sendAt;
        const nextB = b.nextOccurrenceAt ?? b.sendAtUtc ?? b.sendAt;
        return nextA - nextB;
    });

const ATTACHMENT_KINDS: DraftAttachmentKind[] = ['file', 'image', 'audio', 'voice', 'sticker', 'gif'];

const isAttachmentKind = (value: unknown): value is DraftAttachmentKind =>
    typeof value === 'string' && ATTACHMENT_KINDS.includes(value as DraftAttachmentKind);

const getSchedulerStateKey = (client: MatrixClient): string => {
    const userId = typeof client.getUserId === 'function' ? client.getUserId() : null;
    return userId ? `user:${userId}` : 'user:self';
};

const coerceNumber = (value: unknown): number | undefined => {
    if (typeof value === 'number' && !Number.isNaN(value)) {
        return value;
    }
    if (typeof value === 'string') {
        const parsed = Number(value);
        if (!Number.isNaN(parsed)) {
            return parsed;
        }
    }
    return undefined;
};

const coerceString = (value: unknown): string | undefined =>
    typeof value === 'string' && value.length > 0 ? value : undefined;

const coercePositiveInteger = (value: unknown): number | undefined => {
    const parsed = coerceNumber(value);
    if (typeof parsed !== 'number' || !Number.isFinite(parsed) || parsed <= 0) {
        return undefined;
    }
    return Math.floor(parsed);
};

const coerceNonNegativeInteger = (value: unknown): number | undefined => {
    const parsed = coerceNumber(value);
    if (typeof parsed !== 'number' || !Number.isFinite(parsed) || parsed < 0) {
        return undefined;
    }
    return Math.floor(parsed);
};

const coerceWaveform = (value: unknown): number[] | undefined => {
    if (!Array.isArray(value)) {
        return undefined;
    }
    const normalized = value
        .map(entry => (typeof entry === 'number' ? entry : Number(entry)))
        .filter(entry => typeof entry === 'number' && !Number.isNaN(entry));
    return normalized.length > 0 ? normalized : undefined;
};

const normalizeRecurrence = (raw: unknown): ScheduledMessageRecurrence | undefined => {
    if (!raw || typeof raw !== 'object') {
        return undefined;
    }
    const mode = (raw as any).mode === 'repeat' ? 'repeat' : 'once';
    if (mode !== 'repeat') {
        return undefined;
    }

    const intervalMs = coercePositiveInteger((raw as any).intervalMs);
    if (!intervalMs) {
        return undefined;
    }

    const recurrence: ScheduledMessageRecurrence = { mode: 'repeat', intervalMs };
    const maxOccurrences = coercePositiveInteger((raw as any).maxOccurrences);
    if (typeof maxOccurrences === 'number') {
        recurrence.maxOccurrences = maxOccurrences;
    }
    const untilUtc = coerceNumber((raw as any).untilUtc);
    if (typeof untilUtc === 'number' && Number.isFinite(untilUtc) && untilUtc > 0) {
        recurrence.untilUtc = untilUtc;
    }
    return recurrence;
};

const serializeRecurrence = (recurrence?: ScheduledMessageRecurrence): Record<string, unknown> | undefined => {
    if (!recurrence || recurrence.mode !== 'repeat') {
        return undefined;
    }
    const payload: Record<string, unknown> = { mode: 'repeat' };
    if (typeof recurrence.intervalMs === 'number') {
        payload.intervalMs = recurrence.intervalMs;
    }
    if (typeof recurrence.maxOccurrences === 'number') {
        payload.maxOccurrences = recurrence.maxOccurrences;
    }
    if (typeof recurrence.untilUtc === 'number') {
        payload.untilUtc = recurrence.untilUtc;
    }
    return payload;
};

const guessAttachmentKind = (raw: any, mimeType: string): DraftAttachmentKind => {
    const explicitKind = isAttachmentKind(raw?.kind) ? raw.kind : undefined;
    if (explicitKind) {
        return explicitKind;
    }

    const explicitMsgtype = coerceString(raw?.msgtype)?.toLowerCase();
    if (explicitMsgtype === 'm.sticker') return 'sticker';
    if (explicitMsgtype === 'm.image') return 'image';
    if (explicitMsgtype === 'm.audio') return 'audio';

    if (mimeType.startsWith('image/')) return 'image';
    if (mimeType.startsWith('audio/')) return 'audio';
    return 'file';
};

const normalizeAttachment = (raw: any, index: number): DraftAttachment | null => {
    if (!raw || typeof raw !== 'object') {
        return null;
    }

    const id = coerceString(raw.id) ?? `attachment_${Date.now()}_${index}`;
    const name = coerceString(raw.name) ?? coerceString(raw.body) ?? 'attachment';
    const size = coerceNumber(raw.size) ?? coerceNumber(raw.metadata?.size) ?? 0;
    const mimeType = coerceString(raw.mimeType)
        ?? coerceString(raw.info?.mimetype)
        ?? coerceString(raw.metadata?.mimeType)
        ?? 'application/octet-stream';

    const attachment: DraftAttachment = {
        id,
        name,
        size,
        mimeType,
        kind: guessAttachmentKind(raw, mimeType),
    };

    const dataUrl = coerceString(raw.dataUrl);
    if (dataUrl) attachment.dataUrl = dataUrl;

    const tempUrl = coerceString(raw.tempUrl) ?? coerceString(raw.blobUrl);
    if (tempUrl) attachment.tempUrl = tempUrl;

    const url = coerceString(raw.url);
    if (url) attachment.url = url;

    const thumbnailUrl = coerceString(raw.thumbnailUrl) ?? coerceString(raw.previewUrl);
    if (thumbnailUrl) attachment.thumbnailUrl = thumbnailUrl;

    const width = coerceNumber(raw.width) ?? coerceNumber(raw.info?.w);
    if (typeof width === 'number') attachment.width = width;

    const height = coerceNumber(raw.height) ?? coerceNumber(raw.info?.h);
    if (typeof height === 'number') attachment.height = height;

    const duration = coerceNumber(raw.duration) ?? coerceNumber(raw.info?.duration);
    if (typeof duration === 'number') attachment.duration = duration;

    const waveform = coerceWaveform(raw.waveform);
    if (waveform) attachment.waveform = waveform;

    const body = coerceString(raw.body);
    if (body) attachment.body = body;

    const msgtype = coerceString(raw.msgtype);
    if (msgtype) attachment.msgtype = msgtype;

    return attachment;
};

const normalizeDraftContent = (raw: unknown): DraftContent => {
    if (typeof raw === 'string') {
        return {
            plain: raw,
            formatted: undefined,
            attachments: [],
            msgtype: 'm.text',
        };
    }

    if (raw && typeof raw === 'object') {
        const record = raw as Record<string, unknown>;
        const plain = coerceString(record.plain)
            ?? coerceString(record.body)
            ?? coerceString(record.content)
            ?? '';
        const formatted = coerceString(record.formatted)
            ?? coerceString(record.formatted_body)
            ?? undefined;
        const msgtype = coerceString(record.msgtype) ?? undefined;

        const attachmentsRaw = Array.isArray(record.attachments) ? record.attachments : [];
        const attachments: DraftAttachment[] = attachmentsRaw
            .map((item, index) => normalizeAttachment(item, index))
            .filter((item): item is DraftAttachment => Boolean(item));

        let location: LocationContentPayload | null = null;
        const locationRaw = record.location;
        if (locationRaw && typeof locationRaw === 'object') {
            const latitude = Number((locationRaw as any).latitude);
            const longitude = Number((locationRaw as any).longitude);
            if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
                location = {
                    latitude,
                    longitude,
                    accuracy: Number.isFinite(Number((locationRaw as any).accuracy)) ? Number((locationRaw as any).accuracy) : undefined,
                    description: typeof (locationRaw as any).description === 'string' ? (locationRaw as any).description : undefined,
                    zoom: Number.isFinite(Number((locationRaw as any).zoom)) ? Number((locationRaw as any).zoom) : undefined,
                };
            }
        }

        return {
            plain,
            formatted,
            attachments,
            msgtype,
            location,
        };
    }

    return { plain: '', formatted: undefined, attachments: [], msgtype: undefined };
};

const serializeAttachment = (attachment: DraftAttachment): Record<string, unknown> => {
    const payload: Record<string, unknown> = {
        id: attachment.id,
        name: attachment.name,
        size: attachment.size,
        mimeType: attachment.mimeType,
        kind: attachment.kind,
    };

    if (attachment.dataUrl) payload.dataUrl = attachment.dataUrl;
    if (attachment.tempUrl) payload.tempUrl = attachment.tempUrl;
    if (attachment.url) payload.url = attachment.url;
    if (attachment.thumbnailUrl) payload.thumbnailUrl = attachment.thumbnailUrl;
    if (typeof attachment.width === 'number') payload.width = attachment.width;
    if (typeof attachment.height === 'number') payload.height = attachment.height;
    if (typeof attachment.duration === 'number') payload.duration = attachment.duration;
    if (attachment.waveform && attachment.waveform.length > 0) payload.waveform = attachment.waveform;
    if (attachment.body) payload.body = attachment.body;
    if (attachment.msgtype) payload.msgtype = attachment.msgtype;

    return payload;
};

const serializeDraftContent = (content: DraftContent): Record<string, unknown> => ({
    plain: content.plain,
    ...(content.formatted ? { formatted: content.formatted } : {}),
    ...(content.msgtype ? { msgtype: content.msgtype } : {}),
    ...(content.location ? { location: content.location } : {}),
    attachments: content.attachments.map(serializeAttachment),
});

const normalizeScheduledMessage = (raw: any): ScheduledMessage => {
    const message: ScheduledMessage = {
        id: typeof raw?.id === 'string' ? raw.id : String(raw?.id ?? `scheduled_${Date.now()}`),
        roomId: typeof raw?.roomId === 'string' ? raw.roomId : '',
        content: normalizeDraftContent(raw?.content),
        sendAt: typeof raw?.sendAt === 'number' ? raw.sendAt : Number(raw?.sendAt ?? Date.now()),
        sendAtUtc: typeof raw?.sendAtUtc === 'number' ? raw.sendAtUtc : undefined,
        timezoneOffset: typeof raw?.timezoneOffset === 'number' ? raw.timezoneOffset : undefined,
        timezoneId: typeof raw?.timezoneId === 'string' && raw.timezoneId.length > 0
            ? raw.timezoneId
            : undefined,
        status: raw?.status === 'sent' || raw?.status === 'retrying' ? raw.status : undefined,
        attempts: typeof raw?.attempts === 'number' ? raw.attempts : undefined,
        lastError: typeof raw?.lastError === 'string' ? raw.lastError : undefined,
        sentAt: typeof raw?.sentAt === 'number' ? raw.sentAt : undefined,
        nextRetryAt: typeof raw?.nextRetryAt === 'number' ? raw.nextRetryAt : undefined,
        recurrence: normalizeRecurrence(raw?.recurrence),
        occurrencesCompleted: coerceNonNegativeInteger(raw?.occurrencesCompleted) ?? 0,
        nextOccurrenceAt: typeof raw?.nextOccurrenceAt === 'number' ? raw.nextOccurrenceAt : undefined,
    };

    if (!message.sendAtUtc && typeof message.sendAt === 'number') {
        message.sendAtUtc = message.sendAt;
    }

    if (!message.status) {
        message.status = 'pending';
    }

    if (typeof message.attempts !== 'number' || Number.isNaN(message.attempts)) {
        message.attempts = 0;
    }

    return message;
};

const serializeScheduledMessage = (message: ScheduledMessage) => ({
    id: message.id,
    roomId: message.roomId,
    content: serializeDraftContent(message.content),
    sendAt: message.sendAt,
    sendAtUtc: message.sendAtUtc,
    timezoneOffset: message.timezoneOffset,
    timezoneId: message.timezoneId,
    status: message.status,
    attempts: message.attempts,
    lastError: message.lastError,
    sentAt: message.sentAt,
    nextRetryAt: message.nextRetryAt,
    recurrence: serializeRecurrence(message.recurrence),
    occurrencesCompleted: message.occurrencesCompleted,
    nextOccurrenceAt: message.nextOccurrenceAt,
});

const assignRoomToMessage = (message: ScheduledMessage, roomId: string | null): ScheduledMessage => {
    const assignedRoomId = roomId ?? message.roomId ?? '';
    const normalized: ScheduledMessage = {
        ...message,
        roomId: assignedRoomId,
        occurrencesCompleted: typeof message.occurrencesCompleted === 'number'
            && !Number.isNaN(message.occurrencesCompleted)
            ? message.occurrencesCompleted
            : 0,
    };
    if (
        normalized.recurrence?.mode === 'repeat'
        && typeof normalized.nextOccurrenceAt !== 'number'
    ) {
        const base = normalized.sendAtUtc ?? normalized.sendAt;
        if (typeof base === 'number') {
            normalized.nextOccurrenceAt = base;
        }
    }
    return normalized;
};

const parseSchedulerContent = (content: unknown, roomId: string | null): ScheduledMessage[] => {
    if (!content || typeof content !== 'object') {
        return [];
    }
    const messagesRaw = Array.isArray((content as any).messages) ? (content as any).messages : [];
    return messagesRaw
        .map((entry: any) => assignRoomToMessage(normalizeScheduledMessage(entry), roomId))
        .filter((message): message is ScheduledMessage => Boolean(message.roomId));
};


const readSchedulerStateForRoom = async (client: MatrixClient, roomId: string): Promise<ScheduledMessage[]> => {
    const stateKey = getSchedulerStateKey(client);
    const room = typeof client.getRoom === 'function' ? client.getRoom(roomId) : null;
    let event: MatrixEvent | null = null;
    try {
        const currentState = room?.currentState?.getStateEvents?.(SCHEDULED_MESSAGES_EVENT_TYPE, stateKey);
        if (Array.isArray(currentState)) {
            event = (currentState[currentState.length - 1] ?? null) as MatrixEvent | null;
        } else if (currentState) {
            event = currentState as MatrixEvent;
        }
    } catch (_) {
        /* noop */
    }
    if (event) {
        const { messages } = parseScheduledMessagesFromEvent(event, roomId);
        updateCacheForRoom(client, roomId, messages);
        return sortScheduledMessages(messages);
    }
    try {
        const raw = await client.getStateEvent(roomId, SCHEDULED_MESSAGES_EVENT_TYPE, stateKey);
        const messages = parseSchedulerContent(raw, roomId);
        updateCacheForRoom(client, roomId, messages);
        return sortScheduledMessages(messages);
    } catch (error) {
        const errcode = (error as any)?.errcode ?? (error as any)?.data?.errcode;
        const status = (error as any)?.statusCode ?? (error as any)?.httpStatus;
        if (errcode === 'M_NOT_FOUND' || status === 404) {
            removeCacheForRoom(client, roomId);
            return [];
        }
        console.error('Failed to load scheduled messages from state events', error);
        throw error;
    }
};

const getMessagesForRoom = async (client: MatrixClient, roomId: string): Promise<ScheduledMessage[]> => {
    const cache = getSchedulerCache(client);
    if (cache.byRoom.has(roomId)) {
        return [...(cache.byRoom.get(roomId) ?? [])];
    }
    return readSchedulerStateForRoom(client, roomId);
};

const listCandidateRooms = (client: MatrixClient): string[] => {
    try {
        const visible = typeof (client as any).getVisibleRooms === 'function' ? (client as any).getVisibleRooms() : null;
        if (Array.isArray(visible)) {
            return visible
                .map((room: any) => room?.roomId)
                .filter((roomId: unknown): roomId is string => typeof roomId === 'string' && roomId.length > 0);
        }
    } catch (_) {
        /* ignore */
    }
    try {
        const rooms = typeof client.getRooms === 'function' ? client.getRooms() : null;
        if (Array.isArray(rooms)) {
            return rooms
                .map(room => (room as any)?.roomId)
                .filter((roomId: unknown): roomId is string => typeof roomId === 'string' && roomId.length > 0);
        }
    } catch (_) {
        /* ignore */
    }
    return [];
};

const persistSchedulerState = async (client: MatrixClient, roomId: string, messages: ScheduledMessage[]): Promise<void> => {
    const stateKey = getSchedulerStateKey(client);
    const prepared = sortScheduledMessages(messages.map(message => assignRoomToMessage(message, roomId)));
    const payload = {
        version: SCHEDULER_STATE_VERSION,
        updatedAt: Date.now(),
        messages: prepared.map(serializeScheduledMessage),
    };
    try {
        await client.sendStateEvent(roomId, SCHEDULED_MESSAGES_EVENT_TYPE, payload, stateKey);
        updateCacheForRoom(client, roomId, prepared);
    } catch (error) {
        console.error('Failed to persist scheduled messages to state events', error);
        throw error;
    }
};

export const getCachedScheduledMessages = (client: MatrixClient): ScheduledMessage[] => flattenCache(client);

export const getScheduledMessages = async (client: MatrixClient): Promise<ScheduledMessage[]> => {
    const rooms = listCandidateRooms(client);
    if (rooms.length === 0) {
        return [];
    }
    const results = await Promise.all(rooms.map(roomId => readSchedulerStateForRoom(client, roomId)));
    return sortScheduledMessages(results.flat());
};

const findMessageById = async (client: MatrixClient, id: string): Promise<ScheduledMessage | null> => {
    const cached = flattenCache(client).find(message => message.id === id);
    if (cached) {
        return cached;
    }
    const rooms = listCandidateRooms(client);
    for (const roomId of rooms) {
        const messages = await getMessagesForRoom(client, roomId);
        const found = messages.find(message => message.id === id);
        if (found) {
            return found;
        }
    }
    return null;
};

export const addScheduledMessage = async (
    client: MatrixClient,
    roomId: string,
    content: DraftContent,
    sendAtUtc: number,
    options?: {
        timezoneOffset?: number;
        timezoneId?: string;
        localTimestamp?: number;
        recurrence?: ScheduledMessageRecurrence;
    },
): Promise<ScheduledMessage> => {
    const timezoneOffset = typeof options?.timezoneOffset === 'number'
        ? options.timezoneOffset
        : new Date(sendAtUtc).getTimezoneOffset();
    const localTimestamp = typeof options?.localTimestamp === 'number'
        ? options.localTimestamp
        : computeLocalTimestamp(sendAtUtc, timezoneOffset);
    const recurrence = normalizeRecurrence(options?.recurrence);
    const baseMessage: ScheduledMessage = assignRoomToMessage({
        id: `scheduled_${Date.now()}`,
        roomId,
        content: normalizeDraftContent(content),
        sendAt: localTimestamp,
        sendAtUtc,
        timezoneOffset,
        timezoneId: options?.timezoneId,
        status: 'pending',
        attempts: 0,
        recurrence,
        occurrencesCompleted: 0,
        nextOccurrenceAt: sendAtUtc,
    }, roomId);
    const existing = await getMessagesForRoom(client, roomId);
    const updated = sortScheduledMessages([...existing, baseMessage]);
    await persistSchedulerState(client, roomId, updated);
    return updated.find(message => message.id === baseMessage.id) ?? baseMessage;
};

export const deleteScheduledMessage = async (client: MatrixClient, id: string): Promise<void> => {
    const target = await findMessageById(client, id);
    if (!target?.roomId) {
        return;
    }
    const existing = await getMessagesForRoom(client, target.roomId);
    const filtered = existing.filter(message => message.id !== id);
    await persistSchedulerState(client, target.roomId, filtered);
};

export interface ScheduledMessageScheduleUpdate {
    sendAtUtc: number;
    timezoneOffset: number;
    timezoneId?: string;
    recurrence?: ScheduledMessageRecurrence;
}

export interface ScheduledMessageUpdatePayload {
    content?: DraftContent;
    schedule?: ScheduledMessageScheduleUpdate;
}

export const updateScheduledMessage = async (
    client: MatrixClient,
    id: string,
    update: ScheduledMessageUpdatePayload,
): Promise<ScheduledMessage | null> => {
    const target = await findMessageById(client, id);
    if (!target?.roomId) {
        return null;
    }
    const existing = await getMessagesForRoom(client, target.roomId);
    let hasChanges = false;
    const updated = existing.map(message => {
        if (message.id !== id) {
            return message;
        }
        let next: ScheduledMessage = { ...message };
        if (update.content) {
            next = { ...next, content: normalizeDraftContent(update.content) };
            hasChanges = true;
        }
        if (update.schedule) {
            const { sendAtUtc, timezoneOffset, timezoneId, recurrence } = update.schedule;
            next = {
                ...next,
                sendAtUtc,
                timezoneOffset,
                sendAt: computeLocalTimestamp(sendAtUtc, timezoneOffset),
                timezoneId,
                status: 'pending',
                attempts: 0,
                lastError: undefined,
                nextRetryAt: undefined,
                sentAt: undefined,
                recurrence: normalizeRecurrence(recurrence),
                occurrencesCompleted: 0,
                nextOccurrenceAt: sendAtUtc,
            };
            hasChanges = true;
        }
        return assignRoomToMessage(next, target.roomId);
    });
    if (!hasChanges) {
        return assignRoomToMessage(target, target.roomId);
    }
    await persistSchedulerState(client, target.roomId, updated);
    return updated.find(message => message.id === id) ?? null;
};

export const bulkUpdateScheduledMessages = async (
    client: MatrixClient,
    updates: Array<{ id: string } & ScheduledMessageUpdatePayload>,
): Promise<ScheduledMessage[]> => {
    if (updates.length === 0) {
        return getCachedScheduledMessages(client);
    }
    const buffers = new Map<string, { messages: ScheduledMessage[]; changed: boolean }>();
    const ensureBuffer = async (roomId: string) => {
        let bucket = buffers.get(roomId);
        if (!bucket) {
            bucket = { messages: await getMessagesForRoom(client, roomId), changed: false };
            buffers.set(roomId, bucket);
        }
        return bucket;
    };
    for (const entry of updates) {
        const target = await findMessageById(client, entry.id);
        if (!target?.roomId) {
            continue;
        }
        const bucket = await ensureBuffer(target.roomId);
        bucket.messages = bucket.messages.map(message => {
            if (message.id !== entry.id) {
                return message;
            }
            let next: ScheduledMessage = { ...message };
            if (entry.content) {
                next = { ...next, content: normalizeDraftContent(entry.content) };
                bucket.changed = true;
            }
            if (entry.schedule) {
                const { sendAtUtc, timezoneOffset, timezoneId, recurrence } = entry.schedule;
                next = {
                    ...next,
                    sendAtUtc,
                    timezoneOffset,
                    sendAt: computeLocalTimestamp(sendAtUtc, timezoneOffset),
                    timezoneId,
                    status: 'pending',
                    attempts: 0,
                    lastError: undefined,
                    nextRetryAt: undefined,
                    sentAt: undefined,
                    recurrence: normalizeRecurrence(recurrence),
                    occurrencesCompleted: 0,
                    nextOccurrenceAt: sendAtUtc,
                };
                bucket.changed = true;
            }
            return assignRoomToMessage(next, target.roomId);
        });
    }
    for (const [roomId, bucket] of buffers) {
        if (bucket.changed) {
            await persistSchedulerState(client, roomId, bucket.messages);
        }
    }
    return getCachedScheduledMessages(client);
};

const calculateRetryDelay = (attempts: number): number => {
    const safeAttempts = Math.max(1, attempts);
    const exponential = Math.pow(2, safeAttempts) * 1000; // 2s, 4s, 8s...
    return Math.min(exponential, 5 * 60 * 1000); // Cap at 5 minutes
};

export const markScheduledMessageSent = async (client: MatrixClient, id: string): Promise<void> => {
    const target = await findMessageById(client, id);
    if (!target?.roomId) {
        return;
    }
    const existing = await getMessagesForRoom(client, target.roomId);
    const updated = existing.map(message => {
        if (message.id !== id) {
            return message;
        }
        const base = assignRoomToMessage(message, target.roomId);
        if (base.recurrence?.mode === 'repeat' && typeof base.recurrence.intervalMs === 'number') {
            const occurrencesCompleted = (base.occurrencesCompleted ?? 0) + 1;
            const currentOccurrenceUtc = base.nextOccurrenceAt ?? base.sendAtUtc ?? base.sendAt;
            const nextUtc = typeof currentOccurrenceUtc === 'number'
                ? currentOccurrenceUtc + base.recurrence.intervalMs
                : Date.now() + base.recurrence.intervalMs;
            const reachedCountLimit = typeof base.recurrence.maxOccurrences === 'number'
                && occurrencesCompleted >= base.recurrence.maxOccurrences;
            const reachedTimeLimit = typeof base.recurrence.untilUtc === 'number'
                && nextUtc > base.recurrence.untilUtc;
            if (reachedCountLimit || reachedTimeLimit) {
                return {
                    ...base,
                    status: 'sent',
                    sentAt: Date.now(),
                    nextRetryAt: undefined,
                    lastError: undefined,
                    occurrencesCompleted,
                    nextOccurrenceAt: undefined,
                };
            }
            const timezoneOffset = typeof base.timezoneOffset === 'number'
                ? base.timezoneOffset
                : new Date(nextUtc).getTimezoneOffset();
            return {
                ...base,
                status: 'pending',
                sentAt: Date.now(),
                lastError: undefined,
                nextRetryAt: undefined,
                attempts: 0,
                occurrencesCompleted,
                sendAtUtc: nextUtc,
                sendAt: computeLocalTimestamp(nextUtc, timezoneOffset),
                timezoneOffset,
                nextOccurrenceAt: nextUtc,
            };
        }
        return {
            ...base,
            status: 'sent',
            sentAt: Date.now(),
            nextRetryAt: undefined,
            lastError: undefined,
            occurrencesCompleted: (base.occurrencesCompleted ?? 0) + 1,
        };
    });
    await persistSchedulerState(client, target.roomId, updated);
};

export const recordScheduledMessageError = async (
    client: MatrixClient,
    id: string,
    error: unknown,
): Promise<void> => {
    const target = await findMessageById(client, id);
    if (!target?.roomId) {
        return;
    }
    const existing = await getMessagesForRoom(client, target.roomId);
    const updated = existing.map(message => {
        if (message.id !== id) {
            return message;
        }
        const base = assignRoomToMessage(message, target.roomId);
        const attempts = (base.attempts ?? 0) + 1;
        const retryDelay = calculateRetryDelay(attempts);
        return {
            ...base,
            status: 'retrying',
            attempts,
            lastError: error instanceof Error ? error.message : String(error),
            nextRetryAt: Date.now() + retryDelay,
        };
    });
    await persistSchedulerState(client, target.roomId, updated);
};

export const parseScheduledMessagesFromEvent = (
    event: MatrixEvent | null,
    fallbackRoomId?: string,
): { roomId: string | null; messages: ScheduledMessage[] } => {
    if (!event) {
        return { roomId: fallbackRoomId ?? null, messages: [] };
    }
    const roomId = event.getRoomId?.() ?? fallbackRoomId ?? null;
    const content = event.getContent();
    const messages = parseSchedulerContent(content, roomId);
    return { roomId, messages };
};

export const applyScheduledMessagesEvent = (client: MatrixClient, event: MatrixEvent): ScheduledMessage[] => {
    const { roomId, messages } = parseScheduledMessagesFromEvent(event);
    if (roomId) {
        updateCacheForRoom(client, roomId, messages);
    }
    return getCachedScheduledMessages(client);
};


// ===================== Automations =====================

export type AutomationTrigger =
    | {
        type: 'room_event';
        eventType: string;
        roomId?: string;
        stateKey?: string;
        sender?: string;
    }
    | {
        type: 'webhook';
        event: string;
        connectorId?: string;
    };

export type AutomationConditionOperator = 'equals' | 'contains' | 'matches';

export interface AutomationCondition {
    field: string;
    operator: AutomationConditionOperator;
    value: string;
}

export interface AutomationActionSendMessage {
    type: 'send_message';
    roomId?: string;
    content?: DraftContent;
}

export interface AutomationActionAssignRole {
    type: 'assign_role';
    roomId: string;
    userId: string;
    role: string;
    reason?: string;
}

export interface AutomationActionInvokePlugin {
    type: 'invoke_plugin';
    pluginId: string;
    event?: string;
    payload?: Record<string, unknown>;
}

export type AutomationAction = AutomationActionSendMessage | AutomationActionAssignRole | AutomationActionInvokePlugin;

export type AutomationExecutionStatus = 'idle' | 'pending' | 'running' | 'success' | 'error';

export interface AutomationRule {
    id: string;
    name: string;
    description?: string;
    enabled: boolean;
    triggers: AutomationTrigger[];
    conditions: AutomationCondition[];
    actions: AutomationAction[];
    status?: AutomationExecutionStatus;
    lastRunAt?: number;
    lastError?: string;
}

type AutomationAccountState = {
    version: number;
    updatedAt: number;
    rules: AutomationRule[];
};

type AutomationExecutionContext =
    | { kind: 'room_event'; event: MatrixEvent }
    | { kind: 'webhook'; payload: BotBridgeWebhookPayload };

type AutomationExecutionJob = {
    ruleId: string;
    context: AutomationExecutionContext;
};

type AutomationRuntime = {
    rules: AutomationRule[];
    queue: AutomationExecutionJob[];
    processing: boolean;
    webhookUnsubscribe?: () => void;
};

const AUTOMATION_EVENT_TYPE = 'com.matrix_messenger.automation';
const AUTOMATION_EVENT_VERSION = 1;

const automationRuntimeStore = new WeakMap<MatrixClient, AutomationRuntime>();

const cloneDraftContentValue = (content?: DraftContent): DraftContent | undefined => {
    if (!content) {
        return undefined;
    }
    return {
        plain: content.plain,
        formatted: content.formatted,
        msgtype: content.msgtype,
        location: content.location ? { ...content.location } : undefined,
        attachments: content.attachments.map(attachment => ({
            ...attachment,
            waveform: attachment.waveform ? [...attachment.waveform] : undefined,
        })),
    };
};

const cloneAutomationRule = (rule: AutomationRule): AutomationRule => ({
    ...rule,
    triggers: rule.triggers.map(trigger => ({ ...trigger })),
    conditions: rule.conditions.map(condition => ({ ...condition })),
    actions: rule.actions.map(action => {
        if (action.type === 'send_message') {
            return {
                ...action,
                content: cloneDraftContentValue(action.content),
            } satisfies AutomationActionSendMessage;
        }
        if (action.type === 'assign_role') {
            return { ...action } satisfies AutomationActionAssignRole;
        }
        return {
            ...action,
            payload: action.payload ? { ...action.payload } : undefined,
        } satisfies AutomationActionInvokePlugin;
    }),
});

const getAutomationRuntime = (client: MatrixClient): AutomationRuntime => {
    let runtime = automationRuntimeStore.get(client);
    if (!runtime) {
        const initial = readAutomationState(client);
        runtime = {
            rules: initial.rules.map(cloneAutomationRule),
            queue: [],
            processing: false,
        };
        automationRuntimeStore.set(client, runtime);
    }
    return runtime;
};

const normalizeAutomationTrigger = (raw: any): AutomationTrigger | null => {
    if (!raw || typeof raw !== 'object') {
        return null;
    }
    const type = typeof raw.type === 'string'
        ? raw.type
        : typeof raw.kind === 'string'
            ? raw.kind
            : null;
    if (type === 'room_event') {
        const eventType = typeof raw.eventType === 'string'
            ? raw.eventType
            : typeof raw.event === 'string'
                ? raw.event
                : null;
        if (!eventType) {
            return null;
        }
        const roomId = typeof raw.roomId === 'string' && raw.roomId.length > 0 ? raw.roomId : undefined;
        const stateKey = typeof raw.stateKey === 'string' && raw.stateKey.length > 0 ? raw.stateKey : undefined;
        const sender = typeof raw.sender === 'string' && raw.sender.length > 0 ? raw.sender : undefined;
        return { type: 'room_event', eventType, roomId, stateKey, sender };
    }
    if (type === 'webhook') {
        const eventName = typeof raw.event === 'string' && raw.event.length > 0
            ? raw.event
            : typeof raw.eventName === 'string'
                ? raw.eventName
                : null;
        if (!eventName) {
            return null;
        }
        const connectorId = typeof raw.connectorId === 'string' && raw.connectorId.length > 0 ? raw.connectorId : undefined;
        return { type: 'webhook', event: eventName, connectorId };
    }
    return null;
};

const normalizeAutomationCondition = (raw: any): AutomationCondition | null => {
    if (!raw || typeof raw !== 'object') {
        return null;
    }
    const field = typeof raw.field === 'string'
        ? raw.field
        : typeof raw.path === 'string'
            ? raw.path
            : null;
    if (!field) {
        return null;
    }
    const operator: AutomationConditionOperator = raw.operator === 'contains'
        ? 'contains'
        : raw.operator === 'matches'
            ? 'matches'
            : 'equals';
    const value = typeof raw.value === 'string'
        ? raw.value
        : raw.value != null
            ? String(raw.value)
            : '';
    return { field, operator, value };
};

const normalizeAutomationAction = (raw: any): AutomationAction | null => {
    if (!raw || typeof raw !== 'object') {
        return null;
    }
    const type = typeof raw.type === 'string'
        ? raw.type
        : typeof raw.kind === 'string'
            ? raw.kind
            : null;
    if (type === 'send_message') {
        const roomId = typeof raw.roomId === 'string' && raw.roomId.length > 0 ? raw.roomId : undefined;
        const content = raw.content ? normalizeDraftContent(raw.content) : undefined;
        return { type: 'send_message', roomId, content } satisfies AutomationActionSendMessage;
    }
    if (type === 'assign_role') {
        const roomId = typeof raw.roomId === 'string' && raw.roomId.length > 0 ? raw.roomId : null;
        const userId = typeof raw.userId === 'string' && raw.userId.length > 0 ? raw.userId : null;
        const role = typeof raw.role === 'string' && raw.role.length > 0
            ? raw.role
            : typeof raw.roleId === 'string' && raw.roleId.length > 0
                ? raw.roleId
                : null;
        if (!roomId || !userId || !role) {
            return null;
        }
        const reason = typeof raw.reason === 'string' && raw.reason.length > 0 ? raw.reason : undefined;
        return { type: 'assign_role', roomId, userId, role, reason } satisfies AutomationActionAssignRole;
    }
    if (type === 'invoke_plugin') {
        const pluginId = typeof raw.pluginId === 'string' && raw.pluginId.length > 0
            ? raw.pluginId
            : typeof raw.id === 'string' && raw.id.length > 0
                ? raw.id
                : null;
        if (!pluginId) {
            return null;
        }
        const event = typeof raw.event === 'string' && raw.event.length > 0 ? raw.event : undefined;
        const payload = raw.payload && typeof raw.payload === 'object'
            ? { ...raw.payload }
            : undefined;
        return { type: 'invoke_plugin', pluginId, event, payload } satisfies AutomationActionInvokePlugin;
    }
    return null;
};

const normalizeAutomationRule = (raw: any): AutomationRule | null => {
    if (!raw || typeof raw !== 'object') {
        return null;
    }
    const id = typeof raw.id === 'string' && raw.id.length > 0
        ? raw.id
        : typeof raw.key === 'string' && raw.key.length > 0
            ? raw.key
            : `automation_${Date.now()}`;
    const name = typeof raw.name === 'string' && raw.name.length > 0
        ? raw.name
        : 'Automation';
    const description = typeof raw.description === 'string' && raw.description.length > 0
        ? raw.description
        : undefined;
    const enabled = raw.enabled === false ? false : raw.disabled === true ? false : true;
    const triggersRaw = Array.isArray(raw.triggers)
        ? raw.triggers
        : raw.trigger
            ? [raw.trigger]
            : [];
    const triggers = triggersRaw
        .map(entry => normalizeAutomationTrigger(entry))
        .filter((entry): entry is AutomationTrigger => Boolean(entry));
    if (triggers.length === 0) {
        return null;
    }
    const conditionsRaw = Array.isArray(raw.conditions) ? raw.conditions : [];
    const conditions = conditionsRaw
        .map(entry => normalizeAutomationCondition(entry))
        .filter((entry): entry is AutomationCondition => Boolean(entry));
    const actionsRaw = Array.isArray(raw.actions)
        ? raw.actions
        : raw.action
            ? [raw.action]
            : [];
    const actions = actionsRaw
        .map(entry => normalizeAutomationAction(entry))
        .filter((entry): entry is AutomationAction => Boolean(entry));
    if (actions.length === 0) {
        return null;
    }
    const status: AutomationExecutionStatus = raw.status === 'pending'
        || raw.status === 'running'
        || raw.status === 'success'
        || raw.status === 'error'
        ? raw.status
        : 'idle';
    const lastRunAt = typeof raw.lastRunAt === 'number' && Number.isFinite(raw.lastRunAt) ? raw.lastRunAt : undefined;
    const lastError = typeof raw.lastError === 'string' && raw.lastError.length > 0 ? raw.lastError : undefined;
    return {
        id,
        name,
        description,
        enabled,
        triggers,
        conditions,
        actions,
        status,
        lastRunAt,
        lastError,
    } satisfies AutomationRule;
};

const serializeAutomationTrigger = (trigger: AutomationTrigger): Record<string, unknown> => {
    if (trigger.type === 'room_event') {
        return {
            type: 'room_event',
            eventType: trigger.eventType,
            roomId: trigger.roomId,
            stateKey: trigger.stateKey,
            sender: trigger.sender,
        };
    }
    return {
        type: 'webhook',
        event: trigger.event,
        connectorId: trigger.connectorId,
    };
};

const serializeAutomationCondition = (condition: AutomationCondition): Record<string, unknown> => ({
    field: condition.field,
    operator: condition.operator,
    value: condition.value,
});

const serializeAutomationAction = (action: AutomationAction): Record<string, unknown> => {
    if (action.type === 'send_message') {
        return {
            type: 'send_message',
            roomId: action.roomId,
            content: action.content ? serializeDraftContent(action.content) : undefined,
        };
    }
    if (action.type === 'assign_role') {
        return {
            type: 'assign_role',
            roomId: action.roomId,
            userId: action.userId,
            role: action.role,
            reason: action.reason,
        };
    }
    return {
        type: 'invoke_plugin',
        pluginId: action.pluginId,
        event: action.event,
        payload: action.payload,
    };
};

const serializeAutomationRule = (rule: AutomationRule): Record<string, unknown> => ({
    id: rule.id,
    name: rule.name,
    description: rule.description,
    enabled: rule.enabled,
    triggers: rule.triggers.map(serializeAutomationTrigger),
    conditions: rule.conditions.map(serializeAutomationCondition),
    actions: rule.actions.map(serializeAutomationAction),
    status: rule.status,
    lastRunAt: rule.lastRunAt,
    lastError: rule.lastError,
});

const readAutomationState = (client: MatrixClient): AutomationAccountState => {
    try {
        const event = client.getAccountData?.(AUTOMATION_EVENT_TYPE as any);
        if (!event) {
            return { version: AUTOMATION_EVENT_VERSION, updatedAt: 0, rules: [] };
        }
        const content = event.getContent?.() ?? {};
        const rulesRaw = Array.isArray((content as any).rules) ? (content as any).rules : [];
        const rules = rulesRaw
            .map(entry => normalizeAutomationRule(entry))
            .filter((entry): entry is AutomationRule => Boolean(entry));
        const version = typeof (content as any).version === 'number'
            ? (content as any).version
            : AUTOMATION_EVENT_VERSION;
        const updatedAt = typeof (content as any).updatedAt === 'number'
            ? (content as any).updatedAt
            : 0;
        return { version, updatedAt, rules };
    } catch (error) {
        console.warn('Failed to read automation configuration from account data', error);
        return { version: AUTOMATION_EVENT_VERSION, updatedAt: 0, rules: [] };
    }
};

const persistAutomationState = async (client: MatrixClient, rules: AutomationRule[]): Promise<AutomationRule[]> => {
    if (typeof client.setAccountData !== 'function') {
        throw new Error('Matrix client does not support account data operations');
    }
    const payload = {
        version: AUTOMATION_EVENT_VERSION,
        updatedAt: Date.now(),
        rules: rules.map(serializeAutomationRule),
    };
    await client.setAccountData(AUTOMATION_EVENT_TYPE as any, payload as any);
    const runtime = getAutomationRuntime(client);
    runtime.rules = rules.map(cloneAutomationRule);
    return runtime.rules;
};

const mutateAutomationRules = async (
    client: MatrixClient,
    mutator: (rules: AutomationRule[]) => AutomationRule[],
): Promise<AutomationRule[]> => {
    const runtime = getAutomationRuntime(client);
    const base = runtime.rules.map(cloneAutomationRule);
    const next = mutator(base);
    return persistAutomationState(client, next);
};

export const getAutomationRules = (client: MatrixClient): AutomationRule[] => {
    const runtime = getAutomationRuntime(client);
    return runtime.rules.map(cloneAutomationRule);
};

export const setAutomationRules = async (
    client: MatrixClient,
    rules: AutomationRule[],
): Promise<AutomationRule[]> => persistAutomationState(client, rules.map(cloneAutomationRule));

export const upsertAutomationRule = async (
    client: MatrixClient,
    rule: AutomationRule,
): Promise<AutomationRule[]> => mutateAutomationRules(client, current => {
    const existingIndex = current.findIndex(entry => entry.id === rule.id);
    const prepared = cloneAutomationRule(rule);
    if (existingIndex >= 0) {
        const next = [...current];
        next.splice(existingIndex, 1, prepared);
        return next;
    }
    return [...current, prepared];
});

export const removeAutomationRule = async (
    client: MatrixClient,
    ruleId: string,
): Promise<AutomationRule[]> => mutateAutomationRules(client, current => current.filter(entry => entry.id !== ruleId));

export const toggleAutomationRule = async (
    client: MatrixClient,
    ruleId: string,
    enabled: boolean,
): Promise<AutomationRule[]> => mutateAutomationRules(client, current => current.map(entry => (
    entry.id === ruleId
        ? { ...entry, enabled }
        : entry
)));

const extractFieldValue = (source: any, field: string): unknown => {
    if (!field) {
        return undefined;
    }
    const segments = field.split('.').map(segment => segment.trim()).filter(Boolean);
    let current: any = source;
    for (const segment of segments) {
        if (current == null) {
            return undefined;
        }
        current = current[segment];
    }
    return current;
};

const evaluateCondition = (condition: AutomationCondition, context: any): boolean => {
    const actual = extractFieldValue(context, condition.field);
    if (actual == null) {
        return false;
    }
    const actualString = typeof actual === 'string'
        ? actual
        : (() => {
            try { return JSON.stringify(actual); } catch (_) { return String(actual); }
        })();
    switch (condition.operator) {
        case 'contains':
            return actualString.includes(condition.value);
        case 'matches':
            try {
                const regex = new RegExp(condition.value);
                return regex.test(actualString);
            } catch (error) {
                console.warn('Invalid automation regex condition', condition.value, error);
                return false;
            }
        case 'equals':
        default:
            return actualString === condition.value;
    }
};

const evaluateConditions = (conditions: AutomationCondition[], context: any): boolean => {
    if (!conditions || conditions.length === 0) {
        return true;
    }
    return conditions.every(condition => evaluateCondition(condition, context));
};

const triggerMatchesEvent = (trigger: AutomationTrigger, event: MatrixEvent): boolean => {
    if (trigger.type !== 'room_event') {
        return false;
    }
    if (trigger.eventType && trigger.eventType !== event.getType?.()) {
        return false;
    }
    if (trigger.roomId && trigger.roomId !== event.getRoomId?.()) {
        return false;
    }
    if (trigger.stateKey && trigger.stateKey !== event.getStateKey?.()) {
        return false;
    }
    if (trigger.sender && trigger.sender !== event.getSender?.()) {
        return false;
    }
    return true;
};

const triggerMatchesWebhook = (trigger: AutomationTrigger, payload: BotBridgeWebhookPayload): boolean => {
    if (trigger.type !== 'webhook') {
        return false;
    }
    if (trigger.event !== payload.event) {
        return false;
    }
    if (trigger.connectorId && trigger.connectorId !== payload.connectorId) {
        return false;
    }
    return true;
};

const setAutomationRuleStatus = async (
    client: MatrixClient,
    ruleId: string,
    status: AutomationExecutionStatus,
    errorMessage?: string,
): Promise<void> => {
    await mutateAutomationRules(client, current => current.map(rule => {
        if (rule.id !== ruleId) {
            return rule;
        }
        const timestamp = Date.now();
        if (status === 'success') {
            return { ...rule, status, lastRunAt: timestamp, lastError: undefined };
        }
        if (status === 'error') {
            return { ...rule, status, lastRunAt: timestamp, lastError: errorMessage ?? 'Неизвестная ошибка' };
        }
        if (status === 'running') {
            return { ...rule, status, lastRunAt: timestamp, lastError: undefined };
        }
        return { ...rule, status };
    }));
};

const resolveRoomFromContext = (context: AutomationExecutionContext): string | undefined => {
    if (context.kind === 'room_event') {
        return context.event.getRoomId?.() ?? undefined;
    }
    const data = context.payload.data as Record<string, unknown> | undefined;
    const roomId = typeof data?.roomId === 'string' ? data.roomId : undefined;
    return roomId;
};

const executeSendMessageAction = async (
    client: MatrixClient,
    action: AutomationActionSendMessage,
    context: AutomationExecutionContext,
): Promise<void> => {
    const targetRoomId = action.roomId ?? resolveRoomFromContext(context);
    if (!targetRoomId) {
        throw new Error('Не удалось определить комнату для отправки сообщения');
    }
    const content = action.content ?? { plain: 'Автоматическое сообщение', formatted: undefined, attachments: [], msgtype: 'm.text' };
    const body = content.plain && content.plain.trim().length > 0 ? content.plain : 'Автоматическое сообщение';
    const payload: Record<string, unknown> = {
        msgtype: content.msgtype ?? 'm.text',
        body,
    };
    if (content.formatted) {
        payload.format = 'org.matrix.custom.html';
        payload.formatted_body = content.formatted;
    }
    if (content.location) {
        payload.geo_uri = `geo:${content.location.latitude},${content.location.longitude}`;
        payload['org.matrix.msc3488.location'] = content.location;
    }
    await client.sendEvent(targetRoomId, 'm.room.message' as any, payload);
};

const executeAssignRoleAction = async (
    client: MatrixClient,
    action: AutomationActionAssignRole,
): Promise<void> => {
    await client.sendStateEvent(action.roomId, 'com.matrix_messenger.roles', {
        userId: action.userId,
        role: action.role,
        reason: action.reason,
    }, action.userId);
};

const buildSerializableContext = (context: AutomationExecutionContext): Record<string, unknown> => {
    if (context.kind === 'room_event') {
        return {
            kind: 'room_event',
            event: {
                type: context.event.getType?.(),
                roomId: context.event.getRoomId?.(),
                eventId: context.event.getId?.(),
                sender: context.event.getSender?.(),
                content: context.event.getContent?.(),
            },
        };
    }
    return {
        kind: 'webhook',
        payload: context.payload,
    };
};

const executeInvokePluginAction = async (
    action: AutomationActionInvokePlugin,
    context: AutomationExecutionContext,
): Promise<void> => {
    if (typeof window === 'undefined') {
        console.warn('Automation plugin invocation skipped: window is undefined');
        return;
    }
    const detail = {
        pluginId: action.pluginId,
        event: action.event,
        payload: action.payload ?? {},
        context: buildSerializableContext(context),
    };
    window.dispatchEvent(new CustomEvent('automation://invoke-plugin', { detail }));
};

const executeAutomationActions = async (
    client: MatrixClient,
    rule: AutomationRule,
    context: AutomationExecutionContext,
): Promise<void> => {
    for (const action of rule.actions) {
        if (action.type === 'send_message') {
            await executeSendMessageAction(client, action, context);
        } else if (action.type === 'assign_role') {
            await executeAssignRoleAction(client, action);
        } else if (action.type === 'invoke_plugin') {
            await executeInvokePluginAction(action, context);
        }
    }
};

const processAutomationQueue = async (client: MatrixClient, runtime: AutomationRuntime): Promise<void> => {
    if (runtime.processing) {
        return;
    }
    runtime.processing = true;
    try {
        while (runtime.queue.length > 0) {
            const job = runtime.queue.shift();
            if (!job) {
                continue;
            }
            const currentRuntime = getAutomationRuntime(client);
            const rule = currentRuntime.rules.find(entry => entry.id === job.ruleId);
            if (!rule || !rule.enabled) {
                continue;
            }
            try {
                await setAutomationRuleStatus(client, rule.id, 'running');
            } catch (error) {
                console.warn('Failed to set automation status to running', error);
            }
            try {
                await executeAutomationActions(client, rule, job.context);
                await setAutomationRuleStatus(client, rule.id, 'success');
                void sendNotification('Автоматизация выполнена', `Правило «${rule.name}» выполнено успешно.`, {
                    roomId: resolveRoomFromContext(job.context),
                });
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                await setAutomationRuleStatus(client, rule.id, 'error', message);
                void sendNotification('Ошибка автоматизации', `Правило «${rule.name}» завершилось с ошибкой: ${message}`);
            }
        }
    } finally {
        runtime.processing = false;
    }
};

const enqueueAutomationJob = (
    client: MatrixClient,
    rule: AutomationRule,
    context: AutomationExecutionContext,
) => {
    const runtime = getAutomationRuntime(client);
    runtime.queue.push({ ruleId: rule.id, context });
    void processAutomationQueue(client, runtime);
};

const handleAutomationMatrixEvent = (client: MatrixClient, event: MatrixEvent): void => {
    const runtime = getAutomationRuntime(client);
    if (runtime.rules.length === 0) {
        return;
    }
    const matching = runtime.rules.filter(rule => (
        rule.enabled
        && rule.triggers.some(trigger => triggerMatchesEvent(trigger, event))
    ));
    if (matching.length === 0) {
        return;
    }
    const context = {
        event: {
            type: event.getType?.(),
            roomId: event.getRoomId?.(),
            sender: event.getSender?.(),
            stateKey: event.getStateKey?.(),
            eventId: event.getId?.(),
        },
        content: event.getContent?.() ?? {},
    };
    matching.forEach(rule => {
        if (!evaluateConditions(rule.conditions, context)) {
            return;
        }
        enqueueAutomationJob(client, rule, { kind: 'room_event', event });
    });
};

const handleAutomationWebhook = (client: MatrixClient, payload: BotBridgeWebhookPayload): void => {
    const runtime = getAutomationRuntime(client);
    if (runtime.rules.length === 0) {
        return;
    }
    const matching = runtime.rules.filter(rule => (
        rule.enabled
        && rule.triggers.some(trigger => triggerMatchesWebhook(trigger, payload))
    ));
    if (matching.length === 0) {
        return;
    }
    const context = {
        webhook: {
            event: payload.event,
            connectorId: payload.connectorId,
            receivedAt: payload.receivedAt,
        },
        data: payload.data,
    };
    matching.forEach(rule => {
        if (!evaluateConditions(rule.conditions, context)) {
            return;
        }
        enqueueAutomationJob(client, rule, { kind: 'webhook', payload });
    });
};

export const startAutomationRuntime = (client: MatrixClient): (() => void) => {
    const runtime = getAutomationRuntime(client);
    runtime.rules = readAutomationState(client).rules.map(cloneAutomationRule);

    const timelineListener = (
        event: MatrixEvent,
        _room: unknown,
        toStartOfTimeline?: boolean,
        removed?: boolean,
        data?: { liveEvent?: boolean },
    ) => {
        if (!event || removed) {
            return;
        }
        if (toStartOfTimeline) {
            return;
        }
        if (data && data.liveEvent === false) {
            return;
        }
        try {
            handleAutomationMatrixEvent(client, event);
        } catch (error) {
            console.warn('Automation timeline handler failed', error);
        }
    };

    const accountDataListener = (event: MatrixEvent) => {
        try {
            if (event.getType?.() !== AUTOMATION_EVENT_TYPE) {
                return;
            }
            const content = event.getContent?.();
            const rulesRaw = Array.isArray((content as any)?.rules) ? (content as any).rules : [];
            runtime.rules = rulesRaw
                .map(entry => normalizeAutomationRule(entry))
                .filter((entry): entry is AutomationRule => Boolean(entry))
                .map(cloneAutomationRule);
        } catch (error) {
            console.warn('Failed to refresh automation rules from account data event', error);
        }
    };

    client.on(RoomEvent.Timeline as any, timelineListener as any);
    client.on(ClientEvent.AccountData as any, accountDataListener as any);

    const unsubscribeWebhook = onBotBridgeWebhook((payload) => {
        try {
            handleAutomationWebhook(client, payload);
        } catch (error) {
            console.warn('Automation webhook handler failed', error);
        }
    });

    runtime.webhookUnsubscribe = unsubscribeWebhook;

    return () => {
        try {
            client.removeListener(RoomEvent.Timeline as any, timelineListener as any);
        } catch (error) {
            console.warn('Failed to detach automation timeline listener', error);
        }
        try {
            client.removeListener(ClientEvent.AccountData as any, accountDataListener as any);
        } catch (error) {
            console.warn('Failed to detach automation account data listener', error);
        }
        try {
            runtime.webhookUnsubscribe?.();
        } catch (error) {
            console.warn('Failed to detach automation webhook listener', error);
        }
        automationRuntimeStore.delete(client);
    };
};


// ===================== TTL (Disappearing messages) =====================

export type TTLJob = {
    id: string;
    roomId: string;
    eventId: string;
    expiresAt: number; // epoch ms
    attempts?: number;
    nextRetryAt?: number;
    lastError?: string;
};

const TTL_JOBS_EVENT_TYPE = 'org.econix.ttl_jobs';

type TTLJobsPayload = { jobs: TTLJob[] };

const readTtlJobs = (client: MatrixClient): TTLJobsPayload => {
    try {
        const ev = client.getAccountData(TTL_JOBS_EVENT_TYPE);
        if (!ev) return { jobs: [] };
        const content = ev.getContent();
        if (!content || !Array.isArray((content as any).jobs)) return { jobs: [] };
        const jobs = ((content as any).jobs as any[]).map(j => ({
            id: String(j.id ?? `${j.roomId}_${j.eventId}`),
            roomId: String(j.roomId ?? ''),
            eventId: String(j.eventId ?? ''),
            expiresAt: Number(j.expiresAt ?? 0),
            attempts: Number.isFinite(j.attempts) ? Number(j.attempts) : 0,
            nextRetryAt: Number.isFinite(j.nextRetryAt) ? Number(j.nextRetryAt) : undefined,
            lastError: typeof j.lastError === 'string' ? j.lastError : undefined,
        })).filter(j => j.roomId && j.eventId && j.expiresAt > 0);
        return { jobs };
    } catch (e) {
        console.error('Failed to read TTL jobs account data', e);
        return { jobs: [] };
    }
};

const persistTtlJobs = async (client: MatrixClient, jobs: TTLJob[]): Promise<void> => {
    const payload: TTLJobsPayload = { jobs: jobs.map(j => ({
        id: String(j.id),
        roomId: j.roomId,
        eventId: j.eventId,
        expiresAt: Number(j.expiresAt),
        attempts: Number(j.attempts ?? 0),
        nextRetryAt: j.nextRetryAt ? Number(j.nextRetryAt) : undefined,
        lastError: j.lastError,
    }))};
    await client.setAccountData(TTL_JOBS_EVENT_TYPE, payload as any);
};

export const addTtlJob = async (client: MatrixClient, job: TTLJob): Promise<void> => {
    const existing = readTtlJobs(client).jobs;
    const withoutDup = existing.filter(j => !(j.roomId === job.roomId && j.eventId === job.eventId));
    withoutDup.push(job);
    await persistTtlJobs(client, withoutDup.sort((a,b)=>a.expiresAt-b.expiresAt));
};

export const removeTtlJob = async (client: MatrixClient, roomId: string, eventId: string): Promise<void> => {
    const existing = readTtlJobs(client).jobs;
    const updated = existing.filter(j => !(j.roomId === roomId && j.eventId === eventId));
    await persistTtlJobs(client, updated);
};

const ttlTimers = new Map<string, number>(); // key: roomId|eventId -> timer id

const scheduleTimer = (client: MatrixClient, job: TTLJob) => {
    const key = `${job.roomId}|${job.eventId}`;
    if (ttlTimers.has(key)) {
        window.clearTimeout(ttlTimers.get(key)!);
        ttlTimers.delete(key);
    }
    const delay = Math.max(0, job.expiresAt - Date.now());
    const id = window.setTimeout(async () => {
        try {
            await client.redactEvent(job.roomId, job.eventId, 'TTL expired');
            await removeTtlJob(client, job.roomId, job.eventId);
        } catch (err) {
            const attempts = (job.attempts ?? 0) + 1;
            const nextRetryDelay = Math.min(5 * 60 * 1000, Math.pow(2, attempts) * 1000);
            const retryJob: TTLJob = { ...job, attempts, nextRetryAt: Date.now() + nextRetryDelay, lastError: String(err) };
            await addTtlJob(client, retryJob);
            scheduleTimer(client, { ...retryJob, expiresAt: retryJob.nextRetryAt! });
        }
    }, delay);
    ttlTimers.set(key, id);
};

export const scheduleTtlRedaction = async (client: MatrixClient, roomId: string, eventId: string, expiresAt: number) => {
    const job: TTLJob = { id: `${roomId}_${eventId}`, roomId, eventId, expiresAt };
    await addTtlJob(client, job);
    scheduleTimer(client, job);
};

export const startTtlWatcher = (client: MatrixClient) => {
    // Reschedule existing jobs from account data
    const { jobs } = readTtlJobs(client);
    jobs.forEach(job => scheduleTimer(client, job));

    // Watch timeline for new TTL annotated messages
    const handler = (event: MatrixEvent) => {
        try {
            if (event.getType() !== 'm.room.message') return;
            const content: any = event.getContent() || {};
            const rel = content['m.relates_to'];
            let ttlMs: number | null = null;
            if (typeof rel === 'object') {
                if (rel.rel_type === 'org.econix.ttl' && Number.isFinite(rel.ttl_ms)) {
                    ttlMs = Number(rel.ttl_ms);
                } else if (rel.rel_type === 'm.annotation' && (rel.key === 'org.econix.ttl' || rel.key === 'econix.ttl') && Number.isFinite(rel.ttl_ms)) {
                    ttlMs = Number(rel.ttl_ms);
                }
            }
            if (!ttlMs && Number.isFinite((content as any)['org.econix.ttl_ms'])) {
                ttlMs = Number((content as any)['org.econix.ttl_ms']);
            }
            if (!ttlMs || ttlMs <= 0) return;
            const ts = event.getTs?.() ?? Date.now();
            const expiresAt = ts + ttlMs;
            scheduleTtlRedaction(client, event.getRoomId(), event.getId(), expiresAt);
        } catch (e) {
            console.warn('TTL watcher error', e);
        }
    };

    // @ts-ignore TS may not know addListener signature
    client.on('Room.timeline', (_ev: any, _room: any, _toStart: any, _removed: any, data: any) => {
        const event = data?.event as MatrixEvent | undefined;
        if (event) handler(event);
    });

    // Retry pending jobs on sync resume
    // @ts-ignore
    client.on('sync', (state: string) => {
        if (state === 'PREPARED' || state === 'SYNCING' || state === 'RECONNECTING') {
            const { jobs } = readTtlJobs(client);
            jobs.forEach(job => scheduleTimer(client, job));
        }
    });
};
