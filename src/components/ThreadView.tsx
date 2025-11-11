import React, { useRef, useEffect, useMemo, useState } from 'react';
import { ActiveThread, MatrixClient, MatrixRoom, MatrixUser } from '@matrix-messenger/core';
import type { SendKeyBehavior } from '../types';
import ChatMessage from './ChatMessage';
import MessageInput from './MessageInput';
import KnowledgeDocModal from './KnowledgeBase/KnowledgeDocModal';
import type { KnowledgeDocDraft } from '../services/knowledgeBaseService';

interface ThreadViewProps {
    room: MatrixRoom;
    activeThread: ActiveThread;
    onClose: () => void;
    client: MatrixClient;
    onSendMessage: (content: { body: string; formattedBody?: string }, threadRootId?: string) => Promise<void>;
    onImageClick: (url: string) => void;
    sendKeyBehavior: SendKeyBehavior;
}

const ThreadView: React.FC<ThreadViewProps> = ({ room, activeThread, onClose, client, onSendMessage, onImageClick, sendKeyBehavior }) => {
    const scrollContainerRef = useRef<HTMLDivElement>(null);
    const [isKnowledgeModalOpen, setKnowledgeModalOpen] = useState(false);

    useEffect(() => {
        scrollContainerRef.current?.scrollTo({
            top: scrollContainerRef.current.scrollHeight,
            behavior: 'smooth',
        });
    }, [activeThread.threadMessages]);
    
    const handleSendMessageInThread = async (content: { body: string; formattedBody?: string }) => {
        await onSendMessage(content, activeThread.rootMessage.id);
    };

    // FIX: Get room members to pass to MessageInput for mentions.
    const roomMembers = room.getJoinedMembers().map(m => m.user).filter((u): u is MatrixUser => !!u);

    const threadMessages = useMemo(() => [activeThread.rootMessage, ...activeThread.threadMessages], [activeThread]);

    const knowledgeDraft = useMemo<KnowledgeDocDraft>(() => {
        const combinedBody = threadMessages
            .map(message => {
                const text = message.content.body?.trim();
                if (!text) {
                    return null;
                }
                return `${message.sender.name}: ${text}`;
            })
            .filter((value): value is string => Boolean(value))
            .join('\n\n');

        const titleSource = activeThread.rootMessage.content.body?.trim() || activeThread.rootMessage.sender.name;
        return {
            title: titleSource.split('\n')[0]?.slice(0, 140) || 'Новая статья из треда',
            body: combinedBody,
            summary: combinedBody.slice(0, 280),
            tags: ['thread'],
            spaceId: null,
            channelId: room.roomId,
            sources: threadMessages.map(message => ({
                roomId: room.roomId,
                eventId: message.id,
                senderId: message.sender.id,
            })),
        };
    }, [activeThread, room]);

    return (
        <>
            <aside className="w-1/3 min-w-[400px] bg-gray-900 flex flex-col border-l border-gray-700">
            <header className="flex items-center p-3 border-b border-gray-700">
                <div className="flex-1">
                    <h2 className="font-bold">Thread</h2>
                    <p className="text-xs text-gray-400">In {room.name}</p>
                </div>
                <button
                    onClick={() => setKnowledgeModalOpen(true)}
                    className="mr-2 rounded-full p-2 text-gray-300 hover:bg-gray-800"
                    title="Опубликовать как статью"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
                        <path d="M3 4a2 2 0 012-2h7a1 1 0 01.707.293l3 3A1 1 0 0116 6v10a2 2 0 01-2 2H5a2 2 0 01-2-2V4z" />
                        <path d="M9 8a1 1 0 011-1h4a1 1 0 011 1v5.5a.5.5 0 01-.723.447L12 12.618l-2.277 1.329A.5.5 0 019 13.5V8z" />
                    </svg>
                </button>
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
                onSendFile={() => { /* Not implemented for threads yet */ }}
                onSendAudio={() => { /* Not implemented for threads yet */ }}
                // FIX: The 'MessageInput' component requires 'onSendSticker' and 'onSendGif' props.
                // Adding placeholder functions as this feature is not yet implemented for threads.
                onSendSticker={() => { /* Not implemented for threads yet */ }}
                onSendGif={() => { /* Not implemented for threads yet */ }}
                onSendLocation={() => { /* Not implemented for threads yet */ }}
                onOpenCreatePoll={() => { /* Not implemented for threads yet */}}
                // FIX: Add missing 'onSchedule' prop to satisfy the MessageInputProps interface.
                onSchedule={() => { /* Not implemented for threads yet */}}
                isSending={false} // This needs more state management if we want fine-grained control
                client={client}
                roomId={room.roomId}
                replyingTo={null}
                onCancelReply={() => {}}
                roomMembers={roomMembers}
                draftContent={null}
                onDraftChange={() => {}}
                sendKeyBehavior={sendKeyBehavior}
            />
            </aside>
            {isKnowledgeModalOpen && (
                <KnowledgeDocModal
                    isOpen={isKnowledgeModalOpen}
                    onClose={() => setKnowledgeModalOpen(false)}
                    client={client}
                    initialDraft={knowledgeDraft}
                />
            )}
        </>
    );
};

export default ThreadView;