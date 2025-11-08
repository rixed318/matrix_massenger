import React from 'react';
import { LinkPreviewData } from '../types';
import { openUrl } from '@tauri-apps/plugin-opener';

interface LinkPreviewProps {
    data: LinkPreviewData;
}

const LinkPreview: React.FC<LinkPreviewProps> = ({ data }) => {
    const handleOpenLink = (e: React.MouseEvent) => {
        e.preventDefault();
        openUrl(data.url);
    };

    return (
        <a 
            href={data.url}
            onClick={handleOpenLink}
            target="_blank" 
            rel="noopener noreferrer" 
            className="mt-2 flex flex-col max-w-sm border-l-4 border-indigo-400 pl-3 bg-black/20 rounded-r-md overflow-hidden cursor-pointer hover:bg-black/30 transition-colors"
        >
            {data.image && (
                <img src={data.image} alt="Preview" className="w-full max-h-40 object-cover" />
            )}
            <div className="p-2">
                {data.siteName && <p className="text-xs font-bold text-gray-400">{data.siteName}</p>}
                {data.title && <p className="text-sm font-semibold text-white truncate">{data.title}</p>}
                {data.description && <p className="text-xs text-gray-300 line-clamp-2">{data.description}</p>}
            </div>
        </a>
    );
};

export default LinkPreview;
