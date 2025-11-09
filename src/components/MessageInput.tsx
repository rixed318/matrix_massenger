import React, { useState, KeyboardEvent, useEffect, useRef, useMemo, ChangeEvent } from 'react';
import { MatrixClient, Message, MatrixUser, Sticker, Gif } from '@matrix-messenger/core';
import { sendTypingIndicator, getRoomTTL, setRoomTTL, setNextMessageTTL } from '@matrix-messenger/core';
import MentionSuggestions from './MentionSuggestions';
import StickerGifPicker from './StickerGifPicker';
import type { DraftAttachment, DraftContent, SendKeyBehavior } from '../types';

const deserializeAttachment = async (attachment: DraftAttachment): Promise<File> => {
    const response = await fetch(attachment.dataUrl);
    const blob = await response.blob();
    return new File([blob], attachment.name, { type: attachment.mimeType, lastModified: Date.now() });
};

const formatFileSize = (size: number) => {
    if (size >= 1024 * 1024) {
        return `${(size / (1024 * 1024)).toFixed(1)} MB`;
    }
    if (size >= 1024) {
        return `${(size / 1024).toFixed(1)} KB`;
    }
    return `${size} B`;
};

const createAttachmentId = () => `att-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const escapeHtml = (value: string) =>
    value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');

const renderMarkdown = (value: string, roomMembers: MatrixUser[]): string => {
    if (!value) {
        return '';
    }

    const memberByName = new Map<string, MatrixUser>();
    roomMembers.forEach(member => {
        if (member.displayName) {
            memberByName.set(member.displayName, member);
        }
        memberByName.set(member.userId, member);
    });

    let html = escapeHtml(value);

    html = html.replace(/\[([^\]]+)\]\((https?:[^\s)]+)\)/g, (_match, text: string, url: string) => {
        const safeText = text;
        const safeUrl = escapeHtml(url);
        return `<a href="${safeUrl}" target="_blank" rel="noopener noreferrer">${safeText}</a>`;
    });

    html = html.replace(/`([^`]+)`/g, (_match, content: string) => `<code>${content}</code>`);
    html = html.replace(/\*\*([^*]+)\*\*/g, (_match, text: string) => `<strong>${text}</strong>`);
    html = html.replace(/__([^_]+)__/g, (_match, text: string) => `<strong>${text}</strong>`);
    html = html.replace(/~~([^~]+)~~/g, (_match, text: string) => `<s>${text}</s>`);
    html = html.replace(/\*([^*]+)\*/g, (_match, text: string) => `<em>${text}</em>`);
    html = html.replace(/_([^_]+)_/g, (_match, text: string) => `<em>${text}</em>`);

    html = html.replace(/@([A-Za-z0-9._-]+)/g, (match: string, name: string) => {
        const member = memberByName.get(name);
        if (!member) {
            return match;
        }
        const display = escapeHtml(member.displayName ?? member.userId);
        return `<a href="https://matrix.to/#/${member.userId}" rel="noopener noreferrer">@${display}</a>`;
    });

    return html.replace(/\n/g, '<br/>');
};

interface MessageInputProps {
    onSendMessage: (content: { body: string; formattedBody?: string }) => void | Promise<void>;
    onSendFile: (file: File) => void;
    onSendAudio: (file: Blob, duration: number) => void;
    onSendSticker: (sticker: Sticker) => void;
    onSendGif: (gif: Gif) => void;
    onOpenCreatePoll: () => void;
    onSchedule: (content: DraftContent) => void;
    isSending: boolean;
    client: MatrixClient;
    roomId: string | null;
    replyingTo: Message | null;
    onCancelReply: () => void;
    roomMembers: MatrixUser[];
    draftContent: DraftContent | null;
    onDraftChange: (content: DraftContent) => void;
    sendKeyBehavior: SendKeyBehavior;
}

