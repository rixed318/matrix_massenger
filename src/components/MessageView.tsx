import React from 'react';
import { Message, Reaction, MatrixClient } from '../types';
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
}

const MessageView: React.FC<MessageViewProps> = ({ 
    messages, client, onReaction, onEditMessage, onDeleteMessage, 
    onSetReplyTo, onForwardMessage, onImageClick, onOpenThread, onPollVote,
    onTranslateMessage, translatedMessages,
    scrollContainerRef, onScroll, onPaginate, isPaginating, canPaginate,
    pinnedEventIds, canPin, onPinToggle
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
                />
            ))}
        </div>
    );
};

export default MessageView;