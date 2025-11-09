import React, { useState, useRef, useEffect } from 'react';
import { Room, Message } from '@matrix-messenger/core';
import Avatar from './Avatar';
import PinnedMessageBar from './PinnedMessageBar';

interface ChatHeaderProps {
    room: Room;
    typingUsers?: string[];
    canInvite: boolean;
    onOpenInvite: () => void;
    pinnedMessage: Message | null;
    onPinToggle: (messageId: string) => void;
    scheduledMessageCount: number;
    onOpenViewScheduled: () => void;
    isDirectMessageRoom: boolean;
    onPlaceCall: (type: 'voice' | 'video') => void;
    onOpenSearch: () => void;
    onStartGroupCall?: () => void;
    onToggleScreenShare?: () => void;
    onOpenParticipants?: () => void;
    participantsCount?: number;
    isScreensharing?: boolean;
    connectionStatus?: 'online' | 'offline' | 'connecting';
    onOpenSharedMedia?: () => void;
    sharedMediaCount?: number;
}

const statusLabels: Record<NonNullable<Room['status']>, string> = {
    joined: 'Active',
    invited: 'Invitation',
    left: 'Archived',
};

const roomTypeLabels: Record<NonNullable<Room['roomType']>, string> = {
    direct: 'Direct chat',
    group: 'Group chat',
    saved: 'Saved messages',
};

const ChatHeader: React.FC<ChatHeaderProps> = ({
    room,
    typingUsers = [],
    canInvite,
    onOpenInvite,
    pinnedMessage,
    onPinToggle,
    scheduledMessageCount,
    onOpenViewScheduled,
    isDirectMessageRoom,
    onPlaceCall,
    onOpenSearch,
    onStartGroupCall,
    onToggleScreenShare,
    onOpenParticipants,
    participantsCount,
    isScreensharing,
    connectionStatus = 'online',
    onOpenSharedMedia,
    sharedMediaCount = 0,
}) => {
    const [callMenuOpen, setCallMenuOpen] = useState(false);
    const callMenuRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const onClick = (event: MouseEvent) => {
            if (callMenuRef.current && !callMenuRef.current.contains(event.target as Node)) {
                setCallMenuOpen(false);
            }
        };
        document.addEventListener('mousedown', onClick);
        return () => document.removeEventListener('mousedown', onClick);
    }, []);

    const typingText = (() => {
        const count = typingUsers.length;
        if (count === 0) return room.status === 'invited' ? 'Waiting for your response' : `Room ID: ${room.roomId}`;
        if (count === 1) return `${typingUsers[0]} is typing…`;
        if (count === 2) return `${typingUsers[0]} and ${typingUsers[1]} are typing…`;
        return 'Several people are typing…';
    })();

    const statusBadge = room.status ? statusLabels[room.status] : undefined;
    const typeBadge = room.roomType ? roomTypeLabels[room.roomType] : undefined;

    return (
        <header className="bg-bg-primary shadow-sm z-10 flex-shrink-0 border-b border-border-secondary">
            <div className="flex items-center px-4 py-3 gap-3">
                <Avatar name={room.name} imageUrl={room.avatarUrl || undefined} />
                <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                        <h2 className="font-semibold text-lg text-text-primary truncate">{room.name}</h2>
                        {room.isEncrypted && (
                            <span className="px-2 py-0.5 text-xs rounded-full bg-chip-selected text-text-inverted">E2EE</span>
                        )}
                        {typeBadge && (
                            <span className="px-2 py-0.5 text-xs rounded-full bg-bg-tertiary text-text-secondary">{typeBadge}</span>
                        )}
                        {statusBadge && (
                            <span className="px-2 py-0.5 text-xs rounded-full bg-chip-selected text-text-inverted">{statusBadge}</span>
                        )}
                        {connectionStatus !== 'online' && (
                            <span className="px-2 py-0.5 text-xs rounded-full bg-status-offline text-text-inverted capitalize">
                                {connectionStatus}
                            </span>
                        )}
                    </div>
                    <p className="text-xs text-text-secondary min-h-[16px] transition-all">{typingText}</p>
                </div>
                <div className="flex items-center gap-2">
                    {onStartGroupCall && (
                        <button
                            onClick={onStartGroupCall}
                            className="p-2 rounded-full hover:bg-bg-tertiary"
                            title="Start group call"
                        >
                            📞
                        </button>
                    )}
                    {onToggleScreenShare && (
                        <button
                            onClick={onToggleScreenShare}
                            className={`p-2 rounded-full hover:bg-bg-tertiary ${isScreensharing ? 'text-accent' : ''}`}
                            title="Toggle screen sharing"
                        >
                            🖥️
                        </button>
                    )}
                    {onOpenParticipants && (
                        <button
                            onClick={onOpenParticipants}
                            className="p-2 rounded-full hover:bg-bg-tertiary relative"
                            title="Participants"
                        >
                            👥
                            {participantsCount && participantsCount > 0 && (
                                <span className="absolute -top-1 -right-1 bg-accent text-text-inverted text-xs font-bold rounded-full h-4 w-4 flex items-center justify-center">
                                    {participantsCount}
                                </span>
                            )}
                        </button>
                    )}
                    <button
                        onClick={onOpenSearch}
                        className="p-2 rounded-full hover:bg-bg-tertiary"
                        title="Search messages"
                    >
                        🔍
                    </button>
                    {onOpenSharedMedia && (
                        <button
                            onClick={onOpenSharedMedia}
                            className="p-2 rounded-full hover:bg-bg-tertiary relative"
                            title="Shared media"
                        >
                            📎
                            {sharedMediaCount > 0 && (
                                <span className="absolute -top-1 -right-1 bg-accent text-text-inverted text-xs font-bold rounded-full h-4 min-w-[16px] px-1 flex items-center justify-center">
                                    {sharedMediaCount}
                                </span>
                            )}
                        </button>
                    )}
                    {scheduledMessageCount > 0 && (
                        <button
                            onClick={onOpenViewScheduled}
                            className="p-2 rounded-full hover:bg-bg-tertiary relative"
                            title="View scheduled messages"
                        >
                            🕒
                            <span className="absolute -top-1 -right-1 bg-accent text-text-inverted text-xs font-bold rounded-full h-4 w-4 flex items-center justify-center">
                                {scheduledMessageCount}
                            </span>
                        </button>
                    )}
                    {isDirectMessageRoom ? (
                        <div className="relative" ref={callMenuRef}>
                            <button
                                onClick={() => setCallMenuOpen(prev => !prev)}
                                className="p-2 rounded-full hover:bg-bg-tertiary"
                                title="Start a call"
                            >
                                📱
                            </button>
                            {callMenuOpen && (
                                <div className="absolute right-0 mt-2 w-44 bg-bg-secondary border border-border-primary rounded-md shadow-lg z-20">
                                    <button
                                        onClick={() => { onPlaceCall('voice'); setCallMenuOpen(false); }}
                                        className="w-full text-left flex items-center gap-3 px-4 py-2 text-sm text-text-primary hover:bg-bg-tertiary"
                                    >
                                        🎤 Voice call
                                    </button>
                                    <button
                                        onClick={() => { onPlaceCall('video'); setCallMenuOpen(false); }}
                                        className="w-full text-left flex items-center gap-3 px-4 py-2 text-sm text-text-primary hover:bg-bg-tertiary"
                                    >
                                        🎥 Video call
                                    </button>
                                </div>
                            )}
                        </div>
                    ) : (
                        <button
                            onClick={onStartGroupCall}
                            className="p-2 rounded-full hover:bg-bg-tertiary"
                            title="Start group call"
                        >
                            🎬
                        </button>
                    )}
                    {canInvite && (
                        <button
                            onClick={onOpenInvite}
                            className="p-2 rounded-full hover:bg-bg-tertiary"
                            title="Invite user"
                        >
                            ➕
                        </button>
                    )}
                </div>
            </div>
            {pinnedMessage && (
                <PinnedMessageBar message={pinnedMessage} onUnpin={() => onPinToggle(pinnedMessage.id)} />
            )}
        </header>
    );
};

export default ChatHeader;
