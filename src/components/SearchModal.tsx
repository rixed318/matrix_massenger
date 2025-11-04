import React, { useEffect, useMemo, useRef, useState } from 'react';
import { MatrixClient, Room } from '../types';
import { searchMessages, SearchMessagesResponse, SearchResultItem } from '../services/searchService';

interface SearchModalProps {
    isOpen: boolean;
    onClose: () => void;
    client: MatrixClient;
    rooms: Room[];
    onSelectResult: (result: SearchResultItem) => Promise<void> | void;
}

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const SearchModal: React.FC<SearchModalProps> = ({ isOpen, onClose, client, rooms, onSelectResult }) => {
    const [query, setQuery] = useState('');
    const [results, setResults] = useState<SearchResultItem[]>([]);
    const [highlights, setHighlights] = useState<string[]>([]);
    const [nextBatch, setNextBatch] = useState<string | undefined>();
    const [isSearching, setIsSearching] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [selectedIndex, setSelectedIndex] = useState(0);
    const [activeResultId, setActiveResultId] = useState<string | null>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (!isOpen) {
            setQuery('');
            setResults([]);
            setHighlights([]);
            setNextBatch(undefined);
            setSelectedIndex(0);
            setError(null);
            setActiveResultId(null);
            return;
        }

        const timer = setTimeout(() => inputRef.current?.focus(), 50);
        return () => clearTimeout(timer);
    }, [isOpen]);

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

    const handleSearch = async (batch?: string, append = false) => {
        const trimmed = query.trim();
        if (!trimmed) {
            setResults([]);
            setHighlights([]);
            setNextBatch(undefined);
            setError(null);
            return;
        }

        setIsSearching(true);
        setError(null);
        try {
            const response: SearchMessagesResponse = await searchMessages(client, {
                searchTerm: trimmed,
                nextBatch: batch,
            });
            setHighlights(response.highlights);
            setNextBatch(response.nextBatch);
            setResults(prev => append ? [...prev, ...response.results] : response.results);
            setSelectedIndex(0);
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
        if (nextBatch) {
            void handleSearch(nextBatch, true);
        }
    };

    const roomMap = useMemo(() => {
        return rooms.reduce<Record<string, Room>>((acc, room) => {
            acc[room.roomId] = room;
            return acc;
        }, {});
    }, [rooms]);

    const highlightWords = useMemo(() => highlights.map(h => h.toLowerCase()), [highlights]);

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

    const handleResultSelect = async (result: SearchResultItem) => {
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
                </form>
                <div className="flex-1 overflow-y-auto">
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
                            const room = roomMap[result.roomId];
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
                        {results.length > 0 ? `Найдено результатов: ${results.length}${nextBatch ? '+' : ''}` : 'Нет результатов'}
                    </div>
                    {nextBatch && (
                        <button
                            onClick={handleLoadMore}
                            className="px-4 py-1.5 text-sm font-semibold text-text-primary bg-bg-tertiary rounded-md hover:bg-bg-secondary transition"
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
