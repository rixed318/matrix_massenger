import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { searchMessages } from '@matrix-messenger/core';
import type { MatrixClient, Room, SearchMessagesResponse, SearchResultItem } from '@matrix-messenger/core';
import type { SearchKey } from 'matrix-js-sdk';
import { useAccountStore } from '../services/accountManager';
import type { UnifiedRoomSummary } from '../utils/chatSelectors';
import {
    searchUniversalMessages,
    type UniversalSearchCursor,
    type UniversalSearchResultItem,
} from '../services/universalSearchService';

interface SearchModalProps {
    isOpen: boolean;
    onClose: () => void;
    client: MatrixClient;
    rooms: Room[];
    onSelectResult: (result: SearchResultItem) => Promise<void> | void;
}

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const DEFAULT_KEYS = ['content.body'] as SearchKey[];

const MESSAGE_TYPE_OPTIONS = [
    { value: 'm.room.message', label: 'Сообщения' },
    { value: 'm.sticker', label: 'Стикеры' },
    { value: 'm.room.encrypted', label: 'Зашифрованные события' },
];

const KEY_OPTIONS: { value: SearchKey; label: string }[] = [
    { value: 'content.body' as SearchKey, label: 'Текст сообщения' },
    { value: 'content.msgtype' as SearchKey, label: 'Тип контента' },
    { value: 'sender' as SearchKey, label: 'Отправитель' },
];

interface AppliedFilters {
    roomId?: string;
    senders: string[];
    messageTypes: string[];
    hasMedia: boolean;
    dateFrom?: string;
    dateTo?: string;
    keys: SearchKey[];
    accountLabel?: string;
}

const createInitialAppliedFilters = (): AppliedFilters => ({
    roomId: undefined,
    senders: [],
    messageTypes: [],
    hasMedia: false,
    dateFrom: undefined,
    dateTo: undefined,
    keys: [...DEFAULT_KEYS],
});

const normalizeDateInputValue = (value?: string | number | Date): string | undefined => {
    if (value === undefined || value === null) return undefined;
    if (value instanceof Date) {
        return Number.isNaN(value.getTime()) ? undefined : value.toISOString().slice(0, 10);
    }
    if (typeof value === 'number') {
        const date = new Date(value);
        return Number.isNaN(date.getTime()) ? undefined : date.toISOString().slice(0, 10);
    }
    return value;
};

