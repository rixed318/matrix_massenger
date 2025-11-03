


import React from 'react';
import { Room } from '../types';
import Avatar from './Avatar';
import { formatDistanceToNow } from 'date-fns';

interface RoomListItemProps {
    room: Room;
    isSelected: boolean;
    onSelect: () => void;
}

const RoomListItem: React.FC<RoomListItemProps> = ({ room, isSelected, onSelect }) => {
    const lastMessage = room.lastMessage;
    const timestamp = lastMessage ? formatDistanceToNow(new Date(lastMessage.timestamp), { addSuffix: true }) : '';

    const renderAvatar = () => {
        if (room.isSavedMessages) {
            return (
                <div className="h-12 w-12 rounded-full flex items-center justify-center bg-accent flex-shrink-0">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-text-inverted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
                    </svg>
                </div>
            );
        }
        return <Avatar name={room.name} imageUrl={room.avatarUrl} />;
    };

    return (
        <li onClick={onSelect} className={`flex items-center p-3 cursor-pointer hover:bg-bg-tertiary ${isSelected ? 'bg-bg-hover' : ''}`}>
            {renderAvatar()}
            <div className="flex-1 ml-3 overflow-hidden">
                <div className="flex justify-between items-center">
                    <p className="font-semibold text-sm truncate flex items-center gap-2">
                        {room.name}
                        {room.isEncrypted && !room.isSavedMessages && (
                             <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-text-secondary flex-shrink-0" viewBox="0 0 20 20" fill="currentColor">
                                <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
                            </svg>
                        )}
                    </p>
                    <p className="text-xs text-text-secondary flex-shrink-0">{timestamp}</p>
                </div>
                <div className="flex justify-between items-start">
                    <p className="text-sm text-text-secondary truncate">
                        {lastMessage ? `${lastMessage.isOwn ? 'You: ' : ''}${lastMessage.content.body}` : 'No messages yet'}
                    </p>
                    {room.unreadCount > 0 && (
                        <span className="bg-accent text-text-inverted text-xs font-bold rounded-full h-5 w-5 flex items-center justify-center flex-shrink-0 ml-2">
                            {room.unreadCount}
                        </span>
                    )}
                </div>
            </div>
        </li>
    );
};

export default RoomListItem;