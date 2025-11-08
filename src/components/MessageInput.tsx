import React, { useState, KeyboardEvent, useEffect, useRef } from 'react';
import { MatrixClient, Message, MatrixUser, Sticker, Gif } from '../types';
import { sendTypingIndicator, getRoomTTL, setRoomTTL, setNextMessageTTL } from '../services/matrixService';
import MentionSuggestions from './MentionSuggestions';
import StickerGifPicker from './StickerGifPicker';

interface MessageInputProps {
    onSendMessage: (content: string) => void;
    onSendFile: (file: File) => void;
    onSendAudio: (file: Blob, duration: number) => void;
    onSendSticker: (sticker: Sticker) => void;
    onSendGif: (gif: Gif) => void;
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
}

const MessageInput: React.FC<MessageInputProps> = ({
    onSendMessage, onSendFile, onSendAudio, onSendSticker, onSendGif, onOpenCreatePoll, onSchedule,
    isSending, client, roomId, replyingTo, onCancelReply, roomMembers, draftContent, onDraftChange
}) => {
    const [content, setContent] = useState(draftContent || '');
    const [isRecording, setIsRecording] = useState(false);
    const [recordingTime, setRecordingTime] = useState(0);
    const [showMentions, setShowMentions] = useState(false);
    const [mentionQuery, setMentionQuery] = useState('');
    const [mentionCursor, setMentionCursor] = useState(0);
    const [contextMenuVisible, setContextMenuVisible] = useState(false);
    const [contextMenuPos, setContextMenuPos] = useState({ x: 0, y: 0 });
    const [isPickerOpen, setPickerOpen] = useState(false);
    const [roomTtlMs, setRoomTtlMs] = useState<number | null>(null);
    const [nextMessageTtlMs, setNextMessageTtlMs] = useState<number | null>(null);
    const [ttlMenuOpen, setTtlMenuOpen] = useState(false);
    const ttlMenuRef = useRef<HTMLDivElement>(null);


    const typingTimeoutRef = useRef<number | null>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const audioChunksRef = useRef<Blob[]>([]);
    const recordingTimerRef = useRef<number | null>(null);
    const contextMenuRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (replyingTo) {
            inputRef.current?.focus();
        }
    }, [replyingTo]);

    useEffect(() => {
        setContent(draftContent || '');
    }, [draftContent, roomId]);

    useEffect(() => {
        if (!roomId) return;
        onDraftChange(content);
    }, [content, roomId, onDraftChange]);

    useEffect(() => {
        if (!roomId) return;
        
        const lastWord = content.split(' ').pop() || '';
        if (lastWord.startsWith('@') && lastWord.length > 1) {
            setShowMentions(true);
            setMentionQuery(lastWord.substring(1));
        } else {
            setShowMentions(false);
        }

        if (content) {
            sendTypingIndicator(client, roomId, true);
            if (typingTimeoutRef.current) {
                window.clearTimeout(typingTimeoutRef.current);
            }
            typingTimeoutRef.current = window.setTimeout(() => {
                sendTypingIndicator(client, roomId, false);
            }, 5000);
        }

        return () => {
            if (typingTimeoutRef.current) {
                window.clearTimeout(typingTimeoutRef.current);
            }
        };
    }, [content, roomId, client]);
    
    
    useEffect(() => {
        const loadRoomTTL = async () => {
            if (!client || !roomId) return;
            try {
                const ttl = await getRoomTTL(client, roomId);
                setRoomTtlMs(ttl);
            } catch (e) {
                console.error('Failed to load room TTL', e);
            }
        };
        loadRoomTTL();
        setNextMessageTtlMs(null);
    }, [client, roomId]);


    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (contextMenuRef.current && !contextMenuRef.current.contains(event.target as Node)) {
                setContextMenuVisible(false);
            }

            if (ttlMenuRef.current && !ttlMenuRef.current.contains(event.target as Node)) {
                setTtlMenuOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const updateContent = (value: string) => {
        setContent(value);
    };

    const handleSend = () => {
        if (content.trim() && roomId) {
            if (typingTimeoutRef.current) window.clearTimeout(typingTimeoutRef.current);
            sendTypingIndicator(client, roomId, false);
            onSendMessage(content);
        }
    };

    const handleSelectMention = (user: MatrixUser) => {
        const parts = content.split(' ');
        parts.pop(); // remove the @-query part
        const newContent = [...parts, `@${user.displayName}`].join(' ') + ' ';
        updateContent(newContent);
        setShowMentions(false);
        inputRef.current?.focus();
    };

    const handleKeyPress = (e: KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter' && !showMentions) {
            handleSend();
        } else if (e.key === 'Escape') {
            if (replyingTo) onCancelReply();
            if (showMentions) setShowMentions(false);
            if (isPickerOpen) setPickerOpen(false);
        }
    };

    const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (file) {
            onSendFile(file);
        }
        if(event.target) {
            event.target.value = '';
        }
    };
    
     const handleSendRightClick = (e: React.MouseEvent) => {
        e.preventDefault();
        setContextMenuPos({ x: e.clientX, y: e.clientY });
        setContextMenuVisible(true);
    };

    const startRecording = async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            mediaRecorderRef.current = new MediaRecorder(stream);
            audioChunksRef.current = [];

            mediaRecorderRef.current.ondataavailable = event => {
                audioChunksRef.current.push(event.data);
            };

            mediaRecorderRef.current.onstop = () => {
                const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/ogg; codecs=opus' });
                onSendAudio(audioBlob, recordingTime);
                stream.getTracks().forEach(track => track.stop()); // Stop microphone access
                resetRecordingState();
            };

            mediaRecorderRef.current.start();
            setIsRecording(true);
            setRecordingTime(0);
            recordingTimerRef.current = window.setInterval(() => {
                setRecordingTime(prevTime => prevTime + 1);
            }, 1000);

        } catch (error) {
            console.error("Error starting recording:", error);
            // TODO: Show an error to the user
        }
    };

    const stopRecording = () => {
        if (mediaRecorderRef.current && isRecording) {
            mediaRecorderRef.current.stop();
        }
    };
    
    const cancelRecording = () => {
        if (mediaRecorderRef.current && isRecording) {
            mediaRecorderRef.current.stream.getTracks().forEach(track => track.stop());
            mediaRecorderRef.current.ondataavailable = null;
            mediaRecorderRef.current.onstop = null;
            resetRecordingState();
        }
    };

    const resetRecordingState = () => {
        setIsRecording(false);
        if (recordingTimerRef.current) {
            clearInterval(recordingTimerRef.current);
            recordingTimerRef.current = null;
        }
        setRecordingTime(0);
    };

    const formatTime = (seconds: number) => {
        const minutes = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${minutes}:${secs < 10 ? '0' : ''}${secs}`;
    };

    
    const ttlLabel = (ms: number | null | undefined) => {
        if (!ms) return 'Откл.';
        if (ms < 60000) return `${Math.round(ms/1000)} сек.`;
        const hours = Math.round(ms/3600000);
        if (hours < 1) {
            const mins = Math.round(ms/60000);
            return `${mins} мин.`;
        }
        if (hours < 24) return `${hours} ч.`;
        const days = Math.round(ms/86400000);
        return `${days} дн.`;
    };
    const setRoomTTLHandler = async (ttl: number | null) => {
        if (!client || !roomId) return;
        try {
            await setRoomTTL(client, roomId, ttl);
            setRoomTtlMs(ttl);
        } catch (e) {
            console.error('Failed to set room TTL', e);
        }
    };
    const setNextMessageTTLHandler = (ttl: number | null) => {
        if (!roomId) return;
        setNextMessageTtlMs(ttl);
        setNextMessageTTL(roomId, ttl);
        setTtlMenuOpen(false);
    };

    const renderSendButton = () => {
        const hasContent = content.trim().length > 0;
        const buttonDisabled = isSending || !roomId;

        if (isRecording) {
            return (
                 <button onClick={stopRecording} disabled={buttonDisabled} className="p-3 text-text-accent hover:opacity-80 disabled:text-text-secondary disabled:cursor-not-allowed">
                     <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8 7a1 1 0 00-1 1v4a1 1 0 102 0V8a1 1 0 00-1-1zm4 0a1 1 0 00-1 1v4a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
                    </svg>
                </button>
            )
        }
        if (hasContent) {
            return (
                 <button
                    onClick={handleSend}
                    onContextMenu={handleSendRightClick}
                    disabled={buttonDisabled}
                    className="p-3 text-text-accent hover:opacity-80 disabled:text-text-secondary disabled:cursor-not-allowed"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 transform rotate-90" viewBox="0 0 20 20" fill="currentColor">
                        <path d="M10.894 2.553a1 1 0 00-1.788 0l-7 14a1 1 0 001.169 1.409l5-1.429A1 1 0 009 15.571V11a1 1 0 112 0v4.571a1 1 0 00.725.962l5 1.428a1 1 0 001.17-1.408l-7-14z" />
                    </svg>
                </button>
            )
        }
        return (
             <button
                onClick={startRecording}
                disabled={buttonDisabled}
                className="p-3 text-text-secondary hover:text-text-primary disabled:opacity-50 disabled:cursor-not-allowed"
                aria-label="Record voice message"
            >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M7 4a3 3 0 016 0v4a3 3 0 11-6 0V4zm4 10.93A7.001 7.001 0 0017 8a1 1 0 10-2 0a5 5 0 01-5 5V8a3 3 0 014.52-2.83A1 1 0 0015 4.93a3 3 0 01-6 0A1 1 0 008.48 5.17 3 3 0 0113 8v6.93zM5 8a1 1 0 00-2 0 7.001 7.001 0 006 6.93V17H7a1 1 0 100 2h6a1 1 0 100-2h-2v-2.07A7.001 7.001 0 005 8z" clipRule="evenodd" />
                </svg>
            </button>
        )
    }

    return (
        <div className="p-4 bg-bg-primary border-t border-border-secondary relative">
             {isPickerOpen && (
                <StickerGifPicker
                    onClose={() => setPickerOpen(false)}
                    onSendSticker={(sticker) => {
                        onSendSticker(sticker);
                        setPickerOpen(false);
                    }}
                    onSendGif={(gif) => {
                        onSendGif(gif);
                        setPickerOpen(false);
                    }}
                />
            )}
             {contextMenuVisible && (
                <div
                    ref={contextMenuRef}
                    style={{ top: `${contextMenuPos.y}px`, left: `${contextMenuPos.x}px` }}
                    className="fixed bg-bg-secondary rounded-md shadow-lg p-2 z-50 transform -translate-y-full"
                >
                    <button
                        onClick={() => {
                            onSchedule(content);
                            setContextMenuVisible(false);
                        }}
                        className="w-full text-left px-3 py-2 text-sm text-text-primary hover:bg-bg-tertiary rounded-md"
                    >
                        Schedule Message
                    </button>
                </div>
            )}
             {showMentions && (
                <MentionSuggestions
                    query={mentionQuery}
                    members={roomMembers}
                    onSelect={handleSelectMention}
                />
            )}
            {replyingTo && (
                <div className="flex items-center justify-between bg-bg-secondary/50 p-2 rounded-t-lg border-b border-border-secondary ml-1 mr-1">
                    <div className="overflow-hidden">
                        <p className="font-bold text-sm text-text-accent">Replying to {replyingTo.sender.name}</p>
                        <p className="text-sm text-text-secondary truncate">{replyingTo.content.body}</p>
                    </div>
                    <button onClick={onCancelReply} className="p-1 rounded-full hover:bg-bg-tertiary">
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>
            )}
            <div className={`flex items-center bg-bg-secondary ${replyingTo ? 'rounded-b-lg' : 'rounded-lg'}`}>
                <input
                    type="file"
                    ref={fileInputRef}
                    onChange={handleFileChange}
                    className="hidden"
                />
                <button
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isSending || !roomId || isRecording}
                    className="p-3 text-text-secondary hover:text-text-primary disabled:opacity-50 disabled:cursor-not-allowed"
                    aria-label="Attach file"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                    </svg>
                </button>
                <button
                    onClick={onOpenCreatePoll}
                    disabled={isSending || !roomId || isRecording}
                    className="p-3 text-text-secondary hover:text-text-primary disabled:opacity-50 disabled:cursor-not-allowed"
                    aria-label="Create poll"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" viewBox="0 0 20 20" fill="currentColor">
                        <path d="M2 11a1 1 0 011-1h2a1 1 0 110 2H3a1 1 0 01-1-1zm5 0a1 1 0 011-1h10a1 1 0 110 2H8a1 1 0 01-1-1zM2 5a1 1 0 011-1h2a1 1 0 110 2H3a1 1 0 01-1-1zm5 0a1 1 0 011-1h10a1 1 0 110 2H8a1 1 0 01-1-1zM2 17a1 1 0 011-1h2a1 1 0 110 2H3a1 1 0 01-1-1zm5 0a1 1 0 011-1h10a1 1 0 110 2H8a1 1 0 01-1-1z" />
                    </svg>
                </button>
                {isRecording ? (
                     <div className="flex-1 flex items-center justify-between p-3">
                         <div className="flex items-center">
                            <span className="relative flex h-3 w-3">
                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                                <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500"></span>
                            </span>
                            <span className="ml-3 text-text-primary font-mono">{formatTime(recordingTime)}</span>
                         </div>
                         <button onClick={cancelRecording} className="text-text-secondary hover:text-text-primary">Cancel</button>
                     </div>
                ) : (
                    <input
                        ref={inputRef}
                        type="text"
                        value={content}
                        onChange={(e) => updateContent(e.target.value)}
                        onKeyDown={handleKeyPress}
                        placeholder="Type a message..."
                        className="flex-1 bg-transparent p-3 text-text-primary placeholder-text-secondary focus:outline-none"
                        disabled={isSending || !roomId}
                    />
                )}
                <div className="relative">
                    <button
                        onClick={() => setTtlMenuOpen(v => !v)}
                        disabled={isSending || !roomId || isRecording}
                        className="p-3 text-text-secondary hover:text-text-primary disabled:opacity-50 disabled:cursor-not-allowed"
                        aria-label="TTL"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M12 22a10 10 0 1 1 10-10 10.011 10.011 0 0 1-10 10Zm1-10.586 3.293 3.293a1 1 0 0 1-1.414 1.414l-3.586-3.586A1 1 0 0 1 11 12V7a1 1 0 1 1 2 0v4.414Z"/>
                        </svg>
                    </button>
                    {ttlMenuOpen && (
                        <div ref={ttlMenuRef} className="absolute bottom-12 right-0 w-60 bg-bg-secondary border border-border-secondary rounded-lg shadow-lg z-50">
                            <div className="px-3 py-2 text-xs text-text-secondary">TTL сообщения</div>
                            <button onClick={() => setNextMessageTTLHandler(null)} className="w-full text-left px-3 py-2 hover:bg-bg-tertiary text-sm">Откл.</button>
                            <button onClick={() => setNextMessageTTLHandler(30_000)} className="w-full text-left px-3 py-2 hover:bg-bg-tertiary text-sm">30 секунд</button>
                            <button onClick={() => setNextMessageTTLHandler(3_600_000)} className="w-full text-left px-3 py-2 hover:bg-bg-tertiary text-sm">1 час</button>
                            <div className="border-t border-border-secondary my-1"></div>
                            <div className="px-3 py-2 text-xs text-text-secondary">TTL комнаты (по умолчанию)</div>
                            <button onClick={() => { setRoomTTLHandler(null); setTtlMenuOpen(false); }} className="w-full text-left px-3 py-2 hover:bg-bg-tertiary text-sm">Откл.</button>
                            <button onClick={() => { setRoomTTLHandler(30_000); setTtlMenuOpen(false); }} className="w-full text-left px-3 py-2 hover:bg-bg-tertiary text-sm">30 секунд</button>
                            <button onClick={() => { setRoomTTLHandler(3_600_000); setTtlMenuOpen(false); }} className="w-full text-left px-3 py-2 hover:bg-bg-tertiary text-sm">1 час</button>
                            <div className="px-3 py-2 text-xs text-text-secondary">Текущие: сооб. {ttlLabel(nextMessageTtlMs)} • комната {ttlLabel(roomTtlMs)}</div>
                        </div>
                    )}
                </div>

                 <button
                    onClick={() => setPickerOpen(p => !p)}
                    disabled={isSending || !roomId || isRecording}
                    className="p-3 text-text-secondary hover:text-text-primary disabled:opacity-50 disabled:cursor-not-allowed"
                    aria-label="Open sticker picker"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM7 9a1 1 0 100-2 1 1 0 000 2zm7-1a1 1 0 11-2 0 1 1 0 012 0zm-.464 5.535a1 1 0 10-1.415-1.414 3 3 0 01-4.242 0 1 1 0 00-1.415 1.414 5 5 0 007.072 0z" clipRule="evenodd" />
                    </svg>
                </button>
                {nextMessageTtlMs ? (
                    <span className="mx-2 px-2 py-1 text-xs rounded bg-bg-tertiary text-text-secondary whitespace-nowrap">Исчезнет через {ttlLabel(nextMessageTtlMs)}</span>
                ) : null}
                {renderSendButton()}
            </div>
        </div>
    );
};

export default MessageInput;