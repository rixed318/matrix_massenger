import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
    Sticker,
    Gif,
    StickerPack,
    StickerLibraryState,
    getStickerLibraryState,
    subscribeStickerLibrary,
    setStickerPackEnabled,
    toggleStickerFavorite,
    registerLocalStickerPacks,
} from '@matrix-messenger/core';
import { getTrendingGifs, searchGifs } from '@matrix-messenger/core';
import { LOCAL_STICKER_PACKS } from '../assets/stickers';

interface StickerGifPickerProps {
    onClose: () => void;
    onSendSticker: (sticker: Sticker) => void;
    onSendGif: (gif: Gif) => void;
}

type ActiveTab = 'local' | 'cloud' | 'custom' | 'gifs';

let hasRegisteredLocalPacks = false;
const ensureLocalPacksRegistered = () => {
    if (!hasRegisteredLocalPacks) {
        registerLocalStickerPacks(LOCAL_STICKER_PACKS);
        hasRegisteredLocalPacks = true;
    }
};

const StickerGifPicker: React.FC<StickerGifPickerProps> = ({ onClose, onSendSticker, onSendGif }) => {
    ensureLocalPacksRegistered();

    const [activeTab, setActiveTab] = useState<ActiveTab>('local');
    const [libraryState, setLibraryState] = useState<StickerLibraryState>(() => getStickerLibraryState());
    const [gifs, setGifs] = useState<Gif[]>([]);
    const [isLoadingGifs, setIsLoadingGifs] = useState(false);
    const [gifSearchQuery, setGifSearchQuery] = useState('');
    const pickerRef = useRef<HTMLDivElement>(null);

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
        const unsubscribe = subscribeStickerLibrary(next => setLibraryState(next));
        return unsubscribe;
    }, []);

    useEffect(() => {
        if (activeTab === 'gifs') {
            const fetchGifs = async () => {
                setIsLoadingGifs(true);
                const results = gifSearchQuery
                    ? await searchGifs(gifSearchQuery)
                    : await getTrendingGifs();
                setGifs(results);
                setIsLoadingGifs(false);
            };
            
            const debounce = setTimeout(() => {
                fetchGifs();
            }, 300);

            return () => clearTimeout(debounce);
        }
    }, [activeTab, gifSearchQuery]);

    const favoritesSet = useMemo(() => new Set(libraryState.favorites), [libraryState.favorites]);

    const favoriteStickers = useMemo(() => {
        if (libraryState.favorites.length === 0) return [] as Sticker[];
        const items: Sticker[] = [];
        libraryState.favorites.forEach(key => {
            const [packId, stickerId] = key.split('/', 2);
            if (!packId || !stickerId) return;
            const pack = libraryState.packs.find(p => p.id === packId);
            const sticker = pack?.stickers.find(s => s.id === stickerId);
            if (pack && sticker) {
                items.push({ ...sticker, packId: pack.id });
            }
        });
        return items;
    }, [libraryState]);

    const localPacks = useMemo(
        () => libraryState.packs.filter(pack => pack.source === 'local'),
        [libraryState.packs],
    );

    const cloudPacks = useMemo(
        () => libraryState.packs.filter(pack => pack.source === 'room'),
        [libraryState.packs],
    );

    const customPacks = useMemo(() => {
        const packs: StickerPack[] = libraryState.packs.filter(
            pack => pack.source === 'account_data' || pack.source === 'user',
        );
        if (favoriteStickers.length > 0) {
            packs.unshift({
                id: 'user:favorites',
                name: 'Favorites',
                description: 'Starred stickers',
                source: 'user',
                stickers: favoriteStickers,
                isEnabled: true,
            });
        }
        return packs;
    }, [libraryState.packs, favoriteStickers]);

    const packsForActiveTab = useMemo(() => {
        switch (activeTab) {
            case 'local':
                return localPacks;
            case 'cloud':
                return cloudPacks;
            case 'custom':
                return customPacks;
            default:
                return [] as StickerPack[];
        }
    }, [activeTab, localPacks, cloudPacks, customPacks]);

    const isStickerFavorite = (sticker: Sticker) =>
        sticker.packId ? favoritesSet.has(`${sticker.packId}/${sticker.id}`) : false;

    const handleToggleFavorite = (sticker: Sticker) => {
        if (!sticker.packId) return;
        toggleStickerFavorite(sticker.packId, sticker.id);
    };

    const renderStickerPack = (pack: StickerPack) => {
        const isFavoritesPack = pack.id === 'user:favorites';
        const isEnabled = pack.isEnabled ?? true;
        const stickers = pack.stickers ?? [];
        const showToggle = pack.source !== 'local' && !isFavoritesPack;
        return (
            <div key={pack.id} className="mb-4">
                <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-3">
                        {pack.avatarUrl && (
                            <img src={pack.avatarUrl} alt={pack.name} className="w-10 h-10 rounded-md object-cover" />
                        )}
                        <div>
                            <p className="text-sm font-semibold text-white">{pack.name}</p>
                            {pack.description && (
                                <p className="text-xs text-gray-400 max-w-xs">{pack.description}</p>
                            )}
                        </div>
                    </div>
                    {showToggle && (
                        <button
                            onClick={() => setStickerPackEnabled(pack.id, !isEnabled)}
                            className={`px-3 py-1 text-xs font-medium rounded-md border transition-colors ${
                                isEnabled
                                    ? 'border-red-500/50 text-red-400 hover:bg-red-500/10'
                                    : 'border-green-500/50 text-green-400 hover:bg-green-500/10'
                            }`}
                        >
                            {isEnabled ? 'Remove pack' : 'Add pack'}
                        </button>
                    )}
                </div>
                {stickers.length === 0 ? (
                    <div className="text-xs text-gray-500 border border-dashed border-gray-600 rounded-md p-4 text-center">
                        No stickers available in this pack yet.
                    </div>
                ) : (
                    <div
                        className={`grid grid-cols-5 gap-2 ${
                            isEnabled ? '' : 'opacity-50 pointer-events-none'
                        }`}
                    >
                        {stickers.map(sticker => (
                            <div key={sticker.id} className="relative group">
                                <button
                                    onClick={() => onSendSticker(sticker)}
                                    className="aspect-square p-2 rounded-lg hover:bg-gray-700 transition-colors flex items-center justify-center w-full"
                                    title={sticker.body}
                                    disabled={!isEnabled}
                                >
                                    <img src={sticker.url} alt={sticker.body} className="w-full h-full object-contain" />
                                </button>
                                {sticker.packId && (
                                    <button
                                        onClick={() => handleToggleFavorite(sticker)}
                                        className={`absolute top-1 right-1 p-1 rounded-full bg-black/60 hover:bg-black/80 transition-colors ${
                                            isStickerFavorite(sticker) ? 'text-yellow-300' : 'text-gray-300'
                                        }`}
                                        title={isStickerFavorite(sticker) ? 'Remove from favorites' : 'Add to favorites'}
                                        type="button"
                                    >
                                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                                            <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.044 3.22a1 1 0 00.95.69h3.386c.969 0 1.371 1.24.588 1.81l-2.739 1.99a1 1 0 00-.364 1.118l1.045 3.22c.3.921-.755 1.688-1.54 1.118l-2.739-1.99a1 1 0 00-1.175 0l-2.739 1.99c-.784.57-1.838-.197-1.539-1.118l1.044-3.22a1 1 0 00-.364-1.118l-2.739-1.99c-.783-.57-.38-1.81.588-1.81h3.386a1 1 0 00.95-.69l1.044-3.22z" />
                                        </svg>
                                    </button>
                                )}
                            </div>
                        ))}
                    </div>
                )}
            </div>
        );
    };

    return (
        <div ref={pickerRef} className="absolute bottom-full mb-2 w-[420px] h-[380px] bg-gray-800 border border-gray-700 rounded-lg shadow-2xl flex flex-col z-20 animate-slide-up">
            <div className="flex-shrink-0 flex border-b border-gray-700">
                <TabButton name="Local" isActive={activeTab === 'local'} onClick={() => setActiveTab('local')} />
                <TabButton name="Cloud" isActive={activeTab === 'cloud'} onClick={() => setActiveTab('cloud')} />
                <TabButton name="Custom" isActive={activeTab === 'custom'} onClick={() => setActiveTab('custom')} />
                <TabButton name="GIFs" isActive={activeTab === 'gifs'} onClick={() => setActiveTab('gifs')} />
            </div>

            {activeTab === 'gifs' && (
                <div className="p-2 flex-shrink-0">
                    <input
                        type="text"
                        placeholder="Search for GIFs..."
                        value={gifSearchQuery}
                        onChange={e => setGifSearchQuery(e.target.value)}
                        className="w-full bg-gray-900 text-white px-3 py-2 rounded-md focus:outline-none focus:ring-1 focus:ring-indigo-500 sm:text-sm"
                    />
                </div>
            )}
            
            <div className="flex-1 overflow-y-auto p-3 space-y-3">
                {activeTab !== 'gifs' && packsForActiveTab.length === 0 && (
                    <div className="text-sm text-gray-400 text-center border border-dashed border-gray-600 rounded-md p-6">
                        No sticker packs available yet. Join rooms or add your own packs to get started.
                    </div>
                )}

                {activeTab !== 'gifs' && packsForActiveTab.map(pack => renderStickerPack(pack))}

                {activeTab === 'gifs' && (
                    <>
                        {isLoadingGifs ? (
                            <div className="flex items-center justify-center h-full">
                                <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-blue-500"></div>
                            </div>
                        ) : (
                            <div className="grid grid-cols-3 gap-2">
                                {gifs.map(gif => (
                                    <button
                                        key={gif.id}
                                        onClick={() => onSendGif(gif)}
                                        className="aspect-video bg-gray-900 rounded-md overflow-hidden hover:ring-2 ring-indigo-500 transition-all"
                                    >
                                        <img src={gif.previewUrl} alt={gif.title} className="w-full h-full object-cover" />
                                    </button>
                                ))}
                            </div>
                        )}
                    </>
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
