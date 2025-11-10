import React, { useState, KeyboardEvent, useEffect, useRef, useMemo, ChangeEvent, useCallback } from 'react';
import { MatrixClient, Message, MatrixUser, Sticker, Gif } from '@matrix-messenger/core';
import { sendTypingIndicator, getRoomTTL, setRoomTTL, setNextMessageTTL } from '@matrix-messenger/core';
import type { GifFavorite } from '@matrix-messenger/core';
import {
    createAttachmentId,
    formatFileSize,
    mergeGifFavorites,
    renderMarkdown,
    VIDEO_MAX_DURATION_SECONDS,
} from '@matrix-messenger/ui/message-input';
import MentionSuggestions from './MentionSuggestions';
import StickerGifPicker from './StickerGifPicker';
import type { DraftAttachment, DraftContent, LocationContentPayload, SendKeyBehavior, VideoMessageMetadata } from '../types';
import { pickSupportedVideoMimeType, readVideoMetadata } from '../utils/media';
import LocationPickerDialog from './LocationPickerDialog';
import { DEFAULT_LOCATION } from '../utils/location';

const deserializeAttachment = async (attachment: DraftAttachment): Promise<File> => {
    const response = await fetch(attachment.dataUrl);
    const blob = await response.blob();
    return new File([blob], attachment.name, { type: attachment.mimeType, lastModified: Date.now() });
};

interface RecordedVideoDraft {
    blob: Blob;
    url: string;
    durationMs: number;
    width: number;
    height: number;
    mimeType: string;
    thumbnailBlob: Blob;
    thumbnailUrl: string;
    thumbnailWidth: number;
    thumbnailHeight: number;
    thumbnailMimeType: string;
}