const MessageInput: React.FC<MessageInputProps> = ({
    onSendMessage, onSendFile, onSendAudio, onSendSticker, onSendGif, onOpenCreatePoll, onSchedule,
    isSending, client, roomId, replyingTo, onCancelReply, roomMembers, draftContent, onDraftChange,
    sendKeyBehavior
}) => {
    const [content, setContent] = useState(draftContent?.plain ?? '');
    const [attachments, setAttachments] = useState<DraftAttachment[]>(draftContent?.attachments ?? []);
    const [showPreview, setShowPreview] = useState(false);
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
    const inputRef = useRef<HTMLTextAreaElement>(null);
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
        setContent(draftContent?.plain ?? '');
        setAttachments(draftContent?.attachments ?? []);
        setShowPreview(false);
    }, [draftContent, roomId]);

    const formattedHtml = useMemo(() => renderMarkdown(content, roomMembers), [content, roomMembers]);

    const currentDraft = useMemo<DraftContent>(() => ({
        plain: content,
        formatted: formattedHtml,
        attachments,
    }), [content, formattedHtml, attachments]);

    useEffect(() => {
        if (!roomId) return;
        onDraftChange(currentDraft);
    }, [currentDraft, roomId, onDraftChange]);

    useEffect(() => {
        if (!roomId) return;

        const lastWord = content.split(' ').pop() || '';
        if (lastWord.startsWith('@') && lastWord.length > 1) {
            setShowMentions(true);
            setMentionQuery(lastWord.substring(1));
        } else {
            setShowMentions(false);
        }

        adjustTextareaHeight();

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

    const adjustTextareaHeight = () => {
        const textarea = inputRef.current;
        if (!textarea) return;
        textarea.style.height = 'auto';
        const maxHeight = 240;
        const nextHeight = Math.min(textarea.scrollHeight, maxHeight);
        textarea.style.height = `${nextHeight}px`;
    };

    const handleTextareaChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
        setContent(event.target.value);
        setMentionCursor(event.target.selectionStart ?? event.target.value.length);
    };

    const handleCaretChange = () => {
        const textarea = inputRef.current;
        if (!textarea) return;
        setMentionCursor(textarea.selectionStart ?? textarea.value.length);
    };

    const applyMarkdown = (prefix: string, suffix: string, placeholder: string) => {
        const textarea = inputRef.current;
        if (!textarea) return;
        const start = textarea.selectionStart ?? 0;
        const end = textarea.selectionEnd ?? start;
        const selected = content.slice(start, end) || placeholder;
        const before = content.slice(0, start);
        const after = content.slice(end);
        const nextValue = `${before}${prefix}${selected}${suffix}${after}`;
        setContent(nextValue);

        const selectionStart = start + prefix.length;
        const selectionEnd = selectionStart + selected.length;
        requestAnimationFrame(() => {
            textarea.focus();
            textarea.selectionStart = selectionStart;
            textarea.selectionEnd = selectionEnd;
            setMentionCursor(selectionEnd);
            adjustTextareaHeight();
        });
    };

    const applyLink = () => {
        const textarea = inputRef.current;
        if (!textarea) return;
        const start = textarea.selectionStart ?? 0;
        const end = textarea.selectionEnd ?? start;
        const selected = content.slice(start, end) || 'label';
        const urlPlaceholder = 'https://example.com';
        const before = content.slice(0, start);
        const after = content.slice(end);
        const linkMarkdown = `[${selected}](${urlPlaceholder})`;
        const nextValue = `${before}${linkMarkdown}${after}`;
        setContent(nextValue);

        const selectionStart = before.length + selected.length + 3; // [ + ](
        const selectionEnd = selectionStart + urlPlaceholder.length;
        requestAnimationFrame(() => {
            textarea.focus();
            textarea.selectionStart = selectionStart;
            textarea.selectionEnd = selectionEnd;
            setMentionCursor(selectionEnd);
            adjustTextareaHeight();
        });
    };

    const removeAttachment = (id: string) => {
        setAttachments(prev => prev.filter(att => att.id !== id));
    };

    const handleSend = async () => {
        if (!roomId) return;
        const trimmed = content.trim();
        const hasAttachments = attachments.length > 0;
        if (!trimmed && !hasAttachments) {
            return;
        }

        if (typingTimeoutRef.current) window.clearTimeout(typingTimeoutRef.current);
        sendTypingIndicator(client, roomId, false);

        try {
            if (trimmed) {
                await onSendMessage({
                    body: trimmed,
                    formattedBody: formattedHtml || undefined,
                });
            }

            if (hasAttachments) {
                for (const attachment of attachments) {
                    const file = await deserializeAttachment(attachment);
                    onSendFile(file);
                }
            }

            setAttachments([]);
            setContent('');
        } catch (error) {
            console.error('Failed to send message content', error);
        }
    };

    const handleSelectMention = (user: MatrixUser) => {
        const cursor = mentionCursor;
        const textareaValue = content;
        const lastAt = textareaValue.lastIndexOf('@', Math.max(cursor - 1, 0));
        let newContent = textareaValue;
        if (lastAt >= 0) {
            const before = textareaValue.slice(0, lastAt);
            const after = textareaValue.slice(cursor);
            newContent = `${before}@${user.displayName} ${after}`;
        } else {
            newContent = `${textareaValue}@${user.displayName} `;
        }

        setContent(newContent);
        setShowMentions(false);
        requestAnimationFrame(() => {
            const textarea = inputRef.current;
            if (textarea) {
                const nextCursor = (lastAt >= 0 ? lastAt : textareaValue.length) + user.displayName.length + 2;
                textarea.selectionStart = textarea.selectionEnd = nextCursor;
                textarea.focus();
                setMentionCursor(nextCursor);
                adjustTextareaHeight();
            }
        });
    };

    const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === 'Enter') {
            const isCtrlLike = e.ctrlKey || e.metaKey;
            const shouldSend = (() => {
                if (showMentions) return false;
                if (sendKeyBehavior === 'enter') {
                    if (e.shiftKey) return false;
                    if (isCtrlLike || e.altKey) return false;
                    e.preventDefault();
                    return true;
                }
                if (sendKeyBehavior === 'ctrlEnter') {
                    if (isCtrlLike && !e.shiftKey && !e.altKey) {
                        e.preventDefault();
                        return true;
                    }
                    return false;
                }
                if (sendKeyBehavior === 'altEnter') {
                    if (e.altKey && !e.shiftKey && !isCtrlLike) {
                        e.preventDefault();
                        return true;
                    }
                    return false;
                }
                return false;
            })();

            if (shouldSend) {
                void handleSend();
                return;
            }
        }

        if (e.key === 'Escape') {
            if (replyingTo) onCancelReply();
            if (showMentions) setShowMentions(false);
            if (isPickerOpen) setPickerOpen(false);
        }
    };

    const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = () => {
                const dataUrl = reader.result as string;
                const isImage = file.type.startsWith('image/');
                setAttachments(prev => ([
                    ...prev,
                    {
                        id: createAttachmentId(),
                        name: file.name,
                        size: file.size,
                        mimeType: file.type,
                        dataUrl,
                        kind: isImage ? 'image' : 'file',
                        msgtype: isImage ? 'm.image' : 'm.file',
                    },
                ]));
            };
            reader.readAsDataURL(file);
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
        const hasContent = content.trim().length > 0 || attachments.length > 0;
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
                    onClick={() => void handleSend()}
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
                            onSchedule(currentDraft);
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
            {attachments.length > 0 && (
                <div className="ml-1 mr-1 mb-2 flex flex-wrap gap-2">
                    {attachments.map(attachment => (
                        <div
                            key={attachment.id}
                            className="flex items-center gap-2 px-3 py-1 bg-bg-secondary border border-border-secondary rounded-md text-xs text-text-primary"
                        >
                            <span className="max-w-[160px] truncate" title={attachment.name}>{attachment.name}</span>
                            <span className="text-text-secondary">{formatFileSize(attachment.size)}</span>
                            <button
                                type="button"
                                onClick={() => removeAttachment(attachment.id)}
                                className="text-text-secondary hover:text-text-primary"
                                aria-label="Remove attachment"
                            >
                                ×
                            </button>
                        </div>
                    ))}
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
                    <div className="flex-1 flex flex-col border-l border-border-secondary/60">
                        <div className="flex items-center gap-2 px-3 pt-3 pb-1 border-b border-border-secondary/60">
                            <button
                                type="button"
                                onClick={() => applyMarkdown('**', '**', 'bold text')}
                                className="px-2 py-1 text-xs font-semibold rounded-md bg-transparent hover:bg-bg-tertiary"
                                aria-label="Bold"
                            >
                                B
                            </button>
                            <button
                                type="button"
                                onClick={() => applyMarkdown('*', '*', 'italic text')}
                                className="px-2 py-1 text-xs italic rounded-md bg-transparent hover:bg-bg-tertiary"
                                aria-label="Italic"
                            >
                                I
                            </button>
                            <button
                                type="button"
                                onClick={() => applyMarkdown('~~', '~~', 'strikethrough')}
                                className="px-2 py-1 text-xs rounded-md bg-transparent hover:bg-bg-tertiary"
                                aria-label="Strikethrough"
                            >
                                S
                            </button>
                            <button
                                type="button"
                                onClick={() => applyMarkdown('`', '`', 'code')}
                                className="px-2 py-1 text-xs font-mono rounded-md bg-transparent hover:bg-bg-tertiary"
                                aria-label="Inline code"
                            >
                                {'</>'}
                            </button>
                            <button
                                type="button"
                                onClick={applyLink}
                                className="px-2 py-1 text-xs rounded-md bg-transparent hover:bg-bg-tertiary"
                                aria-label="Insert link"
                            >
                                🔗
                            </button>
                            <button
                                type="button"
                                onClick={() => setShowPreview(prev => !prev)}
                                className={`ml-auto px-2 py-1 text-xs rounded-md ${showPreview ? 'bg-bg-tertiary text-text-primary' : 'bg-transparent text-text-secondary hover:text-text-primary hover:bg-bg-tertiary'}`}
                                aria-pressed={showPreview}
                            >
                                {showPreview ? 'Editing' : 'Preview'}
                            </button>
                        </div>
                        {showPreview ? (
                            <div
                                className="px-3 pb-3 text-sm text-text-primary whitespace-pre-wrap break-words max-h-40 overflow-y-auto"
                                dangerouslySetInnerHTML={{ __html: formattedHtml || '<span class="text-text-secondary">Nothing to preview yet.</span>' }}
                            />
                        ) : (
                            <textarea
                                ref={inputRef}
                                value={content}
                                onChange={handleTextareaChange}
                                onKeyDown={handleKeyDown}
                                onKeyUp={handleCaretChange}
                                onClick={handleCaretChange}
                                onSelect={handleCaretChange}
                                placeholder="Type a message..."
                                className="flex-1 bg-transparent px-3 pb-3 text-text-primary placeholder-text-secondary focus:outline-none resize-none"
                                disabled={isSending || !roomId}
                                rows={1}
                                style={{ minHeight: '48px', maxHeight: '240px' }}
                            />
                        )}
                    </div>
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