import type { MatrixClient } from '../types';
import { BotBridgeWebhookPayload, onBotBridgeWebhook } from './botBridgeWebhook';

export interface InviteWebhookData {
    roomId: string;
    via?: string[];
    reason?: string;
}

export interface FileWebhookData {
    roomId: string;
    url: string;
    name?: string;
    size?: number;
    mimetype?: string;
    body?: string;
    thumbnailUrl?: string;
}

export type BotBridgeWebhookEventData = InviteWebhookData | FileWebhookData | Record<string, unknown>;

type SyncHandler = (client: MatrixClient, payload: BotBridgeWebhookPayload) => Promise<void>;

const textEncoder = new TextEncoder();

const arrayBufferFromResponse = async (response: Response): Promise<ArrayBuffer> => {
    if (typeof response.arrayBuffer === 'function') {
        return response.arrayBuffer();
    }
    const text = await response.text();
    return textEncoder.encode(text).buffer;
};

const handleInviteEvent = async (client: MatrixClient, payload: BotBridgeWebhookPayload<InviteWebhookData>): Promise<void> => {
    const { roomId, via = [], reason } = payload.data;
    await client.joinRoom(roomId, { viaServers: via, reason });
};

const handleFileEvent = async (client: MatrixClient, payload: BotBridgeWebhookPayload<FileWebhookData>): Promise<void> => {
    const { roomId, url, name, size, mimetype, body } = payload.data;
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Failed to download file for webhook event: ${response.status} ${response.statusText}`);
    }
    const buffer = await arrayBufferFromResponse(response);
    const uploadResult = await client.uploadContent(buffer, {
        type: mimetype,
        name,
    } as any);
    const contentUri = typeof uploadResult === 'string' ? uploadResult : (uploadResult as any).content_uri;
    await client.sendEvent(roomId, 'm.room.message' as any, {
        msgtype: 'm.file',
        body: body ?? name ?? 'Вложение',
        url: contentUri,
        info: {
            size,
            mimetype,
        },
    });
};

const handlers: Record<string, SyncHandler> = {
    'invite': handleInviteEvent as SyncHandler,
    'file.uploaded': handleFileEvent as SyncHandler,
    'message.file': handleFileEvent as SyncHandler,
};

export const synchroniseWebhookEvent = async (client: MatrixClient, payload: BotBridgeWebhookPayload): Promise<void> => {
    const handler = handlers[payload.event];
    if (!handler) {
        console.warn('Unhandled bot bridge webhook event', payload.event);
        return;
    }
    await handler(client, payload);
};

export const attachBotBridgeSync = (client: MatrixClient): (() => void) => {
    const unsubscribe = onBotBridgeWebhook(async (payload) => {
        try {
            await synchroniseWebhookEvent(client, payload);
        } catch (error) {
            console.error('Failed to synchronise bot bridge event', payload, error);
        }
    });
    return unsubscribe;
};
