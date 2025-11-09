import React from 'react';
import { Message, Reaction, MatrixClient } from '@matrix-messenger/core';
import { EventType } from 'matrix-js-sdk';
import ChatMessage from './ChatMessage';

interface PendingQueueEntry {
    id: string;
    type: string;
    content: any;
    attempts: number;
    error?: string;
    attachments?: { name?: string; kind?: string }[];
    ts?: number;
}

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
    pendingMessages?: Message[];
    pendingQueue?: PendingQueueEntry[];
    onRetryPending?: (id: string) => void;
    onCancelPending?: (id: string) => void;
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


const ESTIMATED_ITEM_HEIGHT = 120;
const OVERSCAN_COUNT = 6;
const INITIAL_RENDER_COUNT = 20;

interface VirtualMeasurement {
    index: number;
    start: number;
    end: number;
    size: number;
}

const findNearestItemIndex = (measurements: VirtualMeasurement[], offset: number): number => {
    if (measurements.length === 0) return 0;
    const clampedOffset = Math.max(0, offset);
    let low = 0;
    let high = measurements.length - 1;
    let nearest = measurements.length - 1;

    while (low <= high) {
        const mid = Math.floor((low + high) / 2);
        const measurement = measurements[mid];
        if (measurement.end > clampedOffset) {
            nearest = mid;
            high = mid - 1;
        } else {
            low = mid + 1;
        }
    }

    return nearest;
};

interface VirtualizedMessageRowProps {
    message: Message;
    start: number;
    isLast: boolean;
    registerHeight: (messageId: string, height: number) => void;
    children: React.ReactNode;
}

const VirtualizedMessageRow: React.FC<VirtualizedMessageRowProps> = ({ message, start, isLast, registerHeight, children }) => {
    const rowRef = React.useRef<HTMLDivElement | null>(null);

    React.useLayoutEffect(() => {
        const element = rowRef.current;
        if (!element) return;

        let animationFrame: number | null = null;

        const measure = () => {
            const rect = element.getBoundingClientRect();
            const height = rect.height;
            if (height > 0) {
                registerHeight(message.id, Math.round(height));
            }
        };

        const scheduleMeasure = () => {
            if (animationFrame !== null && typeof cancelAnimationFrame === 'function') {
                cancelAnimationFrame(animationFrame);
            }

            if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
                animationFrame = window.requestAnimationFrame(() => {
                    measure();
                    animationFrame = null;
                });
            } else {
                measure();
                animationFrame = null;
            }
        };

        scheduleMeasure();

        if (typeof ResizeObserver !== 'undefined') {
            const observer = new ResizeObserver(scheduleMeasure);
            observer.observe(element);
            return () => {
                if (animationFrame !== null && typeof cancelAnimationFrame === 'function') {
                    cancelAnimationFrame(animationFrame);
                    animationFrame = null;
                }
                observer.disconnect();
            };
        }

        window.addEventListener('resize', scheduleMeasure);
        return () => {
            if (animationFrame !== null && typeof cancelAnimationFrame === 'function') {
                cancelAnimationFrame(animationFrame);
                animationFrame = null;
            }
            window.removeEventListener('resize', scheduleMeasure);
        };
    }, [message, registerHeight, isLast]);

    return (
        <div
            ref={rowRef}
            data-virtualized-message="true"
            style={{
                position: 'absolute',
                top: start,
                left: 0,
                width: '100%',
                paddingBottom: isLast ? 0 : 16,
            }}
        >
            {children}
        </div>
    );
};


