import React from 'react';
import { Message } from '../types';

interface PinnedMessageBarProps {
    message: Message;
    onUnpin: () => void;
}

const PinnedMessageBar: React.FC<PinnedMessageBarProps> = ({ message, onUnpin }) => {
    return (
        <div className="p-2 bg-gray-900/50 border-b border-gray-900/50 flex items-center justify-between text-sm animate-fade-in-fast">
            <div className="flex items-center gap-2 overflow-hidden">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-yellow-400 flex-shrink-0" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M10 1.05c-1.305 0-2.368.53-3.223 1.382l-6.275 6.276a.75.75 0 00.53 1.282H5v5.5a2.5 2.5 0 002.5 2.5h5A2.5 2.5 0 0015 15.5V10h3.968a.75.75 0 00.53-1.282L13.223 2.432C12.368 1.58 11.305 1.05 10 1.05z" clipRule="evenodd" />
                </svg>
                <div className="text-gray-300 overflow-hidden whitespace-nowrap">
                    <span className="font-bold text-yellow-300">Pinned: </span>
                    <span className="font-semibold">{message.sender.name}: </span>
                    <span className="text-gray-400">{message.content.body}</span>
                </div>
            </div>
            <button onClick={onUnpin} className="p-1 rounded-full hover:bg-gray-700" title="Unpin message">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
            </button>
        </div>
    );
};

export default PinnedMessageBar;