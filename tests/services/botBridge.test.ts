import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
    BotBridgeError,
    BotBridgeConnectorManifest,
    configureBotBridge,
    getBot,
    listBots,
    loadConnectorManifest,
    sendBotCommand,
    updateConnectorAuth,
} from '../../src/services/botBridge';
import type { BotBridgeConnectorAuthState } from '../../src/services/botBridge';

const jsonResponse = (value: unknown, init?: ResponseInit): Response =>
    new Response(JSON.stringify(value), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        ...init,
    });

describe('botBridge multi-connector support', () => {
    const originalFetch = global.fetch;

    beforeEach(() => {
        global.fetch = vi.fn();
        configureBotBridge({
            connectors: {
                slack: {
                    id: 'slack',
                    baseUrl: 'https://slack.example.com/api',
                    manifestUrl: '/manifest',
                    headers: { 'x-connector': 'slack' },
                    retry: { maxAttempts: 2 },
                },
                teams: {
                    id: 'teams',
                    baseUrl: 'https://teams.example.com/api',
                    manifestUrl: '/manifest',
                    headers: { 'x-connector': 'teams' },
                },
            },
            defaultConnectorId: 'slack',
            defaultTimeoutMs: 5000,
        });
    });

    afterEach(() => {
        global.fetch = originalFetch;
    });

    it('sends requests using specific connector configuration', async () => {
        (global.fetch as any).mockResolvedValueOnce(jsonResponse([{ id: 'bot-1', displayName: 'Slack bot' }]));

        const bots = await listBots({ connectorId: 'slack' });
        expect(bots).toHaveLength(1);

        expect(global.fetch).toHaveBeenCalledWith(
            'https://slack.example.com/api/bots',
            expect.objectContaining({
                method: 'GET',
                headers: expect.any(Headers),
            }),
        );
    });

    it('merges auth state and retries transient failures', async () => {
        const auth: BotBridgeConnectorAuthState = {
            scheme: 'api_key',
            apiKey: 'sk-123',
        };
        updateConnectorAuth('teams', auth);

        (global.fetch as any)
            .mockRejectedValueOnce(new Error('Network fail'))
            .mockResolvedValueOnce(jsonResponse({ ok: true }));

        const result = await sendBotCommand('bot-42', 'ping', undefined, { connectorId: 'teams' });
        expect(result.ok).toBe(true);

        expect(global.fetch).toHaveBeenCalledTimes(2);
        const [, options] = (global.fetch as any).mock.calls[1];
        const headers = options.headers as Headers;
        expect(headers.get('x-api-key')).toBe('sk-123');
    });

    it('propagates manifest and caches it', async () => {
        const manifest: BotBridgeConnectorManifest = {
            id: 'slack',
            displayName: 'Slack',
            capabilities: ['messages'],
            auth: 'api_key',
        };
        (global.fetch as any).mockResolvedValueOnce(jsonResponse(manifest));

        const loaded = await loadConnectorManifest('slack');
        expect(loaded).toEqual(manifest);

        await loadConnectorManifest('slack');
        expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    it('wraps http errors into BotBridgeError with connectorId', async () => {
        (global.fetch as any).mockResolvedValueOnce(
            jsonResponse({ error: 'not found' }, { status: 404 }),
        );

        await expect(getBot('missing', { connectorId: 'teams' })).rejects.toMatchObject({
            connectorId: 'teams',
            status: 404,
            name: 'BotBridgeError',
        } satisfies Partial<BotBridgeError>);
    });
});
