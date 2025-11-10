import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import CallView from '../../src/components/CallView';

vi.mock('../../src/components/CallParticipantsPanel', () => ({
    __esModule: true,
    default: () => <div data-testid="participants-panel" />,
}));

const mockUpdateLocalCallDeviceState = vi.fn();

vi.mock('@matrix-messenger/core', () => ({
    __esModule: true,
    mxcToHttp: () => null,
    updateLocalCallDeviceState: (...args: unknown[]) => mockUpdateLocalCallDeviceState(...args),
}));

describe('CallView handover banner', () => {
    it('renders handover controls when call is active on another device', () => {
        const onHandover = vi.fn();
        const callSession = {
            sessionId: 'session-1',
            roomId: '!room:test',
            callId: 'call-1',
            status: 'connected',
            activeDeviceId: 'device-laptop',
            updatedAt: Date.now(),
            startedAt: Date.now() - 1_000,
            devices: [
                {
                    userId: '@alice:test',
                    deviceId: 'device-laptop',
                    label: 'Ноутбук',
                    muted: false,
                    connected: true,
                    isRemote: false,
                    lastSeenTs: Date.now(),
                },
                {
                    userId: '@alice:test',
                    deviceId: 'device-phone',
                    label: 'Телефон',
                    muted: true,
                    connected: false,
                    isRemote: false,
                    lastSeenTs: Date.now(),
                },
                {
                    userId: '@bob:test',
                    deviceId: 'remote:@bob:test',
                    label: 'Боб',
                    muted: false,
                    connected: true,
                    isRemote: true,
                    lastSeenTs: Date.now(),
                },
            ],
        } as any;

        render(
            <CallView
                call={null}
                onHangup={() => undefined}
                client={{ getUserId: () => '@alice:test', getDeviceId: () => 'device-phone' } as any}
                callSession={callSession}
                onHandover={onHandover}
                localDeviceId="device-phone"
            />,
        );

        expect(screen.getByText('Звонок активен на другом устройстве')).toBeInTheDocument();
        expect(screen.getByText('Вторичные устройства: Телефон, Боб')).toBeInTheDocument();
        expect(screen.getByText('Микрофон этого устройства отключён')).toBeInTheDocument();

        const button = screen.getByRole('button', { name: 'Подхватить на этом устройстве' });
        fireEvent.click(button);
        expect(onHandover).toHaveBeenCalledTimes(1);
    });
});

