import { MatrixClient, MatrixEvent, ScheduledMessage, DraftAttachment, DraftContent, DraftAttachmentKind } from '../types';
import { computeLocalTimestamp } from '../utils/timezone';

export const SCHEDULED_MESSAGES_EVENT_TYPE = 'com.matrix_messenger.scheduled';

interface AccountDataPayload {
    messages: ScheduledMessage[];
}

const EMPTY_PAYLOAD: AccountDataPayload = { messages: [] };

const ATTACHMENT_KINDS: DraftAttachmentKind[] = ['file', 'image', 'audio', 'voice', 'sticker', 'gif'];

const isAttachmentKind = (value: unknown): value is DraftAttachmentKind =>
    typeof value === 'string' && ATTACHMENT_KINDS.includes(value as DraftAttachmentKind);

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

const coerceWaveform = (value: unknown): number[] | undefined => {
    if (!Array.isArray(value)) {
        return undefined;
    }
    const normalized = value
        .map(entry => (typeof entry === 'number' ? entry : Number(entry)))
        .filter(entry => typeof entry === 'number' && !Number.isNaN(entry));
    return normalized.length > 0 ? normalized : undefined;
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
});

const readAccountData = (client: MatrixClient): AccountDataPayload => {
    try {
        const event = client.getAccountData(SCHEDULED_MESSAGES_EVENT_TYPE);
        if (!event) {
            return EMPTY_PAYLOAD;
        }
        const content = event.getContent();
        if (!content || !Array.isArray(content.messages)) {
            return EMPTY_PAYLOAD;
        }

        return {
            messages: (content.messages as any[]).map(normalizeScheduledMessage),
        };
    } catch (error) {
        console.error('Failed to read scheduled messages from account data', error);
        return EMPTY_PAYLOAD;
    }
};

const persistAccountData = async (client: MatrixClient, messages: ScheduledMessage[]): Promise<void> => {
    const payload: AccountDataPayload = {
        messages: messages
            .map(normalizeScheduledMessage)
            .sort((a, b) => (a.sendAtUtc ?? a.sendAt) - (b.sendAtUtc ?? b.sendAt))
            .map(serializeScheduledMessage),
    };

    try {
        await client.setAccountData(SCHEDULED_MESSAGES_EVENT_TYPE, payload);
    } catch (error) {
        console.error('Failed to persist scheduled messages to account data', error);
        throw error;
    }
};

export const getScheduledMessages = async (client: MatrixClient): Promise<ScheduledMessage[]> => {
    return readAccountData(client).messages;
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
    },
): Promise<ScheduledMessage> => {
    const existing = readAccountData(client).messages;
    const timezoneOffset = typeof options?.timezoneOffset === 'number'
        ? options.timezoneOffset
        : new Date(sendAtUtc).getTimezoneOffset();
    const localTimestamp = typeof options?.localTimestamp === 'number'
        ? options.localTimestamp
        : computeLocalTimestamp(sendAtUtc, timezoneOffset);

    const newMessage: ScheduledMessage = {
        id: `scheduled_${Date.now()}`,
        roomId,
        content: normalizeDraftContent(content),
        sendAt: localTimestamp,
        sendAtUtc,
        timezoneOffset,
        timezoneId: options?.timezoneId,
        status: 'pending',
        attempts: 0,
    };

    await persistAccountData(client, [...existing, newMessage]);
    return newMessage;
};

export const deleteScheduledMessage = async (client: MatrixClient, id: string): Promise<void> => {
    const existing = readAccountData(client).messages;
    const updated = existing.filter(msg => msg.id !== id);
    await persistAccountData(client, updated);
};

export interface ScheduledMessageScheduleUpdate {
    sendAtUtc: number;
    timezoneOffset: number;
    timezoneId?: string;
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
    const existing = readAccountData(client).messages;
    let hasChanges = false;

    const updated = existing.map(message => {
        if (message.id !== id) {
            return message;
        }

        const next: ScheduledMessage = { ...message };

        if (update.content) {
            next.content = normalizeDraftContent(update.content);
            hasChanges = true;
        }

        if (update.schedule) {
            const { sendAtUtc, timezoneOffset, timezoneId } = update.schedule;
            next.sendAtUtc = sendAtUtc;
            next.timezoneOffset = timezoneOffset;
            next.sendAt = computeLocalTimestamp(sendAtUtc, timezoneOffset);
            next.timezoneId = timezoneId;
            next.status = 'pending';
            next.attempts = 0;
            next.lastError = undefined;
            next.nextRetryAt = undefined;
            next.sentAt = undefined;
            hasChanges = true;
        }

        return next;
    });

    if (!hasChanges) {
        return existing.find(msg => msg.id === id) ?? null;
    }

    const sorted = [...updated].sort((a, b) => (a.sendAtUtc ?? a.sendAt) - (b.sendAtUtc ?? b.sendAt));
    await persistAccountData(client, sorted);
    return sorted.find(msg => msg.id === id) ?? null;
};

export const bulkUpdateScheduledMessages = async (
    client: MatrixClient,
    updates: Array<{ id: string } & ScheduledMessageUpdatePayload>,
): Promise<ScheduledMessage[]> => {
    if (updates.length === 0) {
        return readAccountData(client).messages;
    }

    const updatesMap = new Map<string, ScheduledMessageUpdatePayload>();
    updates.forEach(entry => {
        const { id, ...rest } = entry;
        updatesMap.set(id, rest);
    });

    const existing = readAccountData(client).messages;
    let hasChanges = false;

    const nextMessages = existing.map(message => {
        const update = updatesMap.get(message.id);
        if (!update) {
            return message;
        }

        const next: ScheduledMessage = { ...message };

        if (update.content) {
            next.content = normalizeDraftContent(update.content);
            hasChanges = true;
        }

        if (update.schedule) {
            const { sendAtUtc, timezoneOffset, timezoneId } = update.schedule;
            next.sendAtUtc = sendAtUtc;
            next.timezoneOffset = timezoneOffset;
            next.sendAt = computeLocalTimestamp(sendAtUtc, timezoneOffset);
            next.timezoneId = timezoneId;
            next.status = 'pending';
            next.attempts = 0;
            next.lastError = undefined;
            next.nextRetryAt = undefined;
            next.sentAt = undefined;
            hasChanges = true;
        }

        return next;
    });

    if (!hasChanges) {
        return existing;
    }

    const sorted = [...nextMessages].sort((a, b) => (a.sendAtUtc ?? a.sendAt) - (b.sendAtUtc ?? b.sendAt));
    await persistAccountData(client, sorted);
    return sorted;
};

const calculateRetryDelay = (attempts: number): number => {
    const safeAttempts = Math.max(1, attempts);
    const exponential = Math.pow(2, safeAttempts) * 1000; // 2s, 4s, 8s...
    return Math.min(exponential, 5 * 60 * 1000); // Cap at 5 minutes
};

export const markScheduledMessageSent = async (client: MatrixClient, id: string): Promise<void> => {
    const existing = readAccountData(client).messages;
    const updated = existing.map(message => {
        if (message.id !== id) return message;

        return {
            ...message,
            status: 'sent',
            sentAt: Date.now(),
            nextRetryAt: undefined,
            lastError: undefined,
        };
    });

    await persistAccountData(client, updated);
};

export const recordScheduledMessageError = async (
    client: MatrixClient,
    id: string,
    error: unknown,
): Promise<void> => {
    const existing = readAccountData(client).messages;
    const updated = existing.map(message => {
        if (message.id !== id) return message;

        const attempts = (message.attempts ?? 0) + 1;
        const retryDelay = calculateRetryDelay(attempts);

        return {
            ...message,
            status: 'retrying',
            attempts,
            lastError: error instanceof Error ? error.message : String(error),
            nextRetryAt: Date.now() + retryDelay,
        };
    });

    await persistAccountData(client, updated);
};

export const parseScheduledMessagesFromEvent = (event: MatrixEvent | null): ScheduledMessage[] => {
    if (!event) return [];
    const content = event.getContent();
    if (!content || !Array.isArray(content.messages)) {
        return [];
    }

    return (content.messages as any[]).map(normalizeScheduledMessage);
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
