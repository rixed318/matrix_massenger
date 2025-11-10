import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { MatrixClient, Story } from '@matrix-messenger/core';
import { mxcToHttp } from '@matrix-messenger/core';

interface StoryViewerProps {
    client: MatrixClient;
    stories: Story[];
    initialIndex?: number;
    onClose: () => void;
    onStorySeen?: (storyId: string) => void;
    onReact?: (storyId: string, emoji: string) => void;
    onRequestNext?: () => void;
    onRequestPrevious?: () => void;
}

const DEFAULT_REACTIONS = ['❤️', '👍', '🔥', '😂', '😮'];

const formatTimestamp = (value: number): string => {
    const diff = Date.now() - value;
    const minutes = Math.round(diff / 60000);
    if (minutes < 1) {
        return 'только что';
    }
    if (minutes < 60) {
        return `${minutes} мин назад`;
    }
    const hours = Math.round(minutes / 60);
    if (hours < 24) {
        return `${hours} ч назад`;
    }
    const days = Math.round(hours / 24);
    if (days < 7) {
        return `${days} дн назад`;
    }
    return new Date(value).toLocaleString();
};

const StoryViewer: React.FC<StoryViewerProps> = ({
    client,
    stories,
    initialIndex = 0,
    onClose,
    onStorySeen,
    onReact,
    onRequestNext,
    onRequestPrevious,
}) => {
    const [currentIndex, setCurrentIndex] = useState(() => Math.min(initialIndex, Math.max(stories.length - 1, 0)));

    useEffect(() => {
        setCurrentIndex(Math.min(initialIndex, Math.max(stories.length - 1, 0)));
    }, [initialIndex, stories]);

    const currentStory = stories[currentIndex];

    useEffect(() => {
        if (!currentStory) {
            return;
        }
        onStorySeen?.(currentStory.id);
    }, [currentStory, onStorySeen]);

    const mediaUrl = useMemo(() => {
        if (!currentStory) {
            return null;
        }
        const source = currentStory.media.mxcUrl;
        return source ? mxcToHttp(client, source) : null;
    }, [client, currentStory]);

    const thumbnailUrl = useMemo(() => {
        if (!currentStory) {
            return null;
        }
        const source = currentStory.media.thumbnailMxcUrl;
        return source ? mxcToHttp(client, source, 512) : null;
    }, [client, currentStory]);

    const handleNext = useCallback(() => {
        setCurrentIndex(prev => {
            if (prev < stories.length - 1) {
                return prev + 1;
            }
            if (onRequestNext) {
                onRequestNext();
            } else {
                onClose();
            }
            return prev;
        });
    }, [stories.length, onRequestNext, onClose]);

    const handlePrevious = useCallback(() => {
        setCurrentIndex(prev => {
            if (prev > 0) {
                return prev - 1;
            }
            if (onRequestPrevious) {
                onRequestPrevious();
            } else {
                onClose();
            }
            return prev;
        });
    }, [onRequestPrevious, onClose]);

    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                onClose();
            } else if (event.key === 'ArrowRight') {
                handleNext();
            } else if (event.key === 'ArrowLeft') {
                handlePrevious();
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [handleNext, handlePrevious, onClose]);

    if (!currentStory) {
        return null;
    }

    const reactionButtons = [...currentStory.reactions].sort((a, b) => b.count - a.count);

    const displayUrl = currentStory.media.kind === 'image' ? (mediaUrl ?? thumbnailUrl) : mediaUrl;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur">
            <div className="relative w-full max-w-2xl overflow-hidden rounded-2xl bg-neutral-900 shadow-2xl">
                <button
                    type="button"
                    onClick={onClose}
                    className="absolute right-4 top-4 z-20 rounded-full bg-black/40 p-2 text-white hover:bg-black/60 focus:outline-none"
                    aria-label="Закрыть сторис"
                >
                    ×
                </button>
                <div className="relative aspect-[9/16] w-full bg-neutral-800">
                    {displayUrl && currentStory.media.kind === 'image' && (
                        <img src={displayUrl} alt={currentStory.caption ?? 'story'} className="h-full w-full object-cover" />
                    )}
                    {displayUrl && currentStory.media.kind === 'video' && (
                        <video
                            key={currentStory.id}
                            src={displayUrl}
                            className="h-full w-full object-contain"
                            controls
                            autoPlay
                            playsInline
                        >
                            {thumbnailUrl ? <track kind="captions" src={thumbnailUrl} /> : null}
                        </video>
                    )}
                    {!displayUrl && (
                        <div className="flex h-full w-full items-center justify-center text-white/60">
                            Медиа недоступна
                        </div>
                    )}
                    <div className="absolute inset-x-0 top-0 flex h-1 gap-1 p-4">
                        {stories.map((story, index) => (
                            <span
                                key={story.id}
                                className="flex-1 overflow-hidden rounded-full bg-white/20"
                            >
                                <span
                                    className={`block h-full rounded-full ${index <= currentIndex ? 'bg-white' : 'bg-transparent'}`}
                                    style={{ width: index < currentIndex ? '100%' : index === currentIndex ? '100%' : undefined }}
                                />
                            </span>
                        ))}
                    </div>
                    <div className="absolute inset-y-0 left-0 w-1/3 cursor-pointer" onClick={handlePrevious} aria-hidden="true" />
                    <div className="absolute inset-y-0 right-0 w-1/3 cursor-pointer" onClick={handleNext} aria-hidden="true" />
                </div>
                <div className="space-y-4 p-6 text-white/90">
                    <div className="flex items-start justify-between">
                        <div>
                            <div className="text-sm font-semibold text-white">
                                {currentStory.authorDisplayName || currentStory.authorId}
                            </div>
                            <div className="text-xs text-white/60">{formatTimestamp(currentStory.createdAt)}</div>
                        </div>
                        <div className="text-xs text-white/60">Просмотры: {currentStory.seenCount}</div>
                    </div>
                    {currentStory.caption && (
                        <p className="whitespace-pre-line text-sm text-white/90">{currentStory.caption}</p>
                    )}
                    <div className="flex flex-wrap gap-2">
                        {reactionButtons.map(reaction => (
                            <button
                                key={reaction.key}
                                type="button"
                                onClick={() => onReact?.(currentStory.id, reaction.key)}
                                className={`flex items-center gap-2 rounded-full border px-3 py-1 text-sm transition ${reaction.selfReacted ? 'border-indigo-400 bg-indigo-500/20 text-indigo-200' : 'border-white/10 bg-white/5 text-white/80 hover:bg-white/10'}`}
                            >
                                <span>{reaction.key}</span>
                                <span className="text-xs">{reaction.count}</span>
                            </button>
                        ))}
                    </div>
                    <div className="flex flex-wrap gap-2">
                        {DEFAULT_REACTIONS.map(emoji => (
                            <button
                                key={emoji}
                                type="button"
                                onClick={() => onReact?.(currentStory.id, emoji)}
                                className="rounded-full bg-white/10 px-3 py-1 text-sm text-white/80 transition hover:bg-white/20"
                            >
                                {emoji}
                            </button>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default StoryViewer;
