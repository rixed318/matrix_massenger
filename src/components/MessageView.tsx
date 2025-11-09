import React from 'react';
import { Message, Reaction, MatrixClient } from '@matrix-messenger/core';
import ChatMessage from './ChatMessage';

interface MessageViewProps {
    messages: Message[];
    client: MatrixClient;
    onReaction: (messageId: string, emoji: string, reaction?: Reaction) => void;
    onEditMessage: (messageId: string, newContent: string) => void;
    onDeleteMessage: (messageId: string) => void;
    onSetReplyTo: (message: Message) => void;
    onForwardMessage: (message: Message) => void;
    onImageClick: (url: string) => void;
    onOpenThread: (message: Message) => void;
    onPollVote: (messageId: string, optionId: string) => void;
    onTranslateMessage: (messageId: string, text: string) => void;
    translatedMessages: Record<string, { text: string; isLoading: boolean }>;
    scrollContainerRef: React.RefObject<HTMLDivElement>;
    onScroll: () => void;
    onPaginate: () => void;
    isPaginating: boolean;
    canPaginate: boolean;
    pinnedEventIds: string[];
    canPin: boolean;
    onPinToggle: (messageId: string) => void;
    highlightedMessageId?: string | null;
}


const TTLCountdown: React.FC<{ message: Message }> = ({ message }) => {
    const [now, setNow] = React.useState(Date.now());
    // Attempt to read TTL from message content
    const content: any = (message as any).content || {};
    const relates = content['m.relates_to'];
    let ttlMs: number | null = null;
    if (relates) {
        if (relates.rel_type === 'org.econix.ttl' && Number.isFinite(relates.ttl_ms)) {
            ttlMs = Number(relates.ttl_ms);
        } else if (relates.rel_type === 'm.annotation' && (relates.key === 'org.econix.ttl' || relates.key === 'econix.ttl') && Number.isFinite(relates.ttl_ms)) {
            ttlMs = Number(relates.ttl_ms);
        }
    }
    if (!ttlMs && Number.isFinite((content as any)['org.econix.ttl_ms'])) {
        ttlMs = Number((content as any)['org.econix.ttl_ms']);
    }
    const ts = (message as any).timestamp ?? (message as any).ts ?? (message as any).origin_server_ts ?? Date.now();
    const expiresAt = ttlMs ? ts + ttlMs : null;
    const remaining = expiresAt ? Math.max(0, expiresAt - now) : null;

    React.useEffect(() => {
        if (!expiresAt) return;
        const id = window.setInterval(() => setNow(Date.now()), 1000);
        return () => window.clearInterval(id);
    }, [expiresAt]);

    if (!remaining) return null;
    const seconds = Math.ceil(remaining / 1000);
    const format = () => {
        if (seconds < 60) return `${seconds}с`;
        const m = Math.floor(seconds / 60);
        const s = seconds % 60;
        if (m < 60) return `${m}м ${s}с`;
        const h = Math.floor(m / 60);
        const mm = m % 60;
        return `${h}ч ${mm}м`;
    };
    return (
        <div className="mt-1 text-[10px] text-text-secondary select-none">
            ⏳ Исчезнет через {format()}
        </div>
    );
};


const MessageView: React.FC<MessageViewProps> = ({
    messages, client, onReaction, onEditMessage, onDeleteMessage,
    onSetReplyTo, onForwardMessage, onImageClick, onOpenThread, onPollVote,
    onTranslateMessage, translatedMessages,
    scrollContainerRef, onScroll, onPaginate, isPaginating, canPaginate,
    pinnedEventIds, canPin, onPinToggle, highlightedMessageId
}) => {
    
    const handleScroll = () => {
        onScroll();
        const container = scrollContainerRef.current;
        if (container && container.scrollTop === 0 && !isPaginating && canPaginate) {
            onPaginate();
        }
    };

    return (
        <div ref={scrollContainerRef} onScroll={handleScroll} className="flex-1 overflow-y-auto p-4 space-y-4">
            {isPaginating && (
                <div className="flex justify-center items-center p-4">
                    <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-blue-500"></div>
                </div>
            )}
            {!canPaginate && !isPaginating && (
                 <div className="text-center text-text-secondary text-sm p-4">
                    Beginning of conversation history
                </div>
            )}
            {messages.map((msg) => (
                <div>
                <ChatMessage
                    key={msg.id}
                    message={msg}
                    client={client}
                    onReaction={(emoji, reaction) => onReaction(msg.id, emoji, reaction)}
                    onEdit={onEditMessage}
                    onDelete={() => onDeleteMessage(msg.id)}
                    onSetReplyTo={() => onSetReplyTo(msg)}
                    onForward={() => onForwardMessage(msg)}
                    onImageClick={onImageClick}
                    onOpenThread={() => onOpenThread(msg)}
                    onPollVote={(optionId) => onPollVote(msg.id, optionId)}
                    isPinned={pinnedEventIds.includes(msg.id)}
                    canPin={canPin}
                    onPinToggle={() => onPinToggle(msg.id)}
                    onTranslateMessage={onTranslateMessage}
                    translatedMessage={translatedMessages[msg.id]}
                    isHighlighted={highlightedMessageId === msg.id}
                />
                <TTLCountdown message={msg} />
                </div>
            ))}
        </div>
    );
};

export default MessageView;