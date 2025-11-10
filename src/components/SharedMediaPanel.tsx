import React, {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
} from 'react';
import type { RoomMediaSummary, RoomMediaItem, SharedMediaCategory } from '../services/matrixService';

type SharedMediaPanelProps = {
    isOpen: boolean;
    onClose: () => void;
    data?: RoomMediaSummary | null;
    isLoading?: boolean;
    isPaginating?: boolean;
    onLoadMore?: () => void;
    currentUserId?: string;
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
    currentUserId,
}) => {
    const [activeTab, setActiveTab] = useState<SharedMediaCategory>('media');
    const [searchValue, setSearchValue] = useState('');
    const [debouncedSearch, setDebouncedSearch] = useState('');
    const [selectedSender, setSelectedSender] = useState<string>('all');
    const [dateFrom, setDateFrom] = useState('');
    const [dateTo, setDateTo] = useState('');
    const [onlyMine, setOnlyMine] = useState(false);
    const [onlyDocuments, setOnlyDocuments] = useState(false);
    const [focusedIndex, setFocusedIndex] = useState(0);

    const listContainerRef = useRef<HTMLDivElement | null>(null);
    const itemRefs = useRef<Array<HTMLDivElement | null>>([]);
    const sectionRefs = useRef<Record<string, HTMLDivElement | null>>({});

    const counts = data?.countsByCategory ?? { media: 0, files: 0, links: 0, voice: 0 };
    const items = data?.itemsByCategory ?? { media: [], files: [], links: [], voice: [] };

    const tabItems = useMemo(() => items[activeTab] ?? [], [items, activeTab]);

    const availableSenders = useMemo(() => {
        const unique = new Map<string, string>();
        items[activeTab]?.forEach(item => {
            unique.set(item.senderId, item.senderName || item.senderId);
        });
        return Array.from(unique.entries()).map(([id, name]) => ({ id, name }));
    }, [items, activeTab]);

    useEffect(() => {
        const handler = window.setTimeout(() => {
            setDebouncedSearch(searchValue.trim().toLowerCase());
        }, 300);
        return () => window.clearTimeout(handler);
    }, [searchValue]);

    const isFiltered = useMemo(
        () =>
            Boolean(
                debouncedSearch ||
                    (selectedSender !== 'all' && selectedSender) ||
                    dateFrom ||
                    dateTo ||
                    onlyMine ||
                    onlyDocuments,
            ),
        [debouncedSearch, selectedSender, dateFrom, dateTo, onlyMine, onlyDocuments],
    );

    const filteredTabItems = useMemo(() => {
        const fromTs = dateFrom ? new Date(dateFrom).setHours(0, 0, 0, 0) : undefined;
        const toTs = dateTo ? new Date(dateTo).setHours(23, 59, 59, 999) : undefined;

        const filtered = tabItems.filter(item => {
            if (debouncedSearch) {
                const haystack = [item.body, item.senderName, item.linkUrl, item.url]
                    .filter(Boolean)
                    .join(' ')
                    .toLowerCase();
                if (!haystack.includes(debouncedSearch)) {
                    return false;
                }
            }

            if (selectedSender !== 'all' && item.senderId !== selectedSender) {
                return false;
            }

            if (fromTs && item.timestamp < fromTs) {
                return false;
            }

            if (toTs && item.timestamp > toTs) {
                return false;
            }

            if (onlyMine && currentUserId && item.senderId !== currentUserId) {
                return false;
            }

            if (onlyMine && !currentUserId) {
                return false;
            }

            if (onlyDocuments) {
                if (item.category !== 'files' && item.eventType !== 'm.file') {
                    return false;
                }
            }

            return true;
        });

        return filtered.sort((a, b) => b.timestamp - a.timestamp);
    }, [
        tabItems,
        debouncedSearch,
        selectedSender,
        dateFrom,
        dateTo,
        onlyMine,
        currentUserId,
        onlyDocuments,
    ]);

    const groupedItems = useMemo(() => {
        const groups = filteredTabItems.reduce<Record<string, { items: RoomMediaItem[]; date: Date }>>(
            (acc, item) => {
                const date = new Date(item.timestamp);
                const key = `${date.getFullYear()}-${date.getMonth()}`;
                if (!acc[key]) {
                    acc[key] = { items: [], date };
                }
                acc[key].items.push(item);
                return acc;
            },
            {},
        );

        return Object.entries(groups)
            .map(([key, value]) => ({
                key,
                label: value.date.toLocaleDateString(undefined, {
                    month: 'long',
                    year: 'numeric',
                }),
                items: value.items.sort((a, b) => b.timestamp - a.timestamp),
                sortKey: value.date.getTime(),
            }))
            .sort((a, b) => b.sortKey - a.sortKey);
    }, [filteredTabItems]);

    useEffect(() => {
        setFocusedIndex(0);
        itemRefs.current = [];
    }, [groupedItems, activeTab]);

    useEffect(() => {
        const current = itemRefs.current[focusedIndex];
        if (current) {
            current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
    }, [focusedIndex, groupedItems]);

    const handleOpenItem = useCallback((item: RoomMediaItem) => {
        const targetUrl = item.url || item.linkUrl;
        if (targetUrl) {
            window.open(targetUrl, '_blank', 'noopener,noreferrer');
        }
    }, []);

    const handleKeyDown: React.KeyboardEventHandler<HTMLDivElement> = useCallback(
        event => {
            const tagName = (event.target as HTMLElement)?.tagName;
            if (tagName === 'INPUT' || tagName === 'SELECT' || tagName === 'TEXTAREA') {
                return;
            }

            const totalItems = filteredTabItems.length;
            if (!totalItems) {
                return;
            }

            if (event.key === 'ArrowDown') {
                event.preventDefault();
                setFocusedIndex(prev => Math.min(prev + 1, totalItems - 1));
            } else if (event.key === 'ArrowUp') {
                event.preventDefault();
                setFocusedIndex(prev => Math.max(prev - 1, 0));
            } else if (event.key === 'Enter') {
                event.preventDefault();
                const item = filteredTabItems[focusedIndex];
                if (item) {
                    handleOpenItem(item);
                }
            }
        },
        [filteredTabItems, focusedIndex, handleOpenItem],
    );

    const handleTimelineClick = useCallback((key: string) => {
        const section = sectionRefs.current[key];
        if (section) {
            section.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    }, []);

    if (!isOpen) {
        return null;
    }

    let renderIndex = -1;

    const renderItem = (item: RoomMediaItem) => {
        renderIndex += 1;
        const index = renderIndex;
        const isFocused = index === focusedIndex;

        if (item.category === 'media') {
            return (
                <div
                    key={item.eventId}
                    ref={el => {
                        itemRefs.current[index] = el;
                    }}
                    className={`flex items-center gap-3 p-3 rounded-lg bg-bg-secondary/60 transition focus:outline-none ${
                        isFocused ? 'ring-2 ring-accent' : ''
                    }`}
                    role="listitem"
                    onMouseEnter={() => setFocusedIndex(index)}
                >
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
                <div
                    key={item.eventId}
                    ref={el => {
                        itemRefs.current[index] = el;
                    }}
                    className={`flex items-center gap-3 p-3 rounded-lg bg-bg-secondary/60 transition focus:outline-none ${
                        isFocused ? 'ring-2 ring-accent' : ''
                    }`}
                    role="listitem"
                    onMouseEnter={() => setFocusedIndex(index)}
                >
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
                <div
                    key={item.eventId}
                    ref={el => {
                        itemRefs.current[index] = el;
                    }}
                    className={`flex items-center gap-3 p-3 rounded-lg bg-bg-secondary/60 transition focus:outline-none ${
                        isFocused ? 'ring-2 ring-accent' : ''
                    }`}
                    role="listitem"
                    onMouseEnter={() => setFocusedIndex(index)}
                >
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
            <div
                key={item.eventId}
                ref={el => {
                    itemRefs.current[index] = el;
                }}
                className={`flex items-center gap-3 p-3 rounded-lg bg-bg-secondary/60 transition focus:outline-none ${
                    isFocused ? 'ring-2 ring-accent' : ''
                }`}
                role="listitem"
                onMouseEnter={() => setFocusedIndex(index)}
            >
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
            <aside
                className="w-full max-w-2xl bg-bg-primary h-full shadow-xl flex flex-col"
                aria-label="Shared media panel"
                onKeyDown={handleKeyDown}
            >
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
                <div className="px-4 py-4 space-y-3 border-t border-border-primary/60">
                    <div className="flex flex-col gap-3">
                        <input
                            type="search"
                            value={searchValue}
                            onChange={event => setSearchValue(event.target.value)}
                            placeholder="Поиск по названию, ссылке или отправителю"
                            className="w-full rounded-md border border-border-primary bg-bg-secondary px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-accent"
                            aria-label="Поиск по вложениям"
                        />
                        <div className="flex flex-wrap gap-3 text-sm">
                            <label className="flex items-center gap-2">
                                <span className="text-text-secondary">Отправитель</span>
                                <select
                                    value={selectedSender}
                                    onChange={event => setSelectedSender(event.target.value)}
                                    className="rounded-md border border-border-primary bg-bg-secondary px-2 py-1 text-text-primary focus:outline-none focus:ring-1 focus:ring-accent"
                                >
                                    <option value="all">Все</option>
                                    {availableSenders.map(sender => (
                                        <option key={sender.id} value={sender.id}>
                                            {sender.name}
                                        </option>
                                    ))}
                                </select>
                            </label>
                            <label className="flex items-center gap-2">
                                <span className="text-text-secondary whitespace-nowrap">С даты</span>
                                <input
                                    type="date"
                                    value={dateFrom}
                                    onChange={event => setDateFrom(event.target.value)}
                                    className="rounded-md border border-border-primary bg-bg-secondary px-2 py-1 text-text-primary focus:outline-none focus:ring-1 focus:ring-accent"
                                />
                            </label>
                            <label className="flex items-center gap-2">
                                <span className="text-text-secondary whitespace-nowrap">По дату</span>
                                <input
                                    type="date"
                                    value={dateTo}
                                    onChange={event => setDateTo(event.target.value)}
                                    className="rounded-md border border-border-primary bg-bg-secondary px-2 py-1 text-text-primary focus:outline-none focus:ring-1 focus:ring-accent"
                                />
                            </label>
                        </div>
                        <div className="flex flex-wrap gap-2 text-xs">
                            <button
                                type="button"
                                onClick={() => setOnlyMine(prev => !prev)}
                                className={`rounded-full border px-3 py-1 transition ${
                                    onlyMine
                                        ? 'bg-accent text-text-inverted border-accent'
                                        : 'border-border-primary text-text-secondary hover:text-text-primary'
                                }`}
                                disabled={!currentUserId}
                            >
                                Только мои
                            </button>
                            <button
                                type="button"
                                onClick={() => setOnlyDocuments(prev => !prev)}
                                className={`rounded-full border px-3 py-1 transition ${
                                    onlyDocuments
                                        ? 'bg-accent text-text-inverted border-accent'
                                        : 'border-border-primary text-text-secondary hover:text-text-primary'
                                }`}
                            >
                                Только документы
                            </button>
                            {(isFiltered || searchValue) && (
                                <button
                                    type="button"
                                    onClick={() => {
                                        setSearchValue('');
                                        setSelectedSender('all');
                                        setDateFrom('');
                                        setDateTo('');
                                        setOnlyMine(false);
                                        setOnlyDocuments(false);
                                    }}
                                    className="rounded-full border border-border-primary px-3 py-1 text-text-secondary hover:text-text-primary"
                                >
                                    Сбросить фильтры
                                </button>
                            )}
                        </div>
                    </div>
                </div>
                <div className="flex-1 flex overflow-hidden" data-testid="shared-media-items">
                    <div
                        className="flex-1 overflow-y-auto px-4 py-4 space-y-6"
                        ref={listContainerRef}
                        role="list"
                        aria-label="Список вложений"
                        tabIndex={0}
                    >
                        {isLoading ? (
                            <p className="text-text-secondary text-sm">Загрузка вложений…</p>
                        ) : tabItems.length === 0 ? (
                            <p className="text-text-secondary text-sm">Нет элементов в этой категории.</p>
                        ) : filteredTabItems.length === 0 ? (
                            <div className="text-text-secondary text-sm space-y-2">
                                <p>Ничего не найдено.</p>
                                {isFiltered && data?.hasMore && (
                                    <p>Есть ещё вложения без учёта фильтров. Очистите фильтры, чтобы загрузить больше.</p>
                                )}
                            </div>
                        ) : (
                            groupedItems.map(group => (
                                <section
                                    key={group.key}
                                    ref={el => {
                                        sectionRefs.current[group.key] = el;
                                    }}
                                    className="space-y-3"
                                >
                                    <h3 className="text-xs uppercase tracking-wide text-text-secondary">{group.label}</h3>
                                    <div className="space-y-3">
                                        {group.items.map(renderItem)}
                                    </div>
                                </section>
                            ))
                        )}
                    </div>
                    {groupedItems.length > 1 && filteredTabItems.length > 0 && (
                        <nav className="w-24 border-l border-border-primary/60 px-2 py-4 overflow-y-auto text-xs text-text-secondary">
                            <p className="mb-2 font-semibold text-text-primary">Таймлайн</p>
                            <ul className="space-y-1">
                                {groupedItems.map(group => (
                                    <li key={`timeline-${group.key}`}>
                                        <button
                                            type="button"
                                            className="w-full text-left rounded-md px-2 py-1 hover:bg-bg-tertiary focus:outline-none focus:ring-1 focus:ring-accent"
                                            onClick={() => handleTimelineClick(group.key)}
                                        >
                                            {group.label}
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        </nav>
                    )}
                </div>
                </div>
                <div className="px-4 py-3 border-t border-border-primary flex items-center justify-between">
                    <p className="text-xs text-text-secondary">
                        {isLoading
                            ? 'Загрузка вложений…'
                            : isFiltered
                            ? filteredTabItems.length === 0
                                ? data?.hasMore
                                    ? 'Очистите фильтры, чтобы загрузить больше вложений.'
                                    : 'Ничего не найдено.'
                                : 'Показаны результаты с учётом фильтров.'
                            : isPaginating
                            ? 'Загружаем ещё…'
                            : data?.hasMore
                            ? 'Можно загрузить больше вложений.'
                            : 'Все вложения загружены.'}
                    </p>
                    {!isFiltered && onLoadMore && data?.hasMore && (
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
