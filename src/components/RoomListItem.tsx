


import React from 'react';
import { Room } from '@matrix-messenger/core';
import Avatar from './Avatar';
import { formatDistanceToNow } from 'date-fns';

interface RoomListItemProps {
    room: Room;
    isSelected: boolean;
    onSelect: () => void;
}

const RoomListItem: React.FC<RoomListItemProps> = ({ room, isSelected, onSelect }) => {
    const lastMessage = room.lastMessage;
    const isSpace = room.isSpace;
    const timestamp = !isSpace && lastMessage
        ? formatDistanceToNow(new Date(lastMessage.timestamp), { addSuffix: true })
        : '';

    const hasRecentAttachment = !!lastMessage && (
        lastMessage.isSticker
        || ['m.image', 'm.video', 'm.audio', 'm.file', 'm.location'].includes(lastMessage.content.msgtype)
    );

    const renderMetaText = () => {
        if (room.isHidden) {
            return 'Скрытый чат';
        }
        if (isSpace) {
            const parts: string[] = [];
            if (room.topic) {
                parts.push(room.topic);
            }
            if (room.spaceChildIds && room.spaceChildIds.length > 0) {
                parts.push(`${room.spaceChildIds.length} channel${room.spaceChildIds.length === 1 ? '' : 's'}`);
            }
            if (!parts.length && room.canonicalAlias) {
                parts.push(room.canonicalAlias);
            }
            return parts.join(' • ') || 'Space overview';
        }

        if (lastMessage) {
            return `${lastMessage.isOwn ? 'You: ' : ''}${lastMessage.content.body}`;
        }

        return 'No messages yet';
    };

    const renderAvatar = () => {
        if (isSpace) {
            return (
                <div className="h-12 w-12 rounded-xl flex items-center justify-center bg-bg-secondary text-text-secondary flex-shrink-0">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" viewBox="0 0 20 20" fill="currentColor">
                        <path d="M3 3a2 2 0 012-2h4a2 2 0 012 2v4a2 2 0 01-2 2H5a2 2 0 01-2-2V3zm8 0a2 2 0 012-2h4a2 2 0 012 2v4a2 2 0 01-2 2h-4a2 2 0 01-2-2V3zM3 13a2 2 0 012-2h4a2 2 0 012 2v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4zm8 0a2 2 0 012-2h4a2 2 0 012 2v4a2 2 0 01-2 2h-4a2 2 0 01-2-2v-4z" />
                    </svg>
                </div>
            );
        }
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
                        {room.isHidden && (
                            <span className="text-[10px] uppercase tracking-wide font-semibold px-1.5 py-0.5 rounded-full bg-purple-500/10 text-purple-200">
                                Hidden
                            </span>
                        )}
                        {isSpace && (
                            <span className="text-[10px] uppercase tracking-wide font-semibold px-1.5 py-0.5 rounded-full bg-bg-tertiary text-text-secondary">
                                Space
                            </span>
                        )}
                        {room.notificationMode === 'mentions' && !isSpace && (
                            <span className="text-[10px] uppercase tracking-wide font-semibold px-1.5 py-0.5 rounded-full bg-bg-tertiary text-text-secondary" title="Mentions only">
                                @
                            </span>
                        )}
                        {room.notificationMode === 'mute' && !isSpace && (
                            <span className="text-text-secondary" title="Notifications muted">🔕</span>
                        )}
                        {room.isEncrypted && !room.isSavedMessages && (
                             <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-text-secondary flex-shrink-0" viewBox="0 0 20 20" fill="currentColor">
                                <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
                            </svg>
                        )}
                    </p>
                    <p className="text-xs text-text-secondary flex-shrink-0">{timestamp}</p>
                </div>
                <div className="flex justify-between items-start">
                    <p className="text-sm text-text-secondary truncate flex items-center gap-2">
                        <span className="truncate">{renderMetaText()}</span>
                        {hasRecentAttachment && (
                            <span className="px-1.5 py-0.5 rounded-full bg-accent/10 text-[10px] uppercase tracking-wide text-accent font-semibold">Shared</span>
                        )}
                        {room.mentionCount && room.mentionCount > 0 && (
                            <span className="px-1.5 py-0.5 rounded-full bg-indigo-500/10 text-[10px] uppercase tracking-wide text-indigo-200" title="Новые упоминания">
                                @{room.mentionCount}
                            </span>
                        )}
                        {room.scheduledMessageCount && room.scheduledMessageCount > 0 && (
                            <span className="px-1.5 py-0.5 rounded-full bg-amber-500/10 text-[10px] uppercase tracking-wide text-amber-200" title="Отложенные сообщения">
                                ⏰ {room.scheduledMessageCount}
                            </span>
                        )}
                        {room.secureAlertCount && room.secureAlertCount > 0 && (
                            <span className="px-1.5 py-0.5 rounded-full bg-red-500/10 text-[10px] uppercase tracking-wide text-red-200" title="Оповещения Secure Cloud">
                                ⚠️ {room.secureAlertCount}
                            </span>
                        )}
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