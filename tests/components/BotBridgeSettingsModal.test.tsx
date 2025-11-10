import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import BotBridgeSettingsModal from '../../src/components/BotBridgeSettingsModal';
import * as botBridge from '../../src/services/botBridge';

const jsonResponse = (value: unknown, init?: ResponseInit): Response =>
    new Response(JSON.stringify(value), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        ...init,
    });

vi.mock('../../src/services/botBridgeSecretsStore', () => {
    const saveMock = vi.fn().mockResolvedValue(undefined);
    const clearMock = vi.fn().mockResolvedValue(undefined);
    return {
        loadConnectorSecrets: vi.fn().mockResolvedValue(null),
        saveConnectorSecrets: saveMock,
        clearConnectorSecrets: clearMock,
        mergeConnectorAuthState: (base: any, next: any) => {
            if (!next) return base;
            return { ...(base ?? {}), ...next };
        },
        __esModule: true,
    };
});

const secretsStore = await import('../../src/services/botBridgeSecretsStore');

describe('BotBridgeSettingsModal', () => {
    const originalFetch = global.fetch;

    beforeEach(() => {
        global.fetch = vi.fn();
    });

    afterEach(() => {
        global.fetch = originalFetch;
        vi.restoreAllMocks();
    });

    it('renders connectors and persists API key secrets', async () => {
        (global.fetch as any).mockResolvedValue(jsonResponse({
            id: 'slack',
            displayName: 'Slack',
            capabilities: ['messages'],
            auth: 'api_key',
            apiKey: { header: 'x-slack-token' },
        }));

        botBridge.configureBotBridge({
            connectors: {
                slack: {
                    id: 'slack',
                    baseUrl: 'https://slack.example.com/api',
                    manifestUrl: '/manifest.json',
                },
            },
            defaultConnectorId: 'slack',
        });

        const defaultSpy = vi.spyOn(botBridge, 'setDefaultConnector');

        render(<BotBridgeSettingsModal open onClose={() => undefined} />);

        const apiKeyInput = await screen.findByLabelText('API ключ');
        fireEvent.change(apiKeyInput, { target: { value: 'sk-live-123' } });

        fireEvent.click(screen.getByText('Сохранить настройки'));

        await waitFor(() => {
            expect(secretsStore.saveConnectorSecrets).toHaveBeenCalledWith('slack', expect.objectContaining({
                scheme: 'api_key',
                apiKey: 'sk-live-123',
                headers: { 'x-slack-token': 'sk-live-123' },
            }));
        });

        fireEvent.click(screen.getByLabelText('Использовать по умолчанию'));
        expect(defaultSpy).toHaveBeenCalledWith('slack');
    });
});
