import React from 'react';
import MessageInput from './MessageInput';
import { Gif, MatrixClient, MatrixUser, Message, Sticker } from '../types';

interface MessageComposerProps {
    onSendMessage: (content: string, threadRootId?: string) => Promise<void> | void;
    onSendFile: (file: File) => Promise<void> | void;
    onSendAudio: (file: Blob, duration: number) => Promise<void> | void;
    onSendSticker: (sticker: Sticker) => Promise<void> | void;
    onSendGif: (gif: Gif) => Promise<void> | void;
    onOpenCreatePoll: () => void;
    onSchedule: (content: string) => void;
    isSending: boolean;
    client: MatrixClient;
    roomId: string | null;
    replyingTo: Message | null;
    onCancelReply: () => void;
    roomMembers: MatrixUser[];
    draftContent: string;
    onDraftChange: (content: string) => void;
    isOffline: boolean;
}

const MessageComposer: React.FC<MessageComposerProps> = ({
    onSendMessage,
    onSendFile,
    onSendAudio,
    onSendSticker,
    onSendGif,
    onOpenCreatePoll,
    onSchedule,
    isSending,
    client,
    roomId,
    replyingTo,
    onCancelReply,
    roomMembers,
    draftContent,
    onDraftChange,
    isOffline,
}) => {
    return (
        <div className="border-t border-border-secondary bg-bg-primary">
            {isOffline && (
                <div className="px-4 py-2 text-xs text-text-inverted bg-status-offline flex items-center gap-2">
                    <span role="img" aria-label="offline">⚠️</span>
                    You are offline. Messages will be sent when connection is restored.
                </div>
            )}
            <MessageInput
                onSendMessage={content => onSendMessage(content)}
                onSendFile={onSendFile}
                onSendAudio={onSendAudio}
                onSendSticker={onSendSticker}
                onSendGif={onSendGif}
                onOpenCreatePoll={onOpenCreatePoll}
                onSchedule={onSchedule}
                isSending={isSending}
                client={client}
                roomId={roomId}
                replyingTo={replyingTo}
                onCancelReply={onCancelReply}
                roomMembers={roomMembers}
                draftContent={draftContent}
                onDraftChange={onDraftChange}
            />
        </div>
    );
};

export default MessageComposer;
