import React, { useMemo, useState } from 'react';
import type { RoomMediaSummary, RoomMediaItem, SharedMediaCategory } from '../services/matrixService';

type SharedMediaPanelProps = {
    isOpen: boolean;
    onClose: () => void;
    data?: RoomMediaSummary | null;
    isLoading?: boolean;
    isPaginating?: boolean;
    onLoadMore?: () => void;
};

const TABS: Array<{ key: SharedMediaCategory; label: string }> = [
    { key: 'media', label: 'Медиа' },
    { key: 'files', label: 'Файлы' },
    { key: 'links', label: 'Ссылки' },
    { key: 'voice', label: 'Голосовые' },
];

const formatBytes = (bytes?: number) => {
    if (!bytes || Number.isNaN(bytes)) return '';
    const units = ['Б', 'КБ', 'МБ', 'ГБ'];
    let value = bytes;
    let unit = 0;
    while (value >= 1024 && unit < units.length - 1) {
        value /= 1024;
        unit += 1;
    }
    return `${value.toFixed(value >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`;
};

const formatTimestamp = (timestamp: number) => {
    try {
        return new Date(timestamp).toLocaleString();
    } catch (error) {
        console.warn('Failed to format timestamp', error);
        return '';
    }
};

const renderMediaPreview = (item: RoomMediaItem) => {
    if (item.thumbnailUrl || item.url) {
        return (
            <div className="h-16 w-16 rounded-md overflow-hidden bg-bg-tertiary flex items-center justify-center">
                <img
                    src={item.thumbnailUrl || item.url || undefined}
                    alt={item.body || 'preview'}
                    className="h-full w-full object-cover"
                    loading="lazy"
                />
            </div>
        );
    }
    return (
        <div className="h-16 w-16 rounded-md bg-bg-tertiary flex items-center justify-center text-2xl">🎞️</div>
    );
};

const renderFileIcon = (item: RoomMediaItem) => {
    if (item.thumbnailUrl) {
        return (
            <img
                src={item.thumbnailUrl}
                alt={item.body || 'file preview'}
                className="h-12 w-12 rounded-md object-cover"
                loading="lazy"
            />
        );
    }
    const icon = item.category === 'voice' ? '🎤' : '📄';
    return <span className="text-2xl">{icon}</span>;
};