const deriveHomeserverName = (userId: string, homeserverUrl: string): string => {
    const [, domain] = userId.split(':');
    if (domain) {
        return domain;
    }
    try {
        const url = new URL(homeserverUrl);
        return url.hostname;
    } catch {
        return homeserverUrl.replace(/^https?:\/\//, '').replace(/\/+$/, '');
    }
};

type SearchOverride = Partial<{
    roomId?: string;
    keys?: SearchKey[];
    senders?: string[];
    messageTypes?: string[];
    dateRange?: { from?: string | number | Date; to?: string | number | Date };
    hasMedia?: boolean | undefined;
}>;

const SearchModal: React.FC<SearchModalProps> = ({ isOpen, onClose, client, rooms, onSelectResult }) => {
    const [query, setQuery] = useState('');
    const [results, setResults] = useState<UniversalSearchResultItem[]>([]);
    const [highlights, setHighlights] = useState<string[]>([]);
    const [nextBatch, setNextBatch] = useState<string | undefined>();
    const [universalCursor, setUniversalCursor] = useState<UniversalSearchCursor | null>(null);
    const [hasMoreUniversal, setHasMoreUniversal] = useState(false);
    const [isSearching, setIsSearching] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [selectedIndex, setSelectedIndex] = useState(0);
    const [activeResultId, setActiveResultId] = useState<string | null>(null);
    const [selectedRoomId, setSelectedRoomId] = useState('');
    const [selectedSenders, setSelectedSenders] = useState<string[]>([]);
    const [senderInput, setSenderInput] = useState('');
    const [selectedMessageTypes, setSelectedMessageTypes] = useState<string[]>([]);
    const [hasMediaOnly, setHasMediaOnly] = useState(false);
    const [dateFrom, setDateFrom] = useState('');
    const [dateTo, setDateTo] = useState('');
    const [selectedKeys, setSelectedKeys] = useState<SearchKey[]>(() => [...DEFAULT_KEYS]);
    const [appliedFilters, setAppliedFilters] = useState<AppliedFilters>(() => createInitialAppliedFilters());
    const inputRef = useRef<HTMLInputElement>(null);

    const [universalMode, aggregatedRooms, accountState] = useAccountStore(state => [
        state.universalMode,
        state.aggregatedRooms,
        state.accounts,
    ]);

    const isUniversal = universalMode === 'all';

    const activeAccountMetadata = useMemo(() => {
        const runtime = Object.values(accountState).find(entry => entry.client === client);
        if (!runtime) {
            return null;
        }

        return {
            accountKey: runtime.creds.key,
            accountUserId: runtime.creds.user_id,
            accountDisplayName: runtime.displayName ?? runtime.creds.user_id,
            accountAvatarUrl: runtime.avatarUrl ?? null,
            homeserverName: deriveHomeserverName(runtime.creds.user_id, runtime.creds.homeserver_url),
        };
    }, [accountState, client]);

    const resetFilterSelections = useCallback(() => {
        setSelectedRoomId('');
        setSelectedSenders([]);
        setSenderInput('');
        setSelectedMessageTypes([]);
        setHasMediaOnly(false);
        setDateFrom('');
        setDateTo('');
        setSelectedKeys([...DEFAULT_KEYS]);
        setUniversalCursor(null);
        setHasMoreUniversal(false);
    }, []);

    useEffect(() => {
        if (!isOpen) {
            setQuery('');
            setResults([]);
            setHighlights([]);
            setNextBatch(undefined);
            setUniversalCursor(null);
            setHasMoreUniversal(false);
            setSelectedIndex(0);
            setError(null);
            setActiveResultId(null);
            resetFilterSelections();
            setAppliedFilters(createInitialAppliedFilters());
            return;
        }

        const timer = setTimeout(() => inputRef.current?.focus(), 50);
        return () => clearTimeout(timer);
    }, [isOpen, resetFilterSelections]);

    useEffect(() => {
        if (!isOpen) return;
        const handleKeydown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                onClose();
            }
        };
        window.addEventListener('keydown', handleKeydown);
        return () => window.removeEventListener('keydown', handleKeydown);
    }, [isOpen, onClose]);

    const handleSearch = async (append = false, overrides: SearchOverride = {}) => {
        const trimmed = query.trim();
        if (!trimmed) {
            setResults([]);
            setHighlights([]);
            setNextBatch(undefined);
            setUniversalCursor(null);
            setHasMoreUniversal(false);
            setError(null);
            setAppliedFilters(createInitialAppliedFilters());
            return;
        }

        const roomIdCandidate = 'roomId' in overrides ? overrides.roomId : (selectedRoomId || undefined);
        const keysCandidate = 'keys' in overrides ? overrides.keys : selectedKeys;
        const sendersCandidate = 'senders' in overrides ? overrides.senders : selectedSenders;
        const messageTypesCandidate = 'messageTypes' in overrides ? overrides.messageTypes : selectedMessageTypes;
        const dateRangeCandidate = 'dateRange' in overrides
            ? overrides.dateRange
            : (dateFrom || dateTo ? { from: dateFrom, to: dateTo } : undefined);
        const hasMediaCandidate = 'hasMedia' in overrides ? overrides.hasMedia : (hasMediaOnly ? true : undefined);
        const effectiveKeys = keysCandidate && keysCandidate.length > 0 ? keysCandidate : DEFAULT_KEYS;
        const sendersFilter = Array.isArray(sendersCandidate) && sendersCandidate.length > 0 ? sendersCandidate : undefined;
        const messageTypesFilter = Array.isArray(messageTypesCandidate) && messageTypesCandidate.length > 0 ? messageTypesCandidate : undefined;
        const selectedUniversalRoom = isUniversal && roomIdCandidate
            ? aggregatedRooms.find(room => room.compositeId === roomIdCandidate)
            : undefined;
        const actualRoomId = isUniversal ? selectedUniversalRoom?.roomId : roomIdCandidate || undefined;
        const includedAccounts = isUniversal && selectedUniversalRoom ? [selectedUniversalRoom.accountKey] : undefined;

        setIsSearching(true);
        setError(null);
        try {
            if (isUniversal) {
                const response = await searchUniversalMessages({
                    searchTerm: trimmed,
                    roomId: actualRoomId,
                    keys: effectiveKeys,
                    senders: sendersFilter,
                    messageTypes: messageTypesFilter,
                    dateRange: dateRangeCandidate,
                    hasMedia: hasMediaCandidate,
                    cursor: append ? universalCursor : null,
                    includedAccountKeys: includedAccounts,
                });

                setHighlights(response.highlights);
                setUniversalCursor(response.cursor ?? null);
                setHasMoreUniversal(Boolean(response.cursor));
                setResults(prev => (append ? [...prev, ...response.results] : response.results));
                setNextBatch(undefined);
            } else {
                const response: SearchMessagesResponse = await searchMessages(client, {
                    searchTerm: trimmed,
                    nextBatch: append ? nextBatch : undefined,
                    roomId: actualRoomId,
                    keys: effectiveKeys,
                    senders: sendersFilter,
                    messageTypes: messageTypesFilter,
                    dateRange: dateRangeCandidate,
                    hasMedia: hasMediaCandidate,
                });

                const decorated = response.results.map(item =>
                    activeAccountMetadata
                        ? {
                            ...item,
                            accountKey: activeAccountMetadata.accountKey,
                            accountUserId: activeAccountMetadata.accountUserId,
                            accountDisplayName: activeAccountMetadata.accountDisplayName,
                            accountAvatarUrl: activeAccountMetadata.accountAvatarUrl,
                            homeserverName: activeAccountMetadata.homeserverName,
                        } satisfies UniversalSearchResultItem
                        : ({
                            ...item,
                            accountKey: 'local',
                            accountUserId: client.getUserId?.() ?? 'unknown',
                            accountDisplayName: client.getUserId?.() ?? 'unknown',
                            accountAvatarUrl: null,
                            homeserverName: client.getUserId?.()?.split(':')[1] ?? '',
                        } as UniversalSearchResultItem),
                );

                setHighlights(response.highlights);
                setNextBatch(response.nextBatch);
                setHasMoreUniversal(Boolean(response.nextBatch));
                setResults(prev => (append ? [...prev, ...decorated] : decorated));
            }
            setSelectedIndex(0);
            setAppliedFilters({
                roomId: isUniversal ? selectedUniversalRoom?.roomId : actualRoomId || undefined,
                senders: sendersFilter ? [...sendersFilter] : [],
                messageTypes: messageTypesFilter ? [...messageTypesFilter] : [],
                hasMedia: Boolean(hasMediaCandidate),
                dateFrom: normalizeDateInputValue(dateRangeCandidate?.from),
                dateTo: normalizeDateInputValue(dateRangeCandidate?.to),
                keys: [...effectiveKeys],
                accountLabel: selectedUniversalRoom?.accountDisplayName,
            });
        } catch (err) {
            console.error('Failed to search messages:', err);
            setError('Не удалось выполнить поиск. Попробуйте ещё раз.');
        } finally {
            setIsSearching(false);
        }
    };

    const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        void handleSearch();
    };

    const handleLoadMore = () => {
        if (isUniversal) {
            if (hasMoreUniversal) {
                void handleSearch(true);
            }
        } else if (nextBatch) {
            void handleSearch(true);
        }
    };

    const handleRoomChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
        setSelectedRoomId(event.target.value);
    };

    const commitSenderInput = () => {
        const trimmed = senderInput.trim();
        if (!trimmed) return;
        setSelectedSenders(prev => prev.includes(trimmed) ? prev : [...prev, trimmed]);
        setSenderInput('');
    };

    const handleSenderKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
        if (event.key === 'Enter') {
            event.preventDefault();
            commitSenderInput();
        }
    };

    const handleSenderBlur = () => {
        commitSenderInput();
    };

    const handleSenderRemove = (sender: string) => {
        setSelectedSenders(prev => prev.filter(value => value !== sender));
    };

    const handleMessageTypesChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
        const values = Array.from(event.target.selectedOptions).map(option => option.value);
        setSelectedMessageTypes(values);
    };

    const handleKeysChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        const { value, checked } = event.target;
        setSelectedKeys(prev => {
            if (checked) {
                if (prev.includes(value as SearchKey)) return prev;
                return [...prev, value as SearchKey];
            }
            const filtered = prev.filter(key => key !== value);
            return filtered.length > 0 ? filtered : [...DEFAULT_KEYS];
        });
    };

    const handleDateFromChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        setDateFrom(event.target.value);
    };

    const handleDateToChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        setDateTo(event.target.value);
    };

    const handleHasMediaChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        setHasMediaOnly(event.target.checked);
    };

    const handleResetFilters = () => {
        resetFilterSelections();
        const initial = createInitialAppliedFilters();
        setAppliedFilters(initial);
        if (query.trim()) {
            void handleSearch(false, {
                roomId: undefined,
                keys: initial.keys,
                senders: [],
                messageTypes: [],
                dateRange: undefined,
                hasMedia: false,
            });
        }
    };

    const roomMap = useMemo(() => {
        if (isUniversal) {
            return aggregatedRooms.reduce<Record<string, UnifiedRoomSummary>>((acc, room) => {
                acc[room.compositeId] = room;
                return acc;
            }, {});
        }

        return rooms.reduce<Record<string, Room>>((acc, room) => {
            acc[room.roomId] = room;
            return acc;
        }, {});
    }, [aggregatedRooms, isUniversal, rooms]);

    const resolvedRooms = useMemo(() => {
        if (isUniversal) {
            return aggregatedRooms;
        }
        return rooms;
    }, [aggregatedRooms, isUniversal, rooms]);

    const highlightWords = useMemo(() => highlights.map(h => h.toLowerCase()), [highlights]);

    const activeFilterChips = useMemo(() => {
        const chips: { key: string; label: string; value: string }[] = [];
        if (appliedFilters.roomId) {
            const room = isUniversal
                ? aggregatedRooms.find(r => r.roomId === appliedFilters.roomId)
                : rooms.find(r => r.roomId === appliedFilters.roomId);
            chips.push({
                key: 'room',
                label: 'Комната',
                value: room?.name || appliedFilters.roomId,
            });
        }
        if (appliedFilters.accountLabel) {
            chips.push({
                key: 'account',
                label: 'Аккаунт',
                value: appliedFilters.accountLabel,
            });
        }
        if (appliedFilters.senders.length > 0) {
            chips.push({
                key: 'senders',
                label: 'Отправители',
                value: appliedFilters.senders.join(', '),
            });
        }
        if (appliedFilters.messageTypes.length > 0) {
            chips.push({
                key: 'types',
                label: 'Типы',
                value: appliedFilters.messageTypes.join(', '),
            });
        }
        if (appliedFilters.hasMedia) {
            chips.push({
                key: 'media',
                label: 'Медиа',
                value: 'Только сообщения с медиа',
            });
        }
        if (appliedFilters.dateFrom || appliedFilters.dateTo) {
            const parts = [
                appliedFilters.dateFrom ? `с ${appliedFilters.dateFrom}` : null,
                appliedFilters.dateTo ? `по ${appliedFilters.dateTo}` : null,
            ].filter(Boolean);
            chips.push({
                key: 'dateRange',
                label: 'Период',
                value: parts.join(' '),
            });
        }
        if (appliedFilters.keys.length > 0) {
            chips.push({
                key: 'keys',
                label: 'Поля поиска',
                value: appliedFilters.keys.join(', '),
            });
        }
        return chips;
    }, [aggregatedRooms, appliedFilters, isUniversal, rooms]);

    const renderHighlighted = (text: string) => {
        if (!text) return <span className="text-text-primary">Без текста</span>;
        const uniqueHighlights = Array.from(new Set(highlightWords.filter(Boolean)));
        if (uniqueHighlights.length === 0) {
            return <span className="text-text-primary">{text}</span>;
        }
        const pattern = uniqueHighlights.map(escapeRegExp).join('|');
        if (!pattern) {
            return <span className="text-text-primary">{text}</span>;
        }
        const regex = new RegExp(`(${pattern})`, 'gi');
        const parts = text.split(regex);
        return (
            <span className="text-text-primary">
                {parts.map((part, index) => {
                    if (index % 2 === 1) {
                        return (
                            <mark key={`${part}-${index}`} className="bg-yellow-500/40 text-text-primary px-1 rounded">
                                {part}
                            </mark>
                        );
                    }
                    return <React.Fragment key={`${part}-${index}`}>{part}</React.Fragment>;
                })}
            </span>
        );
    };

    const handleResultSelect = async (result: UniversalSearchResultItem) => {
        const eventId = result.event.getId();
        if (!eventId) return;
        setActiveResultId(eventId);
        try {
            await onSelectResult(result);
        } finally {
            setActiveResultId(null);
        }
    };

    const handleInputKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
        if (event.key === 'ArrowDown') {
            event.preventDefault();
            setSelectedIndex(prev => Math.min(prev + 1, Math.max(results.length - 1, 0)));
        } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            setSelectedIndex(prev => Math.max(prev - 1, 0));
        } else if (event.key === 'Enter' && results.length > 0) {
            event.preventDefault();
            void handleResultSelect(results[selectedIndex]);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 animate-fade-in-fast" onClick={onClose}>
            <div
                className="w-full max-w-3xl max-h-[80vh] bg-bg-primary border border-border-secondary rounded-xl shadow-2xl flex flex-col overflow-hidden"
                onClick={event => event.stopPropagation()}
            >
                <form onSubmit={handleSubmit} className="border-b border-border-secondary bg-bg-secondary/60 p-4">
                    <label className="flex items-center gap-3">
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-text-secondary" viewBox="0 0 20 20" fill="currentColor">
                            <path fillRule="evenodd" d="M9 3.5a5.5 5.5 0 104.473 2.4l4.314-4.314a1 1 0 111.414 1.414l-4.314 4.314A5.5 5.5 0 109 3.5zm0 2a3.5 3.5 0 110 7 3.5 3.5 0 010-7z" clipRule="evenodd" />
                        </svg>
                        <input
                            ref={inputRef}
                            type="text"
                            value={query}
                            onChange={event => setQuery(event.target.value)}
                            onKeyDown={handleInputKeyDown}
                            placeholder="Найдите сообщения по всему аккаунту..."
                            className="flex-1 bg-transparent text-text-primary placeholder:text-text-secondary focus:outline-none"
                        />
                        <button
                            type="submit"
                            className="px-3 py-1.5 bg-accent text-text-inverted text-sm font-semibold rounded-md hover:bg-accent-hover transition disabled:opacity-50 disabled:cursor-not-allowed"
                            disabled={isSearching}
                        >
                            {isSearching ? 'Поиск...' : 'Искать'}
                        </button>
                    </label>
                    <p className="mt-2 text-xs text-text-secondary">Совет: используйте Ctrl/Cmd + K для быстрого доступа.</p>
                    <div className="mt-4 grid gap-4 sm:grid-cols-2">
                        <div className="flex flex-col gap-2">
                            <label className="text-xs uppercase tracking-wide text-text-secondary">Комната</label>
                            <select
                                value={selectedRoomId}
                                onChange={handleRoomChange}
                                aria-label="Комната"
                                className="w-full bg-bg-primary border border-border-secondary rounded-md px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-1 focus:ring-accent"
                            >
                                <option value="">Все комнаты</option>
                                {resolvedRooms.map(room => {
                                    const optionKey = isUniversal
                                        ? (room as UnifiedRoomSummary).compositeId
                                        : (room as Room).roomId;
                                    const optionLabel = room.name || (room as Room).roomId;
                                    const homeserverLabel = isUniversal
                                        ? (room as UnifiedRoomSummary).homeserverName
                                        : undefined;
                                    return (
                                        <option key={optionKey} value={optionKey}>
                                            {optionLabel}
                                            {isUniversal && homeserverLabel ? ` • ${homeserverLabel}` : ''}
                                        </option>
                                    );
                                })}
                            </select>
                        </div>
                        <div className="flex flex-col gap-2">
                            <label className="text-xs uppercase tracking-wide text-text-secondary">Типы событий</label>
                            <select
                                multiple
                                value={selectedMessageTypes}
                                onChange={handleMessageTypesChange}
                                aria-label="Типы событий"
                                className="w-full bg-bg-primary border border-border-secondary rounded-md px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-1 focus:ring-accent h-24"
                            >
                                {MESSAGE_TYPE_OPTIONS.map(option => (
                                    <option key={option.value} value={option.value}>
                                        {option.label}
                                    </option>
                                ))}
                            </select>
                        </div>
                        <div className="flex flex-col gap-2 sm:col-span-2">
                            <label className="text-xs uppercase tracking-wide text-text-secondary">Отправители</label>
                            <div className="flex flex-wrap gap-2">
                                {selectedSenders.map(sender => (
                                    <span
                                        key={sender}
                                        className="flex items-center gap-1 bg-bg-tertiary border border-border-secondary rounded-full px-3 py-1 text-xs text-text-primary"
                                    >
                                        {sender}
                                        <button
                                            type="button"
                                            onClick={() => handleSenderRemove(sender)}
                                            className="text-text-secondary hover:text-text-primary"
                                            aria-label={`Удалить фильтр по отправителю ${sender}`}
                                        >
                                            ×
                                        </button>
                                    </span>
                                ))}
                                <input
                                    type="text"
                                    value={senderInput}
                                    onChange={event => setSenderInput(event.target.value)}
                                    onKeyDown={handleSenderKeyDown}
                                    onBlur={handleSenderBlur}
                                    placeholder="Добавьте отправителя и нажмите Enter"
                                    aria-label="Добавить отправителя"
                                    className="flex-1 min-w-[12rem] bg-bg-primary border border-border-secondary rounded-md px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-1 focus:ring-accent"
                                />
                            </div>
                        </div>
                        <div className="flex flex-col gap-2">
                            <label className="text-xs uppercase tracking-wide text-text-secondary">Период</label>
                            <div className="flex gap-2">
                                <input
                                    type="date"
                                    value={dateFrom}
                                    onChange={handleDateFromChange}
                                    aria-label="Дата начала"
                                    className="flex-1 bg-bg-primary border border-border-secondary rounded-md px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-1 focus:ring-accent"
                                />
                                <input
                                    type="date"
                                    value={dateTo}
                                    onChange={handleDateToChange}
                                    aria-label="Дата окончания"
                                    className="flex-1 bg-bg-primary border border-border-secondary rounded-md px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-1 focus:ring-accent"
                                />
                            </div>
                        </div>
                        <div className="flex flex-col gap-2">
                            <span className="text-xs uppercase tracking-wide text-text-secondary">Поля поиска</span>
                            <div className="flex flex-wrap gap-3">
                                {KEY_OPTIONS.map(option => (
                                    <label key={option.value} className="flex items-center gap-2 text-xs text-text-secondary">
                                        <input
                                            type="checkbox"
                                            value={option.value}
                                            checked={selectedKeys.includes(option.value)}
                                            onChange={handleKeysChange}
                                            className="h-4 w-4 rounded border-border-secondary bg-bg-primary"
                                        />
                                        <span>{option.label}</span>
                                    </label>
                                ))}
                            </div>
                            <label className="mt-2 flex items-center gap-2 text-xs text-text-secondary">
                                <input
                                    type="checkbox"
                                    checked={hasMediaOnly}
                                    onChange={handleHasMediaChange}
                                    className="h-4 w-4 rounded border-border-secondary bg-bg-primary"
                                />
                                <span>Только сообщения с медиа</span>
                            </label>
                        </div>
                        <div className="flex items-end sm:col-span-2">
                            <button
                                type="button"
                                onClick={handleResetFilters}
                                className="ml-auto inline-flex items-center gap-2 px-3 py-2 text-xs font-semibold text-text-secondary bg-bg-tertiary border border-border-secondary rounded-md hover:text-text-primary hover:border-accent transition"
                            >
                                Сбросить фильтры
                            </button>
                        </div>
                    </div>
                </form>
                <div className="flex-1 overflow-y-auto">
                    {activeFilterChips.length > 0 && (
                        <div className="px-5 py-3 border-b border-border-secondary bg-bg-secondary/40 flex flex-wrap items-center gap-2">
                            <span className="text-xs font-semibold uppercase tracking-wide text-text-secondary">Фильтры:</span>
                            {activeFilterChips.map(chip => (
                                <span
                                    key={chip.key}
                                    className="text-xs bg-bg-tertiary border border-border-secondary text-text-primary px-3 py-1 rounded-full"
                                >
                                    <span className="font-semibold">{chip.label}:</span> {chip.value}
                                </span>
                            ))}
                            <button
                                type="button"
                                onClick={handleResetFilters}
                                className="ml-auto text-xs font-semibold text-accent hover:text-accent-hover"
                            >
                                Очистить
                            </button>
                        </div>
                    )}
                    {error && (
                        <div className="p-4 text-sm text-red-400 bg-red-900/20">{error}</div>
                    )}
                    {!error && !isSearching && results.length === 0 && (
                        <div className="p-6 text-center text-text-secondary text-sm">
                            Введите запрос и нажмите «Искать», чтобы увидеть результаты.
                        </div>
                    )}
                    <ul>
                        {results.map((result, index) => {
                            const eventId = result.event.getId();
                            const content = result.event.getContent();
                            const body = content?.body || `[${result.event.getType()}]`;
                            const room = isUniversal
                                ? aggregatedRooms.find(r => r.roomId === result.roomId && r.accountKey === result.accountKey)
                                : roomMap[result.roomId];
                            const timestamp = result.event.getTs();
                            const isActive = index === selectedIndex;
                            const isLoading = activeResultId === eventId;
                            const rowKey = `${result.roomId}-${eventId ?? index}`;

                            return (
                                <li key={rowKey}> 
                                    <button
                                        onClick={() => eventId && void handleResultSelect(result)}
                                        className={`w-full text-left px-5 py-4 border-b border-border-secondary hover:bg-bg-secondary/80 transition flex flex-col gap-2 ${isActive ? 'bg-bg-secondary/80' : ''}`}
                                        disabled={isLoading}
                                    >
                                        <div className="flex items-center justify-between text-xs text-text-secondary">
                                            <span className="font-semibold text-text-primary truncate">{room?.name || result.roomId}</span>
                                            <span>{timestamp ? new Date(timestamp).toLocaleString() : ''}</span>
                                        </div>
                                        {isUniversal && (
                                            <div className="flex items-center gap-2 text-[10px] uppercase tracking-wide text-text-secondary">
                                                <span className="inline-flex items-center gap-1 rounded-full border border-border-secondary bg-bg-tertiary px-2 py-0.5 text-[10px] font-semibold text-text-secondary">
                                                    {result.homeserverName}
                                                </span>
                                                <span className="text-text-secondary truncate">{result.accountDisplayName}</span>
                                            </div>
                                        )}
                                        <div className="text-sm leading-relaxed">
                                            {renderHighlighted(body)}
                                        </div>
                                        {isLoading && (
                                            <div className="flex items-center gap-2 text-xs text-text-secondary">
                                                <div className="h-3 w-3 rounded-full border-2 border-t-transparent border-text-secondary animate-spin" />
                                                <span>Открываем сообщение...</span>
                                            </div>
                                        )}
                                    </button>
                                </li>
                            );
                        })}
                    </ul>
                </div>
                <div className="border-t border-border-secondary bg-bg-secondary/60 p-4 flex items-center justify-between">
                    <div className="text-xs text-text-secondary">
                        {results.length > 0 ? `Найдено результатов: ${results.length}${(nextBatch || hasMoreUniversal) ? '+' : ''}` : 'Нет результатов'}
                    </div>
                    {(nextBatch || hasMoreUniversal) && (
                        <button
                            onClick={handleLoadMore}
                            className="px-4 py-1.5 text-sm font-semibold text-text-primary bg-bg-terтиary rounded-md hover:bg-bg-secondary transition"
                            disabled={isSearching}
                        >
                            Показать ещё
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
};

export default SearchModal;
