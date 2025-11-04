import React, { useState, useRef, useEffect } from 'react';
import { Message, Reaction, MatrixClient } from '../types';
import Avatar from './Avatar';
import { format } from 'date-fns';
import ReactionPicker from './ReactionPicker';
import ReactionsDisplay from './ReactionsDisplay';
import ReplyQuote from './ReplyQuote';
import { mxcToHttp } from '../services/matrixService';
import VoiceMessagePlayer from './VoiceMessagePlayer';
import PollView from './PollView';
import { EventType } from 'matrix-js-sdk';
import LinkPreview from './LinkPreview';

interface ChatMessageProps {
    message: Message;
    client: MatrixClient;
    onReaction: (emoji: string, reaction?: Reaction) => void;
    onEdit: (messageId: string, newContent: string) => void;
    onDelete: () => void;
    onSetReplyTo: () => void;
    onForward: () => void;
    onImageClick: (url: string) => void;
    onOpenThread: () => void;
    onPollVote: (optionId: string) => void;
    isPinned: boolean;
    canPin: boolean;
    onPinToggle: () => void;
    onTranslateMessage: (messageId: string, text: string) => void;
    translatedMessage?: { text: string; isLoading: boolean; };
    isHighlighted?: boolean;
}

const ChatMessage: React.FC<ChatMessageProps> = ({
    message, client, onReaction, onEdit, onDelete, onSetReplyTo, onForward, onImageClick, onOpenThread, onPollVote,
    isPinned, canPin, onPinToggle, onTranslateMessage, translatedMessage, isHighlighted
}) => {
    const [isPickerOpen, setPickerOpen] = useState(false);
    const [isEditing, setIsEditing] = useState(false);
    const [editedContent, setEditedContent] = useState(message.content.body);
    const editInputRef = useRef<HTMLInputElement>(null);
    const isOwn = message.isOwn;
    const isReadByOthers = isOwn && Object.keys(message.readBy).some(userId => userId !== client.getUserId());

    useEffect(() => {
        if (isEditing) {
            editInputRef.current?.focus();
            editInputRef.current?.select();
        }
    }, [isEditing]);
    
    useEffect(() => {
        setEditedContent(message.content.body);
    }, [message.content.body]);

    const handleSelectEmoji = (emoji: string) => {
        onReaction(emoji, message.reactions?.[emoji]);
        setPickerOpen(false);
    };

    const handleSaveEdit = () => {
        if (editedContent.trim() && editedContent.trim() !== message.content.body) {
            onEdit(message.id, editedContent);
        }
        setIsEditing(false);
    };
    
    const handleCancelEdit = () => {
        setEditedContent(message.content.body);
        setIsEditing(false);
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') handleSaveEdit();
        else if (e.key === 'Escape') handleCancelEdit();
    };

    const formatFileSize = (bytes: number): string => {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    };

    const renderWithMentions = (text: string) => {
        if (message.content.formatted_body) {
            const mentionedUserIds = message.content['m.mentions']?.user_ids || [];
            const isMentioned = mentionedUserIds.includes(client.getUserId()!);
            
            const sanitizedHtml = message.content.formatted_body.replace(/<a href="https:\/\/matrix\.to\/#\/(.+?)">(.+?)<\/a>/g, (match, userId, name) => {
                 const baseStyle = "font-semibold rounded px-1 py-0.5";
                 if (userId === client.getUserId()) {
                     return `<span class="${baseStyle} bg-mention-self-bg text-mention-self-text">${name}</span>`;
                 }
                 return `<span class="${baseStyle} bg-mention-bg text-mention-text">${name}</span>`;
            });

            return <div className={`break-words whitespace-pre-wrap ${isMentioned ? 'bg-yellow-800/20' : ''}`} dangerouslySetInnerHTML={{ __html: sanitizedHtml }} />;
        }
        return <p className="text-text-primary break-words whitespace-pre-wrap">{text}</p>;
    };
    
    const renderMessageBody = () => {
        const eventType = message.rawEvent?.getType();

        if (eventType === EventType.CallInvite) {
            const isVideo = message.rawEvent?.getContent().offer?.sdp?.includes('m=video');
            return (
                <div className="flex items-center gap-2 text-text-secondary italic">
                    {isVideo ? (
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor"><path d="M2 6a2 2 0 012-2h6a2 2 0 012 2v8a2 2 0 01-2 2H4a2 2 0 01-2-2V6zM14.553 7.106A1 1 0 0014 8v4a1 1 0 001.553.832l3-2a1 1 0 000-1.664l-3-2z" /></svg>
                    ) : (
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor"><path d="M2 3a1 1 0 011-1h2.153a1 1 0 01.986.836l.74 4.435a1 1 0 01-.54 1.06l-1.548.773a11.037 11.037 0 006.105 6.105l.774-1.548a1 1 0 011.059-.54l4.435.74a1 1 0 01.836.986V17a1 1 0 01-1 1h-2C7.82 18 2 12.18 2 5V3z" /></svg>
                    )}
                    <span>{message.isOwn ? `You started a ${isVideo ? 'video' : 'voice'} call` : `Incoming ${isVideo ? 'video' : 'voice'} call`}</span>
                </div>
            );
        }

        if (eventType === EventType.CallAnswer) {
            return (
                <div className="flex items-center gap-2 text-text-secondary italic">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                        <path d="M2 3a1 1 0 011-1h2.153a1 1 0 01.986.836l.74 4.435a1 1 0 01-.54 1.06l-1.548.773a11.037 11.037 0 006.105 6.105l.774-1.548a1 1 0 011.059-.54l4.435.74a1 1 0 01.836.986V17a1 1 0 01-1 1h-2C7.82 18 2 12.18 2 5V3z" />
                    </svg>
                    <span>Call started</span>
                </div>
            );
        }

        if (eventType === EventType.CallHangup) {
            return (
                <div className="flex items-center gap-2 text-text-secondary italic">
                     <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 transform -rotate-135" viewBox="0 0 20 20" fill="currentColor">
                        <path d="M2 3a1 1 0 011-1h2.153a1 1 0 01.986.836l.74 4.435a1 1 0 01-.54 1.06l-1.548.773a11.037 11.037 0 006.105 6.105l.774-1.548a1 1 0 011.059-.54l4.435.74a1 1 0 01.836.986V17a1 1 0 01-1 1h-2C7.82 18 2 12.18 2 5V3z" />
                    </svg>
                    <span>Call ended</span>
                </div>
            );
        }
        
        if (message.isRedacted) {
             return <p className="text-text-secondary italic">Message deleted</p>;
        }

        if (message.isSticker) {
            const stickerUrl = mxcToHttp(client, message.content.url);
            return (
                <img 
                    src={stickerUrl || message.content.url} 
                    alt={message.content.body} 
                    className="max-w-[128px] max-h-[128px]" 
                    title={message.content.body}
                />
            );
        }

        if (message.isGif) {
            const imageUrl = mxcToHttp(client, message.content.url);
            return (
                <div className="relative max-w-xs cursor-pointer" onClick={() => imageUrl && onImageClick(imageUrl)}>
                    <img 
                        src={imageUrl!} 
                        alt={message.content.body} 
                        className="rounded-md"
                    />
                </div>
            );
        }

        if (message.poll) {
            return <PollView poll={message.poll} onVote={onPollVote} />;
        }
        
        if (message.isUploading) {
            return (
                 <div className="flex items-center gap-3 p-2 rounded-md bg-black/20">
                    <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-white"></div>
                    <div>
                        <p className="font-semibold">{message.content.body}</p>
                        <p className="text-sm text-text-secondary">Uploading...</p>
                    </div>
                 </div>
            );
        }

        if (message.content.msgtype === 'm.image') {
            const imageUrl = message.localUrl || mxcToHttp(client, message.content.url, 400);
            const fullImageUrl = message.localUrl || mxcToHttp(client, message.content.url, 1200);

            return (
                <div className="relative max-w-xs cursor-pointer" onClick={() => fullImageUrl && onImageClick(fullImageUrl)}>
                    <img src={imageUrl!} alt={message.content.body} className="rounded-md" />
                </div>
            );
        }

        if (message.content.msgtype === 'm.audio') {
            const audioUrl = message.localUrl || mxcToHttp(client, message.content.url);
            const duration = message.content.info?.duration;
            if (!audioUrl) return <p className="text-text-secondary italic">Could not load audio.</p>
            return <VoiceMessagePlayer src={audioUrl} durationMs={duration} />;
        }

        if (message.content.msgtype === 'm.file') {
            const fileUrl = mxcToHttp(client, message.content.url);
            const fileSize = message.content.info?.size;

            return (
                <a href={fileUrl!} target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 p-3 rounded-md bg-bg-secondary/50 hover:bg-bg-secondary/80 transition-colors">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10 text-text-secondary flex-shrink-0" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4zm2 6a1 1 0 011-1h6a1 1 0 110 2H7a1 1 0 01-1-1zm1 3a1 1 0 100 2h6a1 1 0 100-2H7z" clipRule="evenodd" />
                    </svg>
                    <div className="overflow-hidden">
                        <p className="font-semibold truncate">{message.content.body}</p>
                        {fileSize && <p className="text-sm text-text-secondary">{formatFileSize(fileSize)}</p>}
                    </div>
                </a>
            )
        }
        
        return renderWithMentions(message.content.body);
    };

    const renderMessageContent = () => {
        if (isEditing) {
            return (
                <div className="w-full">
                    <input
                        ref={editInputRef}
                        type="text"
                        value={editedContent}
                        onChange={(e) => setEditedContent(e.target.value)}
                        onKeyDown={handleKeyDown}
                        className="w-full bg-bg-secondary text-text-primary p-2 rounded border border-ring-focus focus:outline-none focus:ring-1 focus:ring-ring-focus"
                    />
                    <div className="text-xs mt-2">
                        escape to <button onClick={handleCancelEdit} className="text-text-accent hover:underline">cancel</button>
                        {' '}•{' '}
                        enter to <button onClick={handleSaveEdit} className="text-text-accent hover:underline">save</button>
                    </div>
                </div>
            );
        }
        return (
            <>
                {message.replyTo && !message.threadRootId && <ReplyQuote sender={message.replyTo.sender} body={message.replyTo.body} />}
                {renderMessageBody()}
                {message.linkPreview && <LinkPreview data={message.linkPreview} />}
            </>
        )
    };
    
    const renderTranslation = () => {
        if (!translatedMessage) return null;

        return (
            <div className="mt-2 pt-2 border-t border-white/10">
                {translatedMessage.isLoading ? (
                    <div className="flex items-center gap-2 text-xs text-text-secondary">
                        <div className="animate-spin rounded-full h-3 w-3 border-t-2 border-b-2 border-text-secondary"></div>
                        <span>Translating...</span>
                    </div>
                ) : (
                    <>
                        <p className="text-text-primary italic whitespace-pre-wrap">{translatedMessage.text}</p>
                        <p className="text-xs text-gray-500 mt-1 text-right">Переведено с помощью Gemini</p>
                    </>
                )}
            </div>
        );
    };

    const messageContainerClass = message.isSticker || message.isGif
        ? '' // No padding/bg for stickers/gifs
        : `p-2 rounded-lg max-w-lg ${isOwn ? 'bg-accent text-text-inverted rounded-br-none' : 'bg-bg-primary text-text-primary rounded-bl-none'} ${isPinned ? 'ring-2 ring-yellow-400' : ''} ${isHighlighted ? 'ring-2 ring-accent shadow-lg animate-pulse' : ''}`;


    return (
        <div id={`message-${message.id}`} className={`group flex items-start gap-3 relative ${isOwn ? 'flex-row-reverse' : ''}`}>
            {!isOwn && <Avatar name={message.sender.name} imageUrl={message.sender.avatarUrl} size="sm" />}

            <div className={`absolute top-[-10px] flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity z-10 ${isOwn ? 'left-[-244px]' : 'right-[-216px]'}`}>
                {!isEditing && !message.isRedacted && (
                    <>
                         {message.content.msgtype === 'm.text' && (
                            <button onClick={() => onTranslateMessage(message.id, message.content.body)} className="p-1 rounded-full bg-bg-primary hover:bg-bg-tertiary" title={translatedMessage && !translatedMessage.isLoading ? "Скрыть перевод" : "Перевести"}>
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-text-secondary" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM4.332 8.027a6.012 6.012 0 011.912-2.706C6.512 5.73 6.512 5.73 6.512 5.73s0 .001 0 .001a7.034 7.034 0 001.82.643 7.034 7.034 0 002.288 0A7.034 7.034 0 0012.45 6.37a7.034 7.034 0 001.82-.644s-1.42.38-3.24.38-3.24-.38-3.24-.38zM8.271 14.155c.244.33.42.661.543.991a2.01 2.01 0 01-.22 1.452A6.994 6.994 0 0110 16a6.994 6.994 0 011.406-.402 2.01 2.01 0 01-.22-1.452c.123-.33.299-.661.543-.991a6.002 6.002 0 012.33-2.33 6.012 6.012 0 012.706-1.912 6.012 6.012 0 01-1.912 2.706 6.002 6.002 0 01-2.33 2.33 6.002 6.002 0 01-2.706 1.912 6.002 6.002 0 01-2.706-1.912 6.002 6.002 0 01-2.33-2.33z" clipRule="evenodd" /></svg>
                            </button>
                        )}
                        {isOwn && !message.poll && !message.isSticker && !message.isGif && (
                             <>
                                <button onClick={onDelete} className="p-1 rounded-full bg-bg-primary hover:bg-bg-tertiary" title="Delete message">
                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-text-secondary" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" /></svg>
                                </button>
                                <button onClick={() => setIsEditing(true)} className="p-1 rounded-full bg-bg-primary hover:bg-bg-tertiary" title="Edit message">
                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-text-secondary" viewBox="0 0 20 20" fill="currentColor"><path d="M17.414 2.586a2 2 0 00-2.828 0L7 10.172V13h2.828l7.586-7.586a2 2 0 000-2.828z" /><path fillRule="evenodd" d="M2 6a2 2 0 012-2h4a1 1 0 010 2H4v10h10v-4a1 1 0 112 0v4a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" clipRule="evenodd" /></svg>
                                </button>
                             </>
                        )}
                        <button onClick={onForward} className="p-1 rounded-full bg-bg-primary hover:bg-bg-tertiary" title="Forward message">
                           <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-text-secondary transform scale-x-[-1]" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M7.707 3.293a1 1 0 010 1.414L5.414 7H11a7 7 0 017 7v2a1 1 0 11-2 0v-2a5 5 0 00-5-5H5.414l2.293 2.293a1 1 0 11-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z" clipRule="evenodd" /></svg>
                        </button>
                        <button onClick={onOpenThread} className="p-1 rounded-full bg-bg-primary hover:bg-bg-tertiary" title="Reply in thread">
                           <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-text-secondary" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M18 5v8a2 2 0 01-2 2h-5l-5 4v-4H4a2 2 0 01-2-2V5a2 2 0 012-2h12a2 2 0 012 2zM7 8H5v2h2V8zm2 0h2v2H9V8zm6 0h-2v2h2V8z" clipRule="evenodd" /></svg>
                        </button>
                        <button onClick={onSetReplyTo} className="p-1 rounded-full bg-bg-primary hover:bg-bg-tertiary" title="Reply to message">
                           <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-text-secondary" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M7.707 3.293a1 1 0 010 1.414L5.414 7H11a7 7 0 017 7v2a1 1 0 11-2 0v-2a5 5 0 00-5-5H5.414l2.293 2.293a1 1 0 11-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z" clipRule="evenodd" /></svg>
                        </button>
                        {canPin && (
                            <button onClick={onPinToggle} className="p-1 rounded-full bg-bg-primary hover:bg-bg-tertiary" title={isPinned ? 'Unpin message' : 'Pin message'}>
                                {isPinned ? (
                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-text-accent" viewBox="0 0 20 20" fill="currentColor">
                                        <path fillRule="evenodd" d="M10 1.05c-1.305 0-2.368.53-3.223 1.382l-6.275 6.276a.75.75 0 00.53 1.282H5v5.5a2.5 2.5 0 002.5 2.5h5A2.5 2.5 0 0015 15.5V10h3.968a.75.75 0 00.53-1.282L13.223 2.432C12.368 1.58 11.305 1.05 10 1.05z" clipRule="evenodd" />
                                    </svg>
                                ):(
                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-text-secondary" viewBox="0 0 20 20" fill="currentColor">
                                        <path d="M8.13 1.813a2.5 2.5 0 013.74 0l6.25 6.25a2.5 2.5 0 010 3.74l-2.07 2.07a.75.75 0 01-1.06 0L14.43 13.3a.75.75 0 00-1.06 0l-1.44 1.44a.75.75 0 01-1.06 0L9.43 13.3a.75.75 0 00-1.06 0l-1.44 1.44a.75.75 0 01-1.06 0L3.8 12.673a2.5 2.5 0 010-3.74l6.25-6.25zM9.5 7.5a.75.75 0 00-1.06 1.06L10 10.12l-1.56 1.56a.75.75 0 001.06 1.06L11.06 11.2l1.56 1.56a.75.75 0 101.06-1.06L12.12 10l1.56-1.56a.75.75 0 00-1.06-1.06L11.06 8.88 9.5 7.44z" />
                                    </svg>
                                )}
                            </button>
                        )}
                        <div className="relative">
                            <button onClick={() => setPickerOpen(p => !p)} className="p-1 rounded-full bg-bg-primary hover:bg-bg-tertiary" title="Add reaction">
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-text-secondary" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM7 9a1 1 0 100-2 1 1 0 000 2zm7-1a1 1 0 11-2 0 1 1 0 012 0zm-.464 5.535a1 1 0 10-1.415-1.414 3 3 0 01-4.242 0 1 1 0 00-1.415 1.414 5 5 0 007.072 0z" clipRule="evenodd" /></svg>
                            </button>
                            {isPickerOpen && <ReactionPicker onSelect={handleSelectEmoji} onClose={() => setPickerOpen(false)} />}
                        </div>
                    </>
                 )}
            </div>

            <div className={`flex flex-col w-full ${isOwn ? 'items-end' : 'items-start'}`}>
                <div className={`flex items-baseline gap-2 ${isOwn ? 'flex-row-reverse' : ''}`}>
                    {!isOwn && <span className="font-bold text-sm text-text-primary">{message.sender.name}</span>}
                    <span className="text-xs text-text-secondary flex items-center gap-1">
                        {format(new Date(message.timestamp), 'p')}
                        {message.isEdited && !message.isRedacted && <span className="italic text-gray-500">(edited)</span>}
                        {isOwn && !message.isUploading && !message.isRedacted && (
                            <span className="ml-1">
                                {isReadByOthers ? (
                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-blue-400" viewBox="0 0 20 20" fill="currentColor">
                                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                                        <path d="M12.293 5.293a1 1 0 011.414 0l4 4a1 1 0 01-1.414 1.414L13 7.414l-1.293 1.293a1 1 0 01-1.414-1.414l2-2z" />
                                    </svg>
                                ) : (
                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-text-secondary" viewBox="0 0 20 20" fill="currentColor">
                                       <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                                    </svg>
                                )}
                            </span>
                        )}
                    </span>
                </div>
                <div className={`mt-1 relative ${messageContainerClass}`}>
                    {renderMessageContent()}
                    {renderTranslation()}
                </div>
                 <div className={`flex items-center gap-4 mt-1.5 w-full ${isOwn ? 'justify-end' : ''}`}>
                    {message.threadReplyCount > 0 && (
                        <button onClick={onOpenThread} className="text-xs text-text-accent font-semibold hover:underline">
                            {message.threadReplyCount} {message.threadReplyCount === 1 ? 'reply' : 'replies'}
                        </button>
                    )}
                    {message.reactions && (
                        <ReactionsDisplay 
                            reactions={message.reactions} 
                            onReaction={onReaction}
                        />
                    )}
                </div>
            </div>
        </div>
    );
};

export default ChatMessage;