const SharedMediaPanel: React.FC<SharedMediaPanelProps> = ({
    isOpen,
    onClose,
    data,
    isLoading = false,
    isPaginating = false,
    onLoadMore,
}) => {
    const [activeTab, setActiveTab] = useState<SharedMediaCategory>('media');

    const counts = data?.countsByCategory ?? { media: 0, files: 0, links: 0, voice: 0 };
    const items = data?.itemsByCategory ?? { media: [], files: [], links: [], voice: [] };

    const tabItems = useMemo(() => items[activeTab] ?? [], [items, activeTab]);

    if (!isOpen) {
        return null;
    }

    const renderItem = (item: RoomMediaItem) => {
        if (item.category === 'media') {
            return (
                <div key={item.eventId} className="flex items-center gap-3 p-3 rounded-lg bg-bg-secondary/60">
                    {renderMediaPreview(item)}
                    <div className="flex-1 min-w-0">
                        <p className="font-semibold text-sm text-text-primary truncate" title={item.body}>{item.body || 'Медиа'}</p>
                        <p className="text-xs text-text-secondary">
                            {formatTimestamp(item.timestamp)} • {item.senderName}
                        </p>
                    </div>
                    {item.url && (
                        <div className="flex flex-col gap-1">
                            <a
                                href={item.url}
                                target="_blank"
                                rel="noreferrer"
                                className="px-2 py-1 text-xs rounded-md bg-accent text-text-inverted text-center"
                            >
                                Открыть
                            </a>
                            <a
                                href={item.url}
                                download
                                className="px-2 py-1 text-xs rounded-md border border-border-primary text-text-secondary text-center hover:text-text-primary"
                            >
                                Скачать
                            </a>
                        </div>
                    )}
                </div>
            );
        }

        if (item.category === 'files') {
            return (
                <div key={item.eventId} className="flex items-center gap-3 p-3 rounded-lg bg-bg-secondary/60">
                    <div className="h-12 w-12 flex items-center justify-center bg-bg-tertiary rounded-md">
                        {renderFileIcon(item)}
                    </div>
                    <div className="flex-1 min-w-0">
                        <p className="font-semibold text-sm text-text-primary truncate" title={item.body}>{item.body || 'Файл'}</p>
                        <p className="text-xs text-text-secondary">
                            {formatTimestamp(item.timestamp)} • {formatBytes(item.size)}
                        </p>
                    </div>
                    {item.url && (
                        <div className="flex flex-col gap-1">
                            <a
                                href={item.url}
                                target="_blank"
                                rel="noreferrer"
                                className="px-2 py-1 text-xs rounded-md bg-accent text-text-inverted text-center"
                            >
                                Открыть
                            </a>
                            <a
                                href={item.url}
                                download
                                className="px-2 py-1 text-xs rounded-md border border-border-primary text-text-secondary text-center hover:text-text-primary"
                            >
                                Скачать
                            </a>
                        </div>
                    )}
                </div>
            );
        }

        if (item.category === 'links') {
            return (
                <div key={item.eventId} className="flex items-center gap-3 p-3 rounded-lg bg-bg-secondary/60">
                    <div className="h-12 w-12 flex items-center justify-center rounded-md bg-bg-tertiary text-2xl">🔗</div>
                    <div className="flex-1 min-w-0">
                        <p className="font-semibold text-sm text-text-primary truncate" title={item.linkUrl || item.url || undefined}>
                            {item.body || 'Ссылка'}
                        </p>
                        <p className="text-xs text-text-secondary truncate">
                            <a href={item.linkUrl || item.url || undefined} target="_blank" rel="noreferrer" className="hover:underline">
                                {item.linkUrl || item.url}
                            </a>
                        </p>
                    </div>
                </div>
            );
        }

        return (
            <div key={item.eventId} className="flex items-center gap-3 p-3 rounded-lg bg-bg-secondary/60">
                <div className="h-12 w-12 flex items-center justify-center rounded-md bg-bg-tertiary text-2xl">🎙️</div>
                <div className="flex-1 min-w-0">
                    <p className="font-semibold text-sm text-text-primary truncate" title={item.body}>{item.body || 'Голосовое сообщение'}</p>
                    <p className="text-xs text-text-secondary">
                        {formatTimestamp(item.timestamp)} • {item.senderName}
                    </p>
                </div>
                {item.url && (
                    <div className="flex flex-col gap-1">
                        <a
                            href={item.url}
                            target="_blank"
                            rel="noreferrer"
                            className="px-2 py-1 text-xs rounded-md bg-accent text-text-inverted text-center"
                        >
                            Открыть
                        </a>
                        <a
                            href={item.url}
                            download
                            className="px-2 py-1 text-xs rounded-md border border-border-primary text-text-secondary text-center hover:text-text-primary"
                        >
                            Скачать
                        </a>
                    </div>
                )}
            </div>
        );
    };

    return (
        <div className="fixed inset-0 z-40 flex">
            <div className="flex-1 bg-black/30" onClick={onClose} role="presentation" />
            <aside className="w-full max-w-md bg-bg-primary h-full shadow-xl flex flex-col" aria-label="Shared media panel">
                <div className="flex items-center justify-between px-4 py-3 border-b border-border-primary">
                    <h2 className="text-lg font-semibold text-text-primary">Shared media</h2>
                    <button
                        onClick={onClose}
                        className="p-2 rounded-full hover:bg-bg-tertiary"
                        aria-label="Close shared media"
                    >
                        ✕
                    </button>
                </div>
                <div className="px-4 pt-4 flex gap-2">
                    {TABS.map(tab => (
                        <button
                            key={tab.key}
                            type="button"
                            onClick={() => setActiveTab(tab.key)}
                            className={`px-3 py-1.5 rounded-full text-sm transition ${
                                activeTab === tab.key
                                    ? 'bg-accent text-text-inverted'
                                    : 'bg-bg-tertiary text-text-secondary hover:text-text-primary'
                            }`}
                        >
                            {tab.label}
                            <span className="ml-2 text-xs font-semibold">{counts[tab.key]}</span>
                        </button>
                    ))}
                </div>
                <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3" data-testid="shared-media-items">
                    {isLoading ? (
                        <p className="text-text-secondary text-sm">Загрузка вложений…</p>
                    ) : tabItems.length === 0 ? (
                        <p className="text-text-secondary text-sm">Нет элементов в этой категории.</p>
                    ) : (
                        tabItems.map(renderItem)
                    )}
                </div>
                <div className="px-4 py-3 border-t border-border-primary flex items-center justify-between">
                    <p className="text-xs text-text-secondary">
                        {isPaginating ? 'Загружаем ещё…' : data?.hasMore ? 'Можно загрузить больше вложений.' : 'Все вложения загружены.'}
                    </p>
                    {onLoadMore && data?.hasMore && (
                        <button
                            type="button"
                            onClick={onLoadMore}
                            disabled={isPaginating}
                            className="px-3 py-1.5 rounded-md bg-accent text-text-inverted text-sm disabled:opacity-50"
                        >
                            {isPaginating ? 'Загрузка…' : 'Загрузить ещё'}
                        </button>
                    )}
                </div>
            </aside>
        </div>
    );
};

export default SharedMediaPanel;
