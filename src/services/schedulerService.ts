import { MatrixClient, MatrixEvent, ScheduledMessage } from '../types';

export const SCHEDULED_MESSAGES_EVENT_TYPE = 'com.matrix_messenger.scheduled';

interface AccountDataPayload {
    messages: ScheduledMessage[];
}

const EMPTY_PAYLOAD: AccountDataPayload = { messages: [] };

const normalizeScheduledMessage = (raw: any): ScheduledMessage => {
    const message: ScheduledMessage = {
        id: typeof raw?.id === 'string' ? raw.id : String(raw?.id ?? `scheduled_${Date.now()}`),
        roomId: typeof raw?.roomId === 'string' ? raw.roomId : '',
        content: typeof raw?.content === 'string' ? raw.content : '',
        sendAt: typeof raw?.sendAt === 'number' ? raw.sendAt : Number(raw?.sendAt ?? Date.now()),
        sendAtUtc: typeof raw?.sendAtUtc === 'number' ? raw.sendAtUtc : undefined,
        timezoneOffset: typeof raw?.timezoneOffset === 'number' ? raw.timezoneOffset : undefined,
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
    content: message.content,
    sendAt: message.sendAt,
    sendAtUtc: message.sendAtUtc,
    timezoneOffset: message.timezoneOffset,
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
    content: string,
    sendAt: number,
): Promise<ScheduledMessage> => {
    const existing = readAccountData(client).messages;
    const sendAtDate = new Date(sendAt);

    const newMessage: ScheduledMessage = {
        id: `scheduled_${Date.now()}`,
        roomId,
        content,
        sendAt,
        sendAtUtc: sendAt,
        timezoneOffset: sendAtDate.getTimezoneOffset(),
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
