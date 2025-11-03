import React, { useRef, useEffect, useCallback } from 'react';
import { ActiveThread, MatrixClient, MatrixRoom, MatrixUser, Sticker, Gif } from '../types';
import ChatMessage from './ChatMessage';
import MessageInput from './MessageInput';

interface ThreadViewProps {
    room: MatrixRoom;
    activeThread: ActiveThread;
    onClose: () => void;
    client: MatrixClient;
    onSendMessage: (content: string, threadRootId?: string) => Promise<void>;
    onImageClick: (url: string) => void;
    onSendFile: (file: File, threadRootId: string) => Promise<void>;
    onSendAudio: (file: Blob, duration: number, threadRootId: string) => Promise<void>;
    onSendSticker: (sticker: Sticker, threadRootId: string) => Promise<void>;
    onSendGif: (gif: Gif, threadRootId: string) => Promise<void>;
    onOpenCreatePoll: (threadRootId: string) => void;
    onSchedule: (content: string, threadRootId: string) => void;
}

const ThreadView: React.FC<ThreadViewProps> = ({
    room,
    activeThread,
    onClose,
    client,
    onSendMessage,
    onImageClick,
    onSendFile,
    onSendAudio,
    onSendSticker,
    onSendGif,
    onOpenCreatePoll,
    onSchedule,
}) => {
    const scrollContainerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        scrollContainerRef.current?.scrollTo({
            top: scrollContainerRef.current.scrollHeight,
            behavior: 'smooth',
        });
    }, [activeThread.threadMessages]);

    const handleSendMessageInThread = async (content: string) => {
        await onSendMessage(content, activeThread.rootMessage.id);
    };

    const handleSendFileInThread = useCallback(
        (file: File) => onSendFile(file, activeThread.rootMessage.id),
        [onSendFile, activeThread.rootMessage.id]
    );

    const handleSendAudioInThread = useCallback(
        (file: Blob, duration: number) => onSendAudio(file, duration, activeThread.rootMessage.id),
        [onSendAudio, activeThread.rootMessage.id]
    );

    const handleSendStickerInThread = useCallback(
        (sticker: Sticker) => onSendSticker(sticker, activeThread.rootMessage.id),
        [onSendSticker, activeThread.rootMessage.id]
    );

    const handleSendGifInThread = useCallback(
        (gif: Gif) => onSendGif(gif, activeThread.rootMessage.id),
        [onSendGif, activeThread.rootMessage.id]
    );

    const handleOpenCreatePollInThread = useCallback(
        () => onOpenCreatePoll(activeThread.rootMessage.id),
        [onOpenCreatePoll, activeThread.rootMessage.id]
    );

    const handleScheduleInThread = useCallback(
        (content: string) => onSchedule(content, activeThread.rootMessage.id),
        [onSchedule, activeThread.rootMessage.id]
    );

    // FIX: Get room members to pass to MessageInput for mentions.
    const roomMembers = room.getJoinedMembers().map(m => m.user).filter((u): u is MatrixUser => !!u);

    return (
        <aside className="w-1/3 min-w-[400px] bg-gray-900 flex flex-col border-l border-gray-700">
            <header className="flex items-center p-3 border-b border-gray-700">
                <div className="flex-1">
                    <h2 className="font-bold">Thread</h2>
                    <p className="text-xs text-gray-400">In {room.name}</p>
                </div>
                <button onClick={onClose} className="p-2 rounded-full hover:bg-gray-800">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                </button>
            </header>
            
            <div ref={scrollContainerRef} className="flex-1 overflow-y-auto p-4 space-y-4">
                {/* Render root message */}
                <ChatMessage
                    message={activeThread.rootMessage}
                    client={client}
                    onReaction={() => {}}
                    onEdit={() => {}}
                    onDelete={() => {}}
                    onSetReplyTo={() => {}}
                    onForward={() => {}}
                    onImageClick={onImageClick}
                    onOpenThread={() => {}}
                    onPollVote={() => {}}
                    // FIX: Add missing props for pinning. Threads don't support pinning.
                    isPinned={false}
                    canPin={false}
                    onPinToggle={() => {}}
                    // FIX: Add missing required prop `onTranslateMessage`. Translation is not implemented in threads, so a no-op function is provided.
                    onTranslateMessage={() => {}}
                />
                <hr className="border-gray-700" />
                
                {/* Render thread replies */}
                {activeThread.threadMessages.map(msg => (
                    <ChatMessage
                        key={msg.id}
                        message={msg}
                        client={client}
                        onReaction={() => {}}
                        onEdit={() => {}}
                        onDelete={() => {}}
                        onSetReplyTo={() => {}}
                        onForward={() => {}}
                        onImageClick={onImageClick}
                        onOpenThread={() => {}}
                        onPollVote={() => {}}
                        // FIX: Add missing props for pinning. Threads don't support pinning.
                        isPinned={false}
                        canPin={false}
                        onPinToggle={() => {}}
                        // FIX: Add missing required prop `onTranslateMessage`. Translation is not implemented in threads, so a no-op function is provided.
                        onTranslateMessage={() => {}}
                    />
                ))}
            </div>

            <MessageInput
                onSendMessage={handleSendMessageInThread}
                onSendFile={handleSendFileInThread}
                onSendAudio={handleSendAudioInThread}
                onSendSticker={handleSendStickerInThread}
                onSendGif={handleSendGifInThread}
                onOpenCreatePoll={handleOpenCreatePollInThread}
                onSchedule={handleScheduleInThread}
                isSending={false} // This needs more state management if we want fine-grained control
                client={client}
                roomId={room.roomId}
                replyingTo={null}
                onCancelReply={() => {}}
                roomMembers={roomMembers}
            />
        </aside>
    );
};

export default ThreadView;