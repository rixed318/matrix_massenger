import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
    Sticker,
    Gif,
    GifFavorite,
    GifSearchHistoryEntry,
    getTrendingGifs,
    searchGifs,
    getGifFavorites,
    toggleGifFavorite,
    subscribeToGifFavorites,
    getGifSearchHistory,
    clearGifSearchHistory,
    removeGifSearchHistoryEntry,
    GifSearchResult,
} from '@matrix-messenger/core';
import { STICKER_PACK } from '../assets/stickers';

interface StickerGifPickerProps {
    onClose: () => void;
    onSendSticker: (sticker: Sticker) => void;
    onSendGif: (gif: Gif) => void;
}

type ActiveTab = 'stickers' | 'gifs';

const StickerGifPicker: React.FC<StickerGifPickerProps> = ({ onClose, onSendSticker, onSendGif }) => {
    const [activeTab, setActiveTab] = useState<ActiveTab>('stickers');
    const [gifMode, setGifMode] = useState<'trending' | 'favorites'>('trending');
    const [gifs, setGifs] = useState<Gif[]>([]);
    const [isLoadingGifs, setIsLoadingGifs] = useState(false);
    const [isLoadingMore, setIsLoadingMore] = useState(false);
    const [gifSearchQuery, setGifSearchQuery] = useState('');
    const [gifError, setGifError] = useState<string | null>(null);
    const [fromCache, setFromCache] = useState(false);
    const [nextCursor, setNextCursor] = useState<string | undefined>();
    const [favorites, setFavorites] = useState<GifFavorite[]>([]);
    const [searchHistory, setSearchHistory] = useState<GifSearchHistoryEntry[]>([]);
    const pickerRef = useRef<HTMLDivElement>(null);
    const fetchControllerRef = useRef(0);
    const gifModeRef = useRef<'trending' | 'favorites'>(gifMode);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (pickerRef.current && !pickerRef.current.contains(event.target as Node)) {
                onClose();
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [onClose]);

    useEffect(() => {
        gifModeRef.current = gifMode;
    }, [gifMode]);

    useEffect(() => {
        let unsubscribe: (() => void) | undefined;
        const init = async () => {
            try {
                const [initialFavorites, history] = await Promise.all([
                    getGifFavorites(),
                    getGifSearchHistory(),
                ]);
                setFavorites(initialFavorites);
                setSearchHistory(history);
            } catch (error) {
                console.warn('Failed to initialize GIF picker state', error);
            }
            unsubscribe = subscribeToGifFavorites(updated => {
                setFavorites(updated);
                if (gifModeRef.current === 'favorites') {
                    setGifs(updated);
                }
            });
        };
        init();
        return () => {
            unsubscribe?.();
        };
    }, []);

    const shouldShowSearch = useMemo(() => gifMode !== 'favorites', [gifMode]);

    useEffect(() => {
        if (activeTab !== 'gifs') return;
        if (gifMode === 'favorites') {
            setGifs(favorites);
            setNextCursor(undefined);
            setGifError(favorites.length ? null : null);
            setFromCache(false);
            return;
        }

        const currentRequest = ++fetchControllerRef.current;
        const run = async () => {
            setIsLoadingGifs(true);
            setGifError(null);
            setFromCache(false);
            try {
                const isSearch = gifSearchQuery.trim().length > 0;
                const result: GifSearchResult = isSearch
                    ? await searchGifs(gifSearchQuery, { limit: 24 })
                    : await getTrendingGifs({ limit: 24 });
                if (fetchControllerRef.current !== currentRequest) return;
                setGifs(result.items);
                setNextCursor(result.nextCursor);
                setGifError(result.error ?? null);
                setFromCache(result.fromCache);
                if (isSearch && !result.fromCache && !result.error) {
                    try {
                        setSearchHistory(await getGifSearchHistory());
                    } catch (historyError) {
                        console.warn('Failed to refresh GIF search history', historyError);
                    }
                }
            } catch (error) {
                if (fetchControllerRef.current !== currentRequest) return;
                setGifError((error as Error).message);
                setGifs([]);
                setNextCursor(undefined);
            } finally {
                if (fetchControllerRef.current === currentRequest) {
                    setIsLoadingGifs(false);
                }
            }
        };

        const debounce = setTimeout(() => {
            run();
        }, 350);

        return () => {
            clearTimeout(debounce);
        };
    }, [activeTab, gifMode, gifSearchQuery, favorites]);

    const handleLoadMore = async () => {
        if (!nextCursor || gifMode === 'favorites') return;
        setIsLoadingMore(true);
        try {
            const isSearch = gifSearchQuery.trim().length > 0;
            const result = isSearch
                ? await searchGifs(gifSearchQuery, { cursor: nextCursor, limit: 24 })
                : await getTrendingGifs({ cursor: nextCursor, limit: 24 });
            setGifs(prev => [...prev, ...result.items]);
            setNextCursor(result.nextCursor);
            setGifError(result.error ?? null);
        } catch (error) {
            setGifError((error as Error).message);
        } finally {
            setIsLoadingMore(false);
        }
    };

    const handleToggleFavorite = async (gif: Gif) => {
        try {
            await toggleGifFavorite(gif);
        } catch (error) {
            console.error('Failed to toggle GIF favorite', error);
        }
    };

    const handleRemoveHistory = async (query: string) => {
        try {
            await removeGifSearchHistoryEntry(query);
            setSearchHistory(await getGifSearchHistory());
        } catch (error) {
            console.error('Failed to remove GIF history entry', error);
        }
    };

    const handleClearHistory = async () => {
        try {
            await clearGifSearchHistory();
            setSearchHistory([]);
        } catch (error) {
            console.error('Failed to clear GIF search history', error);
        }
    };

    const isFavorite = (gifId: string) => favorites.some(item => item.id === gifId);

    return (
        <div ref={pickerRef} className="absolute bottom-full mb-2 w-[400px] h-[350px] bg-gray-800 border border-gray-700 rounded-lg shadow-2xl flex flex-col z-20 animate-slide-up">
            <div className="flex-shrink-0 flex border-b border-gray-700">
                <TabButton name="Stickers" isActive={activeTab === 'stickers'} onClick={() => setActiveTab('stickers')} />
                <TabButton name="GIFs" isActive={activeTab === 'gifs'} onClick={() => setActiveTab('gifs')} />
            </div>

            {activeTab === 'gifs' && (
                <div className="p-2 flex-shrink-0 space-y-2">
                    <div className="flex gap-1">
                        <TabButton
                            name="Trending"
                            isActive={gifMode === 'trending'}
                            onClick={() => {
                                setGifMode('trending');
                            }}
                        />
                        <TabButton
                            name="Favorites"
                            isActive={gifMode === 'favorites'}
                            onClick={() => {
                                setGifMode('favorites');
                            }}
                        />
                    </div>
                    {shouldShowSearch && (
                        <>
                            <input
                                type="text"
                                placeholder="Search for GIFs..."
                                value={gifSearchQuery}
                                onChange={e => setGifSearchQuery(e.target.value)}
                                className="w-full bg-gray-900 text-white px-3 py-2 rounded-md focus:outline-none focus:ring-1 focus:ring-indigo-500 sm:text-sm"
                            />
                            {searchHistory.length > 0 && !gifSearchQuery && (
                                <div className="flex flex-wrap gap-2 text-xs text-gray-400">
                                    <span className="uppercase tracking-wide">History:</span>
                                    {searchHistory.slice(0, 10).map(entry => (
                                        <div key={entry.query} className="flex items-center gap-1 bg-gray-800/60 px-2 py-1 rounded">
                                            <button
                                                type="button"
                                                onClick={() => setGifSearchQuery(entry.query)}
                                                className="hover:text-white"
                                            >
                                                {entry.query}
                                            </button>
                                            <button
                                                type="button"
                                                className="text-xs text-gray-500 hover:text-red-400"
                                                onClick={() => handleRemoveHistory(entry.query)}
                                                aria-label={`Remove ${entry.query} from history`}
                                            >
                                                ×
                                            </button>
                                        </div>
                                    ))}
                                    <button
                                        type="button"
                                        className="text-xs text-indigo-400 hover:text-indigo-200"
                                        onClick={handleClearHistory}
                                    >
                                        Clear
                                    </button>
                                </div>
                            )}
                        </>
                    )}
                </div>
            )}
            
            <div className="flex-1 overflow-y-auto p-2">
                {activeTab === 'stickers' && (
                    <div className="grid grid-cols-5 gap-2">
                        {STICKER_PACK.map(sticker => (
                            <button
                                key={sticker.id}
                                onClick={() => onSendSticker(sticker)}
                                className="aspect-square p-2 rounded-lg hover:bg-gray-700 transition-colors flex items-center justify-center"
                                title={sticker.body}
                            >
                                <img src={sticker.url} alt={sticker.body} className="w-full h-full object-contain" />
                            </button>
                        ))}
                    </div>
                )}

                {activeTab === 'gifs' && (
                    <div className="flex flex-col gap-2 h-full">
                        {gifError && (
                            <div className="text-xs text-red-400 bg-red-900/20 border border-red-900/40 rounded px-2 py-1">
                                {gifError}
                            </div>
                        )}
                        {fromCache && !gifError && (
                            <div className="text-[10px] uppercase tracking-wider text-amber-300/80">Showing cached results</div>
                        )}
                        {isLoadingGifs ? (
                            <div className="flex items-center justify-center flex-1">
                                <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-blue-500"></div>
                            </div>
                        ) : gifs.length ? (
                            <div className="grid grid-cols-3 gap-2">
                                {gifs.map(gif => (
                                    <div key={gif.id} className="relative group">
                                        <button
                                            onClick={() => onSendGif(gif)}
                                            className="aspect-video w-full bg-gray-900 rounded-md overflow-hidden hover:ring-2 ring-indigo-500 transition-all"
                                        >
                                            <img src={gif.previewUrl} alt={gif.title} className="w-full h-full object-cover" />
                                        </button>
                                        <button
                                            type="button"
                                            onClick={event => {
                                                event.stopPropagation();
                                                handleToggleFavorite(gif);
                                            }}
                                            className={`absolute top-1 right-1 rounded-full px-2 py-1 text-xs font-semibold transition-colors ${
                                                isFavorite(gif.id)
                                                    ? 'bg-yellow-500/90 text-gray-900'
                                                    : 'bg-gray-900/80 text-yellow-200 hover:bg-yellow-500/80 hover:text-gray-900'
                                            }`}
                                            aria-label={isFavorite(gif.id) ? 'Remove from favorites' : 'Add to favorites'}
                                        >
                                            {isFavorite(gif.id) ? '★' : '☆'}
                                        </button>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div className="flex-1 flex flex-col items-center justify-center text-sm text-gray-400 gap-2">
                                <span>No GIFs found.</span>
                                {gifMode === 'favorites' && (
                                    <span className="text-xs text-gray-500">Mark GIFs as favorites to keep them here.</span>
                                )}
                            </div>
                        )}
                        {nextCursor && gifMode !== 'favorites' && (
                            <button
                                type="button"
                                onClick={handleLoadMore}
                                disabled={isLoadingMore}
                                className="mt-auto inline-flex items-center justify-center rounded-md bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-60"
                            >
                                {isLoadingMore ? 'Loading…' : 'Load more'}
                            </button>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};

interface TabButtonProps {
    name: string;
    isActive: boolean;
    onClick: () => void;
}

const TabButton: React.FC<TabButtonProps> = ({ name, isActive, onClick }) => (
    <button
        onClick={onClick}
        className={`flex-1 py-2 text-sm font-semibold transition-colors ${
            isActive ? 'text-white bg-gray-700/50' : 'text-gray-400 hover:bg-gray-700/30'
        }`}
    >
        {name}
    </button>
);


export default StickerGifPicker;
