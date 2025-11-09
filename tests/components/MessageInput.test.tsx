import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import MessageInput from '../../src/components/MessageInput';
import type { MatrixClient, Message } from '../../src/types';

vi.mock('@matrix-messenger/core', () => ({
    sendTypingIndicator: vi.fn(),
    getRoomTTL: vi.fn(() => Promise.resolve(null)),
    setRoomTTL: vi.fn(() => Promise.resolve()),
    setNextMessageTTL: vi.fn(),
}));

vi.mock('../../src/components/MentionSuggestions', () => ({
    __esModule: true,
    default: () => null,
}));

vi.mock('../../src/components/StickerGifPicker', () => ({
    __esModule: true,
    default: () => null,
}));

const clientStub = {
    getUserId: () => '@user:example',
    getUser: () => ({ displayName: 'Tester', avatarUrl: null }),
    getRoom: () => undefined,
} as unknown as MatrixClient;

const baseProps = {
    onSendMessage: vi.fn(() => Promise.resolve()),
    onSendFile: vi.fn(),
    onSendAudio: vi.fn(),
    onSendSticker: vi.fn(),
    onSendGif: vi.fn(),
    onOpenCreatePoll: vi.fn(),
    onSchedule: vi.fn(),
    isSending: false,
    client: clientStub,
    roomId: 'room-1',
    replyingTo: null as Message | null,
    onCancelReply: vi.fn(),
    roomMembers: [],
    draftContent: null,
    onDraftChange: vi.fn(),
    sendKeyBehavior: 'enter' as const,
};

describe('MessageInput', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('supports multi-line input with Shift+Enter without sending', () => {
        render(<MessageInput {...baseProps} />);
        const textarea = screen.getByPlaceholderText('Type a message...') as HTMLTextAreaElement;

        fireEvent.change(textarea, { target: { value: 'Hello' } });
        fireEvent.keyDown(textarea, { key: 'Enter', code: 'Enter', shiftKey: true });
        fireEvent.change(textarea, { target: { value: 'Hello\n' } });

        expect(baseProps.onSendMessage).not.toHaveBeenCalled();
        expect(textarea.value).toBe('Hello\n');
    });

    it('toggles preview and renders formatted markdown', () => {
        const { container } = render(<MessageInput {...baseProps} />);
        const textarea = screen.getByPlaceholderText('Type a message...');

        fireEvent.change(textarea, { target: { value: '**bold** text' } });
        fireEvent.click(screen.getByRole('button', { name: /preview/i }));

        const strong = container.querySelector('strong');
        expect(strong).toBeTruthy();
        expect(strong?.textContent).toBe('bold');
    });

    it('sends message on Enter and clears draft', async () => {
        const onSendMessage = vi.fn(() => Promise.resolve());
        render(<MessageInput {...baseProps} onSendMessage={onSendMessage} />);
        const textarea = screen.getByPlaceholderText('Type a message...');

        fireEvent.change(textarea, { target: { value: 'Hello world' } });
        fireEvent.keyDown(textarea, { key: 'Enter', code: 'Enter' });

        await waitFor(() => expect(onSendMessage).toHaveBeenCalled());
        const payload = onSendMessage.mock.calls[0][0];
        expect(payload.body).toBe('Hello world');
        expect(payload.formattedBody).toContain('Hello world');
        expect(textarea).toHaveValue('');
    });

    it('calls cancel reply when Escape is pressed', () => {
        const onCancelReply = vi.fn();
        const reply: Message = {
            id: 'msg1',
            sender: { id: 'user', name: 'User', avatarUrl: null },
            content: { body: 'hello', msgtype: 'm.text' },
            timestamp: Date.now(),
            isOwn: false,
            reactions: null,
            isEdited: false,
            isRedacted: false,
            replyTo: null,
            readBy: {},
            threadReplyCount: 0,
        } as unknown as Message;

        render(<MessageInput {...baseProps} replyingTo={reply} onCancelReply={onCancelReply} />);
        const textarea = screen.getByPlaceholderText('Type a message...');
        fireEvent.keyDown(textarea, { key: 'Escape', code: 'Escape' });

        expect(onCancelReply).toHaveBeenCalled();
    });
});
