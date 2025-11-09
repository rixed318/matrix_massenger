import React, { useState } from 'react';
import { Room, Message, MatrixClient } from '@matrix-messenger/core';
import Avatar from './Avatar';
import { mxcToHttp } from '@matrix-messenger/core';

interface ForwardMessageModalProps {
    isOpen: boolean;
    onClose: () => void;
    onForward: (roomId: string) => Promise<void>;
    rooms: Room[];
    message: Message;
    client: MatrixClient;
    savedMessagesRoom: Room | null;
}

const ForwardMessageModal: React.FC<ForwardMessageModalProps> = ({ isOpen, onClose, onForward, rooms, message, client, savedMessagesRoom }) => {
    const [searchQuery, setSearchQuery] = useState('');
    const [isForwarding, setIsForwarding] = useState<string | null>(null);

    if (!isOpen) return null;

    const filteredRooms = rooms.filter(room => 
        room.name.toLowerCase().includes(searchQuery.toLowerCase())
    );

    const handleForwardClick = async (roomId: string) => {
        setIsForwarding(roomId);
        try {
            await onForward(roomId);
        } finally {
            // The parent component will close the modal, which will unmount this
            // and reset the isForwarding state. No need to reset it here.
        }
    };
    
    const renderMessagePreview = () => {
        if (message.content.msgtype === 'm.image') {
            const imageUrl = mxcToHttp(client, message.content.url, 80);
            return <div className="flex items-center gap-3"><img src={imageUrl!} alt="Image preview" className="w-12 h-12 object-cover rounded-md" /> <p className="text-gray-300 truncate">Image: {message.content.body}</p></div>;
        }
        if (message.content.msgtype === 'm.file') {
             return <div className="flex items-center gap-3"><svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 text-gray-400" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4zm2 6a1 1 0 011-1h6a1 1 0 110 2H7a1 1 0 01-1-1zm1 3a1 1 0 100 2h6a1 1 0 100-2H7z" clipRule="evenodd" /></svg> <p className="text-gray-300 truncate">File: {message.content.body}</p></div>;
        }
        return <p className="text-gray-300 truncate">{message.content.body}</p>
    };

    return (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 animate-fade-in-fast" onClick={onClose}>
            <div className="bg-gray-800 rounded-lg shadow-xl w-full max-w-md h-[70vh] flex flex-col animate-slide-up" onClick={e => e.stopPropagation()}>
                <div className="p-6 border-b border-gray-700">
                    <h2 className="text-xl font-bold">Forward message to...</h2>
                </div>
                <div className="p-4 border-b border-gray-700 bg-black/20">
                    <p className="text-sm font-semibold mb-2">Forwarding:</p>
                    {renderMessagePreview()}
                </div>
                {savedMessagesRoom && (
                    <div className="p-2 border-b border-gray-700">
                        <button
                            onClick={() => handleForwardClick(savedMessagesRoom.roomId)}
                            disabled={!!isForwarding}
                            className="w-full flex items-center p-3 cursor-pointer rounded-md bg-gray-900/50 hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            <div className="h-10 w-10 rounded-full flex items-center justify-center bg-indigo-500 flex-shrink-0">
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
                                </svg>
                            </div>
                            <span className="ml-3 font-semibold text-sm">{savedMessagesRoom.name}</span>
                            {isForwarding === savedMessagesRoom.roomId && (
                                <svg className="animate-spin ml-auto h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                </svg>
                            )}
                        </button>
                    </div>
                )}
                 <div className="p-2 border-b border-gray-700">
                    <input
                        type="text"
                        placeholder="Search chats..."
                        value={searchQuery}
                        onChange={e => setSearchQuery(e.target.value)}
                        className="w-full bg-gray-900 text-white px-3 py-2 rounded-md focus:outline-none focus:ring-1 focus:ring-indigo-500 sm:text-sm"
                        autoFocus
                    />
                </div>
                <div className="flex-1 overflow-y-auto">
                    <ul>
                        {filteredRooms.map(room => (
                             <li key={room.roomId}>
                                <button
                                    onClick={() => handleForwardClick(room.roomId)}
                                    disabled={!!isForwarding}
                                    className="w-full flex items-center p-3 cursor-pointer hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                    <Avatar name={room.name} imageUrl={room.avatarUrl} />
                                    <span className="ml-3 font-semibold text-sm truncate">{room.name}</span>
                                    {isForwarding === room.roomId && (
                                        <svg className="animate-spin ml-auto h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                        </svg>
                                    )}
                                </button>
                            </li>
                        ))}
                    </ul>
                </div>
                <div className="bg-gray-700/50 px-6 py-4 flex justify-end gap-3 rounded-b-lg">
                    <button
                        onClick={onClose}
                        className="py-2 px-4 border border-gray-600 rounded-md text-sm font-medium text-gray-200 hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-500 focus:ring-offset-gray-800"
                    >
                        Cancel
                    </button>
                </div>
            </div>
        </div>
    );
};

export default ForwardMessageModal;