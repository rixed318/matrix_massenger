import React from 'react';
import MessageInput from './MessageInput';
import { Gif, MatrixClient, MatrixUser, Message, Sticker, DraftContent, LocationContentPayload, SendKeyBehavior, VideoMessageMetadata } from '../types';
import type { OutboxProgressState } from '../services/matrixService';

interface PendingQueueEntry {
    id: string;
    type: string;
    content: any;
    attempts: number;
    error?: string;
    attachments?: { name?: string; kind?: string }[];
    ts?: number;
    progress?: OutboxProgressState;
}

interface MessageComposerProps {
    onSendMessage: (content: { body: string; formattedBody?: string }, threadRootId?: string) => Promise<void> | void;
    onSendFile: (file: File) => Promise<void> | void;
    onSendAudio: (file: Blob, duration: number) => Promise<void> | void;
    onSendVideo: (file: Blob, metadata: VideoMessageMetadata) => Promise<void> | void;
    onSendSticker: (sticker: Sticker) => Promise<void> | void;
    onSendGif: (gif: Gif) => Promise<void> | void;
    onSendLocation: (payload: LocationContentPayload) => Promise<void> | void;
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
    isOffline: boolean;
    sendKeyBehavior: SendKeyBehavior;
    pendingQueue?: PendingQueueEntry[];
    onRetryPending?: (id: string) => void;
    onCancelPending?: (id: string) => void;
}

const MessageComposer: React.FC<MessageComposerProps> = ({
    onSendMessage,
    onSendFile,
    onSendAudio,
    onSendVideo,
    onSendSticker,
    onSendGif,
    onSendLocation,
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
    sendKeyBehavior,
    pendingQueue = [],
    onRetryPending,
    onCancelPending,
}) => {
    const renderQueueLabel = React.useCallback((entry: PendingQueueEntry) => {
        if (entry.type === 'm.room.message') {
            const body = typeof entry.content?.body === 'string' ? entry.content.body.trim() : '';
            if (body) return body;
            const attachmentName = entry.attachments?.find(att => att?.name)?.name;
            if (attachmentName) return attachmentName;
            return 'Сообщение';
        }
        if (entry.type === 'm.reaction') {
            const key = entry.content?.['m.relates_to']?.key;
            return key ? `Реакция ${key}` : 'Реакция';
        }
        return entry.type;
    }, []);

    return (
        <div className="border-t border-border-secondary bg-bg-primary">
            {isOffline && (
                <div className="px-4 py-2 text-xs text-text-inverted bg-status-offline flex items-center gap-2">
                    <span role="img" aria-label="offline">⚠️</span>
                    You are offline. Messages will be sent when connection is restored.
                </div>
            )}
            {pendingQueue.length > 0 && (
                <div className="px-4 py-2 text-[11px] text-amber-100 bg-amber-500/10 border-b border-amber-500/40 space-y-1">
                    <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold uppercase tracking-wide text-amber-200">
                            Несинхронизированные события
                        </span>
                        <span className="text-amber-200/70">{pendingQueue.length}</span>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        {pendingQueue.map(entry => {
                            const progress = entry.progress;
                            const percent = progress && progress.totalBytes > 0
                                ? Math.min(100, Math.round((progress.uploadedBytes / progress.totalBytes) * 100))
                                : null;
                            return (
                                <div
                                    key={entry.id}
                                    className="flex items-center gap-2 rounded-full bg-amber-500/20 px-3 py-1"
                                >
                                    <span className="truncate max-w-[160px] text-amber-100">{renderQueueLabel(entry)}</span>
                                    {percent !== null && (
                                        <span className="text-[10px] text-amber-100/80">{percent}%</span>
                                    )}
                                    {onRetryPending && (
                                        <button
                                            type="button"
                                            onClick={() => onRetryPending(entry.id)}
                                            className="text-[10px] uppercase tracking-wide text-amber-100/90 hover:text-amber-50"
                                        >
                                            ↻
                                        </button>
                                    )}
                                    {onCancelPending && (
                                        <button
                                            type="button"
                                            onClick={() => onCancelPending(entry.id)}
                                            className="text-[10px] uppercase tracking-wide text-amber-100/70 hover:text-amber-50"
                                        >
                                            ✕
                                        </button>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}
            <MessageInput
                onSendMessage={payload => onSendMessage(payload)}
                onSendFile={onSendFile}
                onSendAudio={onSendAudio}
                onSendVideo={onSendVideo}
                onSendSticker={onSendSticker}
                onSendGif={onSendGif}
                onSendLocation={onSendLocation}
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
                sendKeyBehavior={sendKeyBehavior}
            />
        </div>
    );
};

export default MessageComposer;
