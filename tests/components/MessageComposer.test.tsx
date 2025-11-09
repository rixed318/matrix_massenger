import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import MessageComposer from '../../src/components/MessageComposer';
import { MatrixClient } from '../../src/types';

const mockSendMessage = vi.fn();

const mockInput = vi.fn((props: any) => (
    <button onClick={() => props.onSendMessage('hello')} data-testid="mock-input">
        send
    </button>
));

vi.mock('../../src/components/MessageInput', () => ({
    __esModule: true,
    default: (props: any) => mockInput(props),
}));

const clientStub = {
    getUserId: () => '@user:server',
} as MatrixClient;

describe('MessageComposer', () => {
    beforeEach(() => {
        mockSendMessage.mockReset();
        mockInput.mockClear();
    });

    it('renders offline notice when offline', () => {
        render(
            <MessageComposer
                onSendMessage={mockSendMessage}
                onSendFile={vi.fn()}
                onSendAudio={vi.fn()}
                onSendSticker={vi.fn()}
                onSendGif={vi.fn()}
                onOpenCreatePoll={vi.fn()}
                onSchedule={vi.fn()}
                isSending={false}
                client={clientStub}
                roomId="room-1"
                replyingTo={null}
                onCancelReply={vi.fn()}
                roomMembers={[]}
                draftContent=""
                onDraftChange={vi.fn()}
                isOffline
            />
        );

        expect(screen.getByText(/You are offline/i)).toBeTruthy();
        fireEvent.click(screen.getByTestId('mock-input'));
        expect(mockSendMessage).toHaveBeenCalledWith('hello');
    });
});
