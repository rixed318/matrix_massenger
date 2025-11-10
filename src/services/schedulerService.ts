import { MatrixClient, MatrixEvent, ScheduledMessage, ScheduledMessageRecurrence, DraftAttachment, DraftContent, DraftAttachmentKind } from '../types';
import { computeLocalTimestamp } from '../utils/timezone';

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

        return {
            plain,
            formatted,
            attachments,
            msgtype,
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
