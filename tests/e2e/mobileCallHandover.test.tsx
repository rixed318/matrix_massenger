import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { CallScreen } from '../../mobile/src/screens/CallScreen';

const goBack = vi.fn();

vi.mock('react-native', async () => {
    const React = await import('react');
    const createPrimitive = (tag: string) =>
        React.forwardRef(({ children, onPress, style, ...rest }: any, ref) =>
            React.createElement(
                tag,
                {
                    ...rest,
                    ref,
                    style,
                    onClick: onPress ?? rest.onClick,
                },
                children,
            ),
        );

    return {
        __esModule: true,
        ActivityIndicator: createPrimitive('div'),
        SafeAreaView: createPrimitive('div'),
        StyleSheet: { create: (styles: any) => styles },
        Text: createPrimitive('span'),
        TouchableOpacity: createPrimitive('button'),
        View: createPrimitive('div'),
    };
});

class MockMediaStream {
    private tracks = [{ stop: vi.fn() }];

    toURL() {
        return 'mock://stream';
    }

    getTracks() {
        return this.tracks;
    }
}

const getUserMedia = vi.fn(async () => new MockMediaStream() as any);

vi.mock('react-native-webrtc', () => ({
    __esModule: true,
    mediaDevices: { getUserMedia },
    MediaStream: MockMediaStream,
    RTCView: ({ children }: any) => <div data-testid="rtc-view">{children}</div>,
}));

vi.mock('@react-navigation/native', () => ({
    __esModule: true,
    useNavigation: () => ({ goBack }),
}));

vi.mock('@react-navigation/native-stack', () => ({ __esModule: true }));

const mockSetCallSessionForClient = vi.fn();
const mockBuildCallSessionSnapshot = vi.fn(() => ({
    sessionId: 'session-generated',
    roomId: '!room:test',
    callId: 'call-generated',
    status: 'connecting',
    activeDeviceId: 'device-phone',
    updatedAt: Date.now(),
    startedAt: Date.now(),
    devices: [],
}));
const mockSubscribeCallState = vi.fn();
const mockHandoverCallToCurrentDevice = vi.fn(async () => undefined);
const mockUpdateLocalCallDeviceState = vi.fn();

const mockCallSession = {
    sessionId: 'session-1',
    roomId: '!room:test',
    callId: 'call-1',
    status: 'connected',
    activeDeviceId: 'device-laptop',
    updatedAt: Date.now(),
    startedAt: Date.now() - 5000,
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
};

vi.mock('@matrix-messenger/core', () => ({
    __esModule: true,
    buildCallSessionSnapshot: (...args: unknown[]) => mockBuildCallSessionSnapshot(...args),
    CallSessionState: {} as unknown,
    handoverCallToCurrentDevice: (...args: unknown[]) => mockHandoverCallToCurrentDevice(...args),
    setCallSessionForClient: (...args: unknown[]) => mockSetCallSessionForClient(...args),
    subscribeCallState: (accountKey: string, listener: (state: any) => void) => {
        mockSubscribeCallState(accountKey, listener);
        listener(mockCallSession);
        return () => undefined;
    },
    updateLocalCallDeviceState: (...args: unknown[]) => mockUpdateLocalCallDeviceState(...args),
}));

describe('Mobile CallScreen handover experience', () => {
    it('shows handover banner and calls APIs when triggered', async () => {
        const listeners: Record<string, Function> = {};
        const matrixCall = {
            roomId: '!room:test',
            callId: 'call-1',
            on: vi.fn((event: string, handler: Function) => {
                listeners[event] = handler;
            }),
            placeVideoCall: vi.fn(),
            setMicrophoneMuted: vi.fn(),
            isMicrophoneMuted: vi.fn(() => false),
            hangup: vi.fn(),
        };

        const session = {
            client: {
                getDeviceId: () => 'device-phone',
                getUserId: () => '@alice:test',
                createCall: vi.fn(() => matrixCall),
            },
            account: {
                homeserver_url: 'https://matrix.test/',
                user_id: '@alice:test',
            },
        } as any;

        render(
            <CallScreen
                session={session}
                route={{ key: 'Call', name: 'Call', params: { roomId: '!room:test' } } as any}
            />,
        );

        await waitFor(() => expect(getUserMedia).toHaveBeenCalled());

        await waitFor(() => expect(screen.getByText('Звонок активен на другом устройстве')).toBeInTheDocument());
        expect(screen.getByText('Вторичные устройства: Телефон, Боб')).toBeInTheDocument();
        expect(screen.getByText('Микрофон этого устройства отключён')).toBeInTheDocument();

        expect(matrixCall.setMicrophoneMuted).toHaveBeenCalledWith(true);
        expect(mockUpdateLocalCallDeviceState).toHaveBeenCalledWith(session.client, { muted: true, connected: false });

        const button = screen.getByRole('button', { name: 'Подхватить на этом устройстве' });
        fireEvent.click(button);
        expect(mockHandoverCallToCurrentDevice).toHaveBeenCalledWith(session.client, mockCallSession);

        await waitFor(() => expect(mockHandoverCallToCurrentDevice).toHaveBeenCalledTimes(1));
    });
});

