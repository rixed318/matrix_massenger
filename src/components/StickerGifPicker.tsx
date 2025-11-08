import React, { useState, useEffect, useRef } from 'react';
import { Sticker, Gif } from '../types';
import { STICKER_PACK } from '../assets/stickers';
import { getTrendingGifs, searchGifs } from '../services/gifService';

interface StickerGifPickerProps {
    onClose: () => void;
    onSendSticker: (sticker: Sticker) => void;
    onSendGif: (gif: Gif) => void;
}

type ActiveTab = 'stickers' | 'gifs';

const StickerGifPicker: React.FC<StickerGifPickerProps> = ({ onClose, onSendSticker, onSendGif }) => {
    const [activeTab, setActiveTab] = useState<ActiveTab>('stickers');
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

    return (
        <div ref={pickerRef} className="absolute bottom-full mb-2 w-[400px] h-[350px] bg-gray-800 border border-gray-700 rounded-lg shadow-2xl flex flex-col z-20 animate-slide-up">
            <div className="flex-shrink-0 flex border-b border-gray-700">
                <TabButton name="Stickers" isActive={activeTab === 'stickers'} onClick={() => setActiveTab('stickers')} />
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
