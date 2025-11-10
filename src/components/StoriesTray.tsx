import React, { useMemo } from 'react';
import type { MatrixClient, Story } from '@matrix-messenger/core';
import { mxcToHttp } from '@matrix-messenger/core';

interface StoriesTrayProps {
    client: MatrixClient;
    stories: Story[];
    onSelect: (authorId: string, storyIndex: number) => void;
}

const getInitials = (displayName?: string, userId?: string): string => {
    const source = displayName || userId || '';
    if (!source) {
        return '?';
    }
    const parts = source.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
    if (parts.length === 0) {
        return source.slice(0, 2).toUpperCase();
    }
    if (parts.length === 1) {
        return parts[0].slice(0, 2).toUpperCase();
    }
    return `${parts[0][0] ?? ''}${parts[1][0] ?? ''}`.toUpperCase();
};

const StoriesTray: React.FC<StoriesTrayProps> = ({ client, stories, onSelect }) => {
    const grouped = useMemo(() => {
        const map = new Map<string, { authorId: string; authorDisplayName?: string; stories: Story[] }>();
        stories.forEach(story => {
            const entry = map.get(story.authorId);
            if (entry) {
                entry.stories.push(story);
                if (!entry.authorDisplayName && story.authorDisplayName) {
                    entry.authorDisplayName = story.authorDisplayName;
                }
            } else {
                map.set(story.authorId, {
                    authorId: story.authorId,
                    authorDisplayName: story.authorDisplayName,
                    stories: [story],
                });
            }
        });
        return Array.from(map.values())
            .map(group => ({
                ...group,
                stories: [...group.stories].sort((a, b) => b.createdAt - a.createdAt),
            }))
            .sort((a, b) => (b.stories[0]?.createdAt ?? 0) - (a.stories[0]?.createdAt ?? 0));
    }, [stories]);

    if (grouped.length === 0) {
        return null;
    }

    return (
        <div className="flex items-center gap-4 overflow-x-auto px-6 py-4 border-b border-white/5 backdrop-blur-sm bg-black/20">
            {grouped.map(group => {
                const latest = group.stories[0];
                const previewMxc = latest.media.thumbnailMxcUrl ?? latest.media.mxcUrl;
                const previewUrl = previewMxc ? mxcToHttp(client, previewMxc, 256) : null;
                const hasUnseen = group.stories.some(story => !story.hasSeen);
                const label = group.authorDisplayName || group.authorId.replace(/^@/, '');
                const initials = getInitials(group.authorDisplayName, group.authorId);
                return (
                    <button
                        type="button"
                        key={group.authorId}
                        onClick={() => onSelect(group.authorId, 0)}
                        className="flex flex-col items-center gap-2 focus:outline-none"
                        title={label}
                    >
                        <div
                            className={`p-0.5 rounded-full ${hasUnseen ? 'bg-gradient-to-r from-indigo-400 via-purple-400 to-pink-400' : 'bg-white/20'}`}
                        >
                            <div className="h-16 w-16 rounded-full overflow-hidden bg-white/10 flex items-center justify-center">
                                {previewUrl ? (
                                    <img src={previewUrl} alt={label} className="h-full w-full object-cover" />
                                ) : (
                                    <span className="text-sm font-semibold text-white/80">{initials}</span>
                                )}
                            </div>
                        </div>
                        <span className="max-w-[96px] truncate text-xs text-white/70">{label}</span>
                    </button>
                );
            })}
        </div>
    );
};

export default StoriesTray;