const MessageView: React.FC<MessageViewProps> = ({
    messages, client, onReaction, onEditMessage, onDeleteMessage,
    onSetReplyTo, onForwardMessage, onImageClick, onOpenThread, onPollVote,
    onTranslateMessage, translatedMessages,
    scrollContainerRef, onScroll, onPaginate, isPaginating, canPaginate,
    pinnedEventIds, canPin, onPinToggle, highlightedMessageId,
    pendingMessages = [], pendingQueue = [], onRetryPending, onCancelPending,
}) => {
    
    const paginationSnapshotRef = React.useRef<{ scrollHeight: number; scrollTop: number } | null>(null);
    const heightCacheRef = React.useRef<Map<string, number>>(new Map());
    const [measurementVersion, setMeasurementVersion] = React.useState(0);
    const [scrollState, setScrollState] = React.useState({ scrollTop: 0, viewportHeight: 0 });
    const displayMessages = React.useMemo(() => [...messages, ...pendingMessages], [messages, pendingMessages]);

    const registerHeight = React.useCallback((messageId: string, height: number) => {
        const normalizedHeight = Math.max(1, Math.round(height));
        const previousHeight = heightCacheRef.current.get(messageId);
        if (previousHeight !== normalizedHeight) {
            heightCacheRef.current.set(messageId, normalizedHeight);
            setMeasurementVersion((version) => version + 1);
        }
    }, []);

    const renderQueueLabel = React.useCallback((entry: PendingQueueEntry) => {
        if (entry.type === EventType.RoomMessage) {
            const body = typeof entry.content?.body === 'string' ? entry.content.body.trim() : '';
            if (body) {
                return body;
            }
            const attachmentName = entry.attachments?.find(att => att?.name)?.name;
            if (attachmentName) {
                return attachmentName;
            }
            return 'Сообщение';
        }
        if (entry.type === EventType.Reaction) {
            const key = entry.content?.['m.relates_to']?.key;
            return key ? `Реакция ${key}` : 'Реакция';
        }
        return entry.type;
    }, []);

    const measurements = React.useMemo<VirtualMeasurement[]>(() => {
        const result: VirtualMeasurement[] = [];
        let offset = 0;

        for (let index = 0; index < displayMessages.length; index += 1) {
            const message = displayMessages[index];
            const size = heightCacheRef.current.get(message.id) ?? ESTIMATED_ITEM_HEIGHT;
            const start = offset;
            const end = start + size;
            result.push({ index, start, end, size });
            offset = end;
        }

        return result;
    }, [displayMessages, measurementVersion]);

    const totalHeight = measurements.length > 0 ? measurements[measurements.length - 1].end : 0;

    const virtualItems = React.useMemo(() => {
        if (measurements.length === 0) return [] as VirtualMeasurement[];

        if (scrollState.viewportHeight <= 0) {
            const endIndex = Math.min(measurements.length, INITIAL_RENDER_COUNT) - 1;
            return measurements.slice(0, Math.max(0, endIndex + 1));
        }

        const startIndex = findNearestItemIndex(measurements, scrollState.scrollTop);
        const endIndex = findNearestItemIndex(measurements, scrollState.scrollTop + scrollState.viewportHeight);
        const rangeStart = Math.max(0, startIndex - OVERSCAN_COUNT);
        const rangeEnd = Math.min(measurements.length - 1, endIndex + OVERSCAN_COUNT);
        return measurements.slice(rangeStart, rangeEnd + 1);
    }, [measurements, scrollState.scrollTop, scrollState.viewportHeight]);

    const handleScroll = React.useCallback(() => {
        onScroll();
        const container = scrollContainerRef.current;
        if (!container) return;

        setScrollState((state) => {
            if (state.scrollTop === container.scrollTop) return state;
            return { ...state, scrollTop: container.scrollTop };
        });

        if (isPaginating || !canPaginate) return;

        if (container.scrollTop <= 16) {
            paginationSnapshotRef.current = {
                scrollHeight: container.scrollHeight,
                scrollTop: container.scrollTop,
            };
            onPaginate();
        }
    }, [onScroll, scrollContainerRef, isPaginating, canPaginate, onPaginate]);

    React.useLayoutEffect(() => {
        const container = scrollContainerRef.current;
        if (!container) return;

        const updateViewportHeight = () => {
            const nextHeight = container.clientHeight;
            setScrollState((state) => {
                if (state.viewportHeight === nextHeight) return state;
                return { ...state, viewportHeight: nextHeight };
            });
        };

        updateViewportHeight();

        if (typeof ResizeObserver !== 'undefined') {
            const observer = new ResizeObserver(updateViewportHeight);
            observer.observe(container);
            return () => observer.disconnect();
        }

        window.addEventListener('resize', updateViewportHeight);
        return () => window.removeEventListener('resize', updateViewportHeight);
    }, [scrollContainerRef]);

    React.useLayoutEffect(() => {
        const container = scrollContainerRef.current;
        const snapshot = paginationSnapshotRef.current;
        if (!container || !snapshot) return;

        const delta = container.scrollHeight - snapshot.scrollHeight;
        const nextScrollTop = snapshot.scrollTop + delta;
        container.scrollTop = nextScrollTop;
        paginationSnapshotRef.current = null;
        setScrollState((state) => {
            if (state.scrollTop === nextScrollTop) return state;
            return { ...state, scrollTop: nextScrollTop };
        });
    }, [displayMessages, scrollContainerRef]);

    return (
        <div
            ref={scrollContainerRef}
            onScroll={handleScroll}
            data-testid="message-scroll-container"
            className="flex-1 overflow-y-auto p-4"
        >
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
            <div
                style={{
                    height: totalHeight,
                    position: 'relative',
                }}
            >
                {virtualItems.map((virtualItem) => {
                    const msg = displayMessages[virtualItem.index];
                    if (!msg) return null;

                    return (
                        <VirtualizedMessageRow
                            key={msg.id}
                            message={msg}
                            start={virtualItem.start}
                            isLast={virtualItem.index === displayMessages.length - 1}
                            registerHeight={registerHeight}
                        >
                            <ChatMessage
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
                        </VirtualizedMessageRow>
                    );
                })}
            </div>
            {pendingQueue.length > 0 && (
                <div className="mt-4 space-y-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
                    <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-sm text-amber-200">
                            Несинхронизированные события ({pendingQueue.length})
                        </span>
                        <span className="text-[11px] text-amber-200/70">
                            Автоотправка при восстановлении связи
                        </span>
                    </div>
                    <ul className="space-y-1">
                        {pendingQueue.map((entry) => {
                            const timeLabel = entry.ts ? new Date(entry.ts).toLocaleTimeString() : null;
                            return (
                                <li key={entry.id} className="flex items-start justify-between gap-3">
                                    <div className="flex-1 min-w-0">
                                        <p className="text-xs text-amber-100 truncate">{renderQueueLabel(entry)}</p>
                                        <p className="text-[11px] text-amber-200/80 mt-1">
                                            Попыток: {entry.attempts}
                                            {timeLabel ? ` • ${timeLabel}` : ''}
                                        </p>
                                        {entry.error && (
                                            <p className="text-[11px] text-amber-300/90 mt-1 line-clamp-2">
                                                Ошибка: {entry.error}
                                            </p>
                                        )}
                                    </div>
                                    <div className="flex items-center gap-2 shrink-0">
                                        {onRetryPending && (
                                            <button
                                                type="button"
                                                onClick={() => onRetryPending(entry.id)}
                                                className="text-[11px] font-semibold uppercase tracking-wide text-amber-100/90 hover:text-amber-50"
                                            >
                                                Повторить
                                            </button>
                                        )}
                                        {onCancelPending && (
                                            <button
                                                type="button"
                                                onClick={() => onCancelPending(entry.id)}
                                                className="text-[11px] font-semibold uppercase tracking-wide text-amber-100/60 hover:text-amber-50"
                                            >
                                                Отменить
                                            </button>
                                        )}
                                    </div>
                                </li>
                            );
                        })}
                    </ul>
                </div>
            )}
        </div>
    );
};

export default MessageView;