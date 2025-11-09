import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import ChatHeader from '../../src/components/ChatHeader';
import { Message, Room } from '../../src/types';

vi.mock('../../src/components/PinnedMessageBar', () => ({
    default: ({ onUnpin }: { onUnpin: () => void }) => (
        <button data-testid="mock-pinned" onClick={onUnpin}>
            pinned
        </button>
    ),
}));

const createRoom = (overrides: Partial<Room> = {}): Room => ({
    roomId: 'room-1',
    name: 'General',
    avatarUrl: null,
    lastMessage: null,
    unreadCount: 0,
    pinnedEvents: [],
    isEncrypted: true,
    isDirectMessageRoom: true,
    roomType: 'direct',
    status: 'joined',
    lastMessagePreview: null,
    lastMessageAt: null,
    notificationMode: 'all',
    ...overrides,
});

const message: Message = {
    id: 'event1',
    sender: { id: '@user:server', name: 'User', avatarUrl: null },
    content: { body: 'Pinned', msgtype: 'm.text' },
    timestamp: Date.now(),
    isOwn: true,
    reactions: null,
    isEdited: false,
    isRedacted: false,
    replyTo: null,
    readBy: {},
    threadReplyCount: 0,
};

describe('ChatHeader', () => {
    it('shows room badges and offline status', () => {
        const onOpenInvite = vi.fn();
        render(
            <ChatHeader
                room={createRoom({ status: 'invited', roomType: 'group' })}
                typingUsers={[ 'Alex' ]}
                canInvite
                onOpenInvite={onOpenInvite}
                pinnedMessage={message}
                onPinToggle={vi.fn()}
                scheduledMessageCount={2}
                onOpenViewScheduled={vi.fn()}
                isDirectMessageRoom={false}
                onPlaceCall={vi.fn()}
                onOpenSearch={vi.fn()}
                connectionStatus="offline"
            />
        );

        expect(screen.getByText('General')).toBeTruthy();
        expect(screen.getByText('Group chat')).toBeTruthy();
        expect(screen.getByText('Invitation')).toBeTruthy();
        expect(screen.getByText('offline')).toBeTruthy();
        fireEvent.click(screen.getByTestId('mock-pinned'));
    });

    it('opens call menu for direct rooms', () => {
        const onPlaceCall = vi.fn();
        render(
            <ChatHeader
                room={createRoom()}
                canInvite={false}
                onOpenInvite={vi.fn()}
                pinnedMessage={null}
                onPinToggle={vi.fn()}
                scheduledMessageCount={0}
                onOpenViewScheduled={vi.fn()}
                isDirectMessageRoom
                onPlaceCall={onPlaceCall}
                onOpenSearch={vi.fn()}
                typingUsers={[]}
                connectionStatus="online"
                onNotificationModeChange={vi.fn()}
                onMuteRoom={vi.fn()}
            />
        );

        fireEvent.click(screen.getByTitle('Start a call'));
        fireEvent.click(screen.getByText(/Voice call/i));
        expect(onPlaceCall).toHaveBeenCalledWith('voice');
    });

    it('allows switching notification modes from the notifications menu', () => {
        const onNotificationModeChange = vi.fn();
        const onMuteRoom = vi.fn();
        render(
            <ChatHeader
                room={createRoom({ notificationMode: 'mentions' })}
                canInvite
                onOpenInvite={vi.fn()}
                pinnedMessage={null}
                onPinToggle={vi.fn()}
                scheduledMessageCount={0}
                onOpenViewScheduled={vi.fn()}
                isDirectMessageRoom
                onPlaceCall={vi.fn()}
                onOpenSearch={vi.fn()}
                typingUsers={[]}
                connectionStatus="online"
                notificationMode="mentions"
                onNotificationModeChange={onNotificationModeChange}
                onMuteRoom={onMuteRoom}
            />
        );

        fireEvent.click(screen.getByTitle('Notifications'));
        fireEvent.click(screen.getByText(/Enabled/i));
        expect(onNotificationModeChange).toHaveBeenCalledWith('all');

        fireEvent.click(screen.getByTitle('Notifications'));
        fireEvent.click(screen.getByText(/Muted/i));
        expect(onMuteRoom).toHaveBeenCalled();
    });
});
