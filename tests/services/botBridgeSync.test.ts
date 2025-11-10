import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { synchroniseWebhookEvent } from '../../src/services/botBridgeSync';
import type { MatrixClient } from '../../src/types';

const createClient = (): MatrixClient => ({
    joinRoom: vi.fn().mockResolvedValue(undefined),
    uploadContent: vi.fn().mockResolvedValue({ content_uri: 'mxc://example/abc' }),
    sendEvent: vi.fn().mockResolvedValue(undefined),
} as unknown as MatrixClient);

describe('botBridge webhook synchronisation', () => {
    const originalFetch = global.fetch;

    beforeEach(() => {
        global.fetch = vi.fn();
    });

    afterEach(() => {
        global.fetch = originalFetch;
        vi.restoreAllMocks();
    });

    it('joins Matrix room for invite events', async () => {
        const client = createClient();
        await synchroniseWebhookEvent(client, {
            connectorId: 'slack',
            event: 'invite',
            data: { roomId: '!room:example.org', via: ['example.org'] },
            receivedAt: Date.now(),
        });

        expect(client.joinRoom).toHaveBeenCalledWith('!room:example.org', { viaServers: ['example.org'], reason: undefined });
    });

    it('downloads files, uploads to Matrix and sends events', async () => {
        (global.fetch as any).mockResolvedValue(
            new Response('test-data', { status: 200, headers: { 'Content-Type': 'application/octet-stream' } }),
        );
        const client = createClient();

        await synchroniseWebhookEvent(client, {
            connectorId: 'slack',
            event: 'file.uploaded',
            data: {
                roomId: '!room:example.org',
                url: 'https://example.com/file.txt',
                name: 'file.txt',
                mimetype: 'text/plain',
                size: 10,
            },
            receivedAt: Date.now(),
        });

        expect(global.fetch).toHaveBeenCalledWith('https://example.com/file.txt');
        expect(client.uploadContent).toHaveBeenCalled();
        expect(client.sendEvent).toHaveBeenCalledWith(
            '!room:example.org',
            'm.room.message',
            expect.objectContaining({
                msgtype: 'm.file',
                url: 'mxc://example/abc',
            }),
        );
    });
});