export interface MessageInputProps {
    onSendMessage: (content: { body: string; formattedBody?: string }) => void | Promise<void>;
    onSendFile: (file: File) => void;
    onSendAudio: (file: Blob, duration: number) => void;
    onSendVideo: (file: Blob, metadata: VideoMessageMetadata) => void;
    onSendSticker: (sticker: Sticker) => void;
    onSendGif: (gif: Gif) => void;
    onSendLocation: (payload: LocationContentPayload) => void | Promise<void>;
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
    onSendMessage, onSendFile, onSendAudio, onSendVideo, onSendSticker, onSendGif, onSendLocation, onOpenCreatePoll, onSchedule,
    isSending, client, roomId, replyingTo, onCancelReply, roomMembers, draftContent, onDraftChange,
    sendKeyBehavior
}) => {
    const [content, setContent] = useState(draftContent?.plain ?? '');
    const [attachments, setAttachments] = useState<DraftAttachment[]>(draftContent?.attachments ?? []);
    const [showPreview, setShowPreview] = useState(false);
    const [isAudioRecording, setIsAudioRecording] = useState(false);
    const [audioRecordingTime, setAudioRecordingTime] = useState(0);
    const [isVideoRecording, setIsVideoRecording] = useState(false);
    const [videoRecordingTime, setVideoRecordingTime] = useState(0);
    const [videoDraft, setVideoDraft] = useState<RecordedVideoDraft | null>(null);
    const [showMentions, setShowMentions] = useState(false);
    const [mentionQuery, setMentionQuery] = useState('');
    const [mentionCursor, setMentionCursor] = useState(0);
    const [contextMenuVisible, setContextMenuVisible] = useState(false);
    const [contextMenuPos, setContextMenuPos] = useState({ x: 0, y: 0 });
    const [isPickerOpen, setPickerOpen] = useState(false);
    const [roomTtlMs, setRoomTtlMs] = useState<number | null>(null);
    const [nextMessageTtlMs, setNextMessageTtlMs] = useState<number | null>(null);
    const [ttlMenuOpen, setTtlMenuOpen] = useState(false);
    const [isLocationDialogOpen, setIsLocationDialogOpen] = useState(false);
    const [locationDraft, setLocationDraft] = useState<{ latitude: number; longitude: number; accuracy?: number } | null>(null);
    const [isLocating, setIsLocating] = useState(false);
    const [locationError, setLocationError] = useState<string | null>(null);
    const ttlMenuRef = useRef<HTMLDivElement>(null);


    const typingTimeoutRef = useRef<number | null>(null);
    const inputRef = useRef<HTMLTextAreaElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const audioRecorderRef = useRef<MediaRecorder | null>(null);
    const audioChunksRef = useRef<Blob[]>([]);
    const audioRecordingTimerRef = useRef<number | null>(null);
    const videoRecorderRef = useRef<MediaRecorder | null>(null);
    const videoChunksRef = useRef<Blob[]>([]);
    const videoRecordingTimerRef = useRef<number | null>(null);
    const videoStreamRef = useRef<MediaStream | null>(null);
    const liveVideoRef = useRef<HTMLVideoElement>(null);
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
        resetVideoRecordingState();
        discardVideoDraft();
    }, [discardVideoDraft, draftContent, resetVideoRecordingState, roomId]);

    useEffect(() => {
        if (isLocationDialogOpen && !locationDraft) {
            setLocationDraft(DEFAULT_LOCATION);
        }
    }, [isLocationDialogOpen, locationDraft]);

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
        if (!isVideoRecording) {
            if (liveVideoRef.current) {
                liveVideoRef.current.srcObject = null;
            }
            return;
        }
        const element = liveVideoRef.current;
        if (element && videoStreamRef.current) {
            element.srcObject = videoStreamRef.current;
            element.play?.().catch(error => {
                console.warn('Unable to start live video preview', error);
            });
        }
        return () => {
            if (element) {
                element.srcObject = null;
            }
        };
    }, [isVideoRecording]);

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
        if (!client) return;
        let cancelled = false;
        let unsubscribeLocal: (() => void) | undefined;
        let unsubscribeRemote: (() => void) | undefined;

        const bootstrapFavorites = async () => {
            try {
                const [localFavorites, remoteFavorites] = await Promise.all([
                    getGifFavorites(),
                    loadGifFavoritesFromAccountData(client),
                ]);
                if (!cancelled && remoteFavorites) {
                    await replaceGifFavoritesFromRemote(mergeGifFavorites(localFavorites, remoteFavorites));
                }
            } catch (error) {
                if (!cancelled) {
                    console.error('Failed to initialize GIF favorites sync', error);
                }
            }
            if (cancelled) return;
            unsubscribeRemote = subscribeToGifFavoritesAccountData(client, async favorites => {
                try {
                    const local = await getGifFavorites();
                    await replaceGifFavoritesFromRemote(mergeGifFavorites(local, favorites));
                } catch (error) {
                    console.error('Failed to apply GIF favorites from account data', error);
                }
            });
        };

        unsubscribeLocal = subscribeToGifFavorites(async (favorites, source) => {
            if (source !== 'local' || !client) {
                return;
            }
            try {
                await persistGifFavoritesToAccountData(client, favorites);
            } catch (error) {
                console.error('Failed to persist GIF favorites to account data', error);
            }
        });

        bootstrapFavorites();

        return () => {
            cancelled = true;
            unsubscribeLocal?.();
            unsubscribeRemote?.();
        };
    }, [client]);


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

    const handleOpenLocationDialog = () => {
        if (!roomId) {
            return;
        }
        setLocationError(null);
        setIsLocationDialogOpen(true);
        setIsLocating(false);
        setLocationDraft(prev => prev ?? DEFAULT_LOCATION);

        if (typeof navigator !== 'undefined' && navigator.geolocation) {
            setIsLocating(true);
            navigator.geolocation.getCurrentPosition(
                position => {
                    setIsLocating(false);
                    setLocationDraft({
                        latitude: position.coords.latitude,
                        longitude: position.coords.longitude,
                        accuracy: position.coords.accuracy,
                    });
                },
                (error: GeolocationPositionError) => {
                    setIsLocating(false);
                    let message = 'Не удалось получить геолокацию.';
                    if (error?.code === 1) {
                        message = 'Доступ к геолокации запрещён.';
                    } else if (error?.code === 2) {
                        message = 'Службы геолокации недоступны.';
                    } else if (error?.code === 3) {
                        message = 'Истекло время ожидания геолокации.';
                    }
                    setLocationError(message);
                },
                { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
            );
        } else {
            setLocationError('Геолокация не поддерживается в этом браузере.');
        }
    };

    const handleConfirmLocation = (selection: { latitude: number; longitude: number; zoom: number; description?: string; accuracy?: number }) => {
        const payload: LocationContentPayload = {
            latitude: selection.latitude,
            longitude: selection.longitude,
            zoom: selection.zoom,
            description: selection.description,
            accuracy: selection.accuracy ?? locationDraft?.accuracy,
        };
        setLocationDraft({ latitude: selection.latitude, longitude: selection.longitude, accuracy: payload.accuracy });
        setIsLocationDialogOpen(false);
        setIsLocating(false);
        setLocationError(null);
        void Promise.resolve(onSendLocation(payload)).catch(error => {
            console.error('Failed to send location message', error);
        });
    };

    const handleCloseLocationDialog = () => {
        setIsLocationDialogOpen(false);
        setIsLocating(false);
    };

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
        if (isAudioRecording || isVideoRecording || videoDraft) return;
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            audioRecorderRef.current = new MediaRecorder(stream);
            audioChunksRef.current = [];

            audioRecorderRef.current.ondataavailable = event => {
                audioChunksRef.current.push(event.data);
            };

            audioRecorderRef.current.onstop = () => {
                const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/ogg; codecs=opus' });
                onSendAudio(audioBlob, audioRecordingTime);
                stream.getTracks().forEach(track => track.stop()); // Stop microphone access
                resetRecordingState();
            };

            audioRecorderRef.current.start();
            setIsAudioRecording(true);
            setAudioRecordingTime(0);
            audioRecordingTimerRef.current = window.setInterval(() => {
                setAudioRecordingTime(prevTime => prevTime + 1);
            }, 1000);

        } catch (error) {
            console.error("Error starting recording:", error);
            // TODO: Show an error to the user
        }
    };

    const stopRecording = () => {
        if (audioRecorderRef.current && isAudioRecording) {
            audioRecorderRef.current.stop();
        }
    };

    const cancelRecording = () => {
        if (audioRecorderRef.current && isAudioRecording) {
            audioRecorderRef.current.stream.getTracks().forEach(track => track.stop());
            audioRecorderRef.current.ondataavailable = null;
            audioRecorderRef.current.onstop = null;
            resetRecordingState();
        }
    };

    const resetRecordingState = useCallback(() => {
        setIsAudioRecording(false);
        if (audioRecordingTimerRef.current) {
            clearInterval(audioRecordingTimerRef.current);
            audioRecordingTimerRef.current = null;
        }
        setAudioRecordingTime(0);
        audioChunksRef.current = [];
        audioRecorderRef.current = null;
    }, []);

    const stopVideoTimer = useCallback(() => {
        if (videoRecordingTimerRef.current) {
            clearInterval(videoRecordingTimerRef.current);
            videoRecordingTimerRef.current = null;
        }
    }, []);

    const cleanupVideoStream = useCallback(() => {
        if (videoStreamRef.current) {
            videoStreamRef.current.getTracks().forEach(track => track.stop());
            videoStreamRef.current = null;
        }
        const el = liveVideoRef.current;
        if (el) {
            el.srcObject = null;
        }
    }, []);

    const resetVideoRecordingState = useCallback(() => {
        setIsVideoRecording(false);
        stopVideoTimer();
        setVideoRecordingTime(0);
        videoRecorderRef.current = null;
        videoChunksRef.current = [];
        cleanupVideoStream();
    }, [cleanupVideoStream, stopVideoTimer]);

    const discardVideoDraft = useCallback(() => {
        if (videoDraft) {
            URL.revokeObjectURL(videoDraft.url);
            URL.revokeObjectURL(videoDraft.thumbnailUrl);
            setVideoDraft(null);
        }
    }, [videoDraft]);

    const handleVideoRecorderStop = useCallback(async (mimeType?: string) => {
        stopVideoTimer();
        setIsVideoRecording(false);
        setVideoRecordingTime(0);
        cleanupVideoStream();

        try {
            if (videoChunksRef.current.length === 0) {
                videoRecorderRef.current = null;
                return;
            }

            const blobType = mimeType || (videoRecorderRef.current?.mimeType ?? 'video/webm');
            const videoBlob = new Blob(videoChunksRef.current, { type: blobType });
            const metadata = await readVideoMetadata(videoBlob, { captureTime: 0.2 });
            const previewUrl = URL.createObjectURL(videoBlob);
            const thumbnailUrl = URL.createObjectURL(metadata.thumbnailBlob);
            setVideoDraft({
                blob: videoBlob,
                url: previewUrl,
                durationMs: metadata.durationMs,
                width: metadata.width,
                height: metadata.height,
                mimeType: blobType,
                thumbnailBlob: metadata.thumbnailBlob,
                thumbnailUrl,
                thumbnailWidth: metadata.thumbnailWidth,
                thumbnailHeight: metadata.thumbnailHeight,
                thumbnailMimeType: metadata.thumbnailMimeType,
            });
        } catch (error) {
            console.error('Error while finalising video recording:', error);
        } finally {
            videoChunksRef.current = [];
            videoRecorderRef.current = null;
        }
    }, [cleanupVideoStream, stopVideoTimer]);

    const startVideoRecording = async () => {
        if (isVideoRecording) return;
        discardVideoDraft();
        try {
            const constraints: MediaStreamConstraints = {
                audio: true,
                video: {
                    facingMode: 'user',
                    width: { ideal: 720 },
                    height: { ideal: 720 },
                },
            };
            const stream = await navigator.mediaDevices.getUserMedia(constraints);
            videoStreamRef.current = stream;
            const mimeType = pickSupportedVideoMimeType();
            const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
            videoRecorderRef.current = recorder;
            videoChunksRef.current = [];

            recorder.ondataavailable = event => {
                if (event.data && event.data.size > 0) {
                    videoChunksRef.current.push(event.data);
                }
            };

            recorder.onstop = () => {
                void handleVideoRecorderStop(recorder.mimeType);
            };

            recorder.start();
            setIsVideoRecording(true);
            setVideoRecordingTime(0);
            stopVideoTimer();
            videoRecordingTimerRef.current = window.setInterval(() => {
                setVideoRecordingTime(prev => {
                    const next = prev + 1;
                    if (next >= VIDEO_MAX_DURATION_SECONDS) {
                        window.setTimeout(() => {
                            if (videoRecorderRef.current && videoRecorderRef.current.state === 'recording') {
                                videoRecorderRef.current.stop();
                            }
                        }, 0);
                        return VIDEO_MAX_DURATION_SECONDS;
                    }
                    return next;
                });
            }, 1000);
        } catch (error) {
            console.error('Error starting video recording:', error);
            resetVideoRecordingState();
        }
    };

    const stopVideoRecording = () => {
        if (videoRecorderRef.current && videoRecorderRef.current.state === 'recording') {
            videoRecorderRef.current.stop();
        }
    };

    const cancelVideoRecording = () => {
        if (videoRecorderRef.current) {
            videoRecorderRef.current.ondataavailable = null;
            videoRecorderRef.current.onstop = null;
            if (videoRecorderRef.current.state === 'recording') {
                videoRecorderRef.current.stop();
            }
        }
        resetVideoRecordingState();
    };

    const handleSendVideoDraft = useCallback(() => {
        if (!videoDraft || !roomId) return;
        onSendVideo(videoDraft.blob, {
            durationMs: videoDraft.durationMs,
            width: videoDraft.width,
            height: videoDraft.height,
            mimeType: videoDraft.mimeType,
            thumbnail: videoDraft.thumbnailBlob,
            thumbnailMimeType: videoDraft.thumbnailMimeType,
            thumbnailWidth: videoDraft.thumbnailWidth,
            thumbnailHeight: videoDraft.thumbnailHeight,
        });
        discardVideoDraft();
    }, [discardVideoDraft, onSendVideo, roomId, videoDraft]);

    const formatTime = (seconds: number) => {
        const minutes = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${minutes}:${secs < 10 ? '0' : ''}${secs}`;
    };

    useEffect(() => {
        return () => {
            resetRecordingState();
            resetVideoRecordingState();
            discardVideoDraft();
        };
    }, [discardVideoDraft, resetRecordingState, resetVideoRecordingState]);

    
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

        if (isVideoRecording) {
            return (
                 <button onClick={stopVideoRecording} disabled={buttonDisabled} className="p-3 text-text-accent hover:opacity-80 disabled:text-text-secondary disabled:cursor-not-allowed">
                     <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8 7a1 1 0 00-1 1v4a1 1 0 102 0V8a1 1 0 00-1-1zm4 0a1 1 0 00-1 1v4a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
                    </svg>
                </button>
            );
        }

        if (isAudioRecording) {
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
                disabled={buttonDisabled || isVideoRecording || Boolean(videoDraft)}
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
             <LocationPickerDialog
                isOpen={isLocationDialogOpen}
                initialPosition={locationDraft ?? DEFAULT_LOCATION}
                accuracy={locationDraft?.accuracy ?? null}
                isLocating={isLocating}
                error={locationError}
                onClose={handleCloseLocationDialog}
                onConfirm={handleConfirmLocation}
            />
             {isPickerOpen && (
                <StickerGifPicker
                    onClose={() => setPickerOpen(false)}
                    onSendSticker={(sticker) => {
                        if (sticker.isCustomEmoji) {
                            const shortcode = sticker.shortcodes?.[0] ?? sticker.body ?? '';
                            setContent(prev => {
                                const needsSpace = prev && !prev.endsWith(' ');
                                const insertion = needsSpace ? `${prev} ${shortcode} ` : `${prev}${shortcode} `;
                                return prev ? insertion : `${shortcode} `;
                            });
                            requestAnimationFrame(() => inputRef.current?.focus());
                        } else {
                            onSendSticker(sticker);
                        }
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
            <PluginSurfaceHost
                location="chat.composer"
                roomId={roomId}
                context={replyingTo ? { replyingToId: replyingTo.id } : undefined}
                className="ml-1 mr-1 mb-3"
            />
            {isVideoRecording && (
                <div className="ml-1 mr-1 mb-2 flex items-center gap-4 bg-bg-secondary/70 border border-border-secondary rounded-lg p-3">
                    <div className="w-24 h-24 rounded-xl overflow-hidden bg-black/60 flex items-center justify-center">
                        <video ref={liveVideoRef} className="w-full h-full object-cover" muted playsInline />
                    </div>
                    <div className="flex-1">
                        <p className="text-sm text-text-primary font-semibold">Запись видео…</p>
                        <p className="text-xs text-text-secondary">Осталось {Math.max(0, VIDEO_MAX_DURATION_SECONDS - videoRecordingTime)} сек.</p>
                        <p className="text-xs text-text-secondary mt-1 font-mono">{formatTime(videoRecordingTime)}</p>
                    </div>
                    <div className="flex flex-col gap-2">
                        <button onClick={stopVideoRecording} className="px-3 py-1 rounded-md bg-accent text-text-inverted text-sm hover:bg-accent-hover">Стоп</button>
                        <button onClick={cancelVideoRecording} className="px-3 py-1 rounded-md bg-bg-tertiary text-text-secondary text-sm hover:text-text-primary">Отмена</button>
                    </div>
                </div>
            )}
            {videoDraft && (
                <div className="ml-1 mr-1 mb-2 bg-bg-secondary/80 border border-border-secondary rounded-lg p-3 flex flex-col gap-3">
                    <div className="flex gap-3 items-center">
                        <div className="w-32 h-32 rounded-xl overflow-hidden bg-black/60 flex items-center justify-center">
                            <video src={videoDraft.url} poster={videoDraft.thumbnailUrl} className="w-full h-full object-cover" controls playsInline />
                        </div>
                        <div className="flex-1 space-y-1">
                            <p className="text-sm text-text-primary font-semibold">Видео готово к отправке</p>
                            <p className="text-xs text-text-secondary font-mono">Длительность: {formatTime(Math.round(videoDraft.durationMs / 1000))}</p>
                            <p className="text-xs text-text-secondary">Разрешение: {videoDraft.width}×{videoDraft.height}</p>
                        </div>
                    </div>
                    <div className="flex justify-end gap-2">
                        <button
                            onClick={discardVideoDraft}
                            className="px-3 py-1 rounded-md bg-bg-tertiary text-text-secondary text-sm hover:text-text-primary"
                        >
                            Удалить
                        </button>
                        <button
                            onClick={handleSendVideoDraft}
                            className="px-3 py-1 rounded-md bg-accent text-text-inverted text-sm hover:bg-accent-hover"
                            disabled={isSending}
                        >
                            Отправить видео
                        </button>
                    </div>
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
                    disabled={isSending || !roomId || isAudioRecording || isVideoRecording}
                    className="p-3 text-text-secondary hover:text-text-primary disabled:opacity-50 disabled:cursor-not-allowed"
                    aria-label="Attach file"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                    </svg>
                </button>
                <button
                    onClick={onOpenCreatePoll}
                    disabled={isSending || !roomId || isAudioRecording || isVideoRecording}
                    className="p-3 text-text-secondary hover:text-text-primary disabled:opacity-50 disabled:cursor-not-allowed"
                    aria-label="Create poll"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" viewBox="0 0 20 20" fill="currentColor">
                        <path d="M2 11a1 1 0 011-1h2a1 1 0 110 2H3a1 1 0 01-1-1zm5 0a1 1 0 011-1h10a1 1 0 110 2H8a1 1 0 01-1-1zM2 5a1 1 0 011-1h2a1 1 0 110 2H3a1 1 0 01-1-1zm5 0a1 1 0 011-1h10a1 1 0 110 2H8a1 1 0 01-1-1zM2 17a1 1 0 011-1h2a1 1 0 110 2H3a1 1 0 01-1-1zm5 0a1 1 0 011-1h10a1 1 0 110 2H8a1 1 0 01-1-1z" />
                    </svg>
                </button>
                <button
                    onClick={startVideoRecording}
                    disabled={isSending || !roomId || isAudioRecording || isVideoRecording}
                    className="p-3 text-text-secondary hover:text-text-primary disabled:opacity-50 disabled:cursor-not-allowed"
                    aria-label="Record video message"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M5 5a3 3 0 00-3 3v8a3 3 0 003 3h8a3 3 0 003-3v-1.382l2.553 1.532A1 1 0 0020 15.236V8.764a1 1 0 00-1.447-.914L16 9.382V8a3 3 0 00-3-3H5z" />
                    </svg>
                </button>
                {isAudioRecording ? (
                     <div className="flex-1 flex items-center justify-between p-3">
                         <div className="flex items-center">
                            <span className="relative flex h-3 w-3">
                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                                <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500"></span>
                            </span>
                            <span className="ml-3 text-text-primary font-mono">{formatTime(audioRecordingTime)}</span>
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
                <button
                    onClick={handleOpenLocationDialog}
                    disabled={isSending || !roomId || isAudioRecording || isVideoRecording}
                    className="p-3 text-text-secondary hover:text-text-primary disabled:opacity-50 disabled:cursor-not-allowed"
                    aria-label="Поделиться локацией"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M12 2a7 7 0 0 0-7 7c0 4.912 5.653 11.18 6.281 11.875a1 1 0 0 0 1.438 0C13.347 20.18 19 13.912 19 9a7 7 0 0 0-7-7Zm0 2a5 5 0 0 1 5 5c0 3.154-3.3 7.569-5 9.552-1.7-1.983-5-6.398-5-9.552a5 5 0 0 1 5-5Zm0 3.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Z" />
                    </svg>
                </button>
                <div className="relative">
                    <button
                        onClick={() => setTtlMenuOpen(v => !v)}
                        disabled={isSending || !roomId || isAudioRecording || isVideoRecording}
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
                    disabled={isSending || !roomId || isAudioRecording || isVideoRecording}
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