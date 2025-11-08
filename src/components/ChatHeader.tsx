import React, { useState, useRef, useEffect } from 'react';
import { Room, Message } from '../types';
import Avatar from './Avatar';
import PinnedMessageBar from './PinnedMessageBar';

interface ChatHeaderProps {
    onStartGroupCall?: () => void;
    onToggleScreenShare?: () => void;
    onOpenParticipants?: () => void;
    isScreensharing?: boolean;
    participantsCount?: number;
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
}

const ChatHeader: React.FC<ChatHeaderProps> = ({
    room, typingUsers = [], canInvite, onOpenInvite, pinnedMessage, onPinToggle,
    scheduledMessageCount, onOpenViewScheduled, isDirectMessageRoom, onPlaceCall, onOpenSearch
}) => {
    const [callMenuOpen, setCallMenuOpen] = useState(false);
    const callMenuRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (callMenuRef.current && !callMenuRef.current.contains(event.target as Node)) {
                setCallMenuOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const getTypingText = () => {
        const count = typingUsers.length;
        if (count === 0) return `Room ID: ${room.roomId}`;
        if (count === 1) return `${typingUsers[0]} is typing...`;
        if (count === 2) return `${typingUsers[0]} and ${typingUsers[1]} are typing...`;
        return 'Several people are typing...';
    };

    return (
        <header className="bg-bg-primary shadow-sm z-10 flex-shrink-0">
            <div className="flex items-center p-3 border-b border-border-secondary">
                <Avatar name={room.name} imageUrl={room.avatarUrl} />
                <div className="ml-3 flex-1">
                    <h2 className="font-bold flex items-center gap-2">
                        {room.name}
                        {room.isEncrypted && (
                            // FIX: Replaced the 'title' attribute on the SVG element with a nested `<title>` element to comply with React's SVG prop types and improve accessibility.
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-text-secondary" viewBox="0 0 20 20" fill="currentColor">
                                <title>End-to-end encrypted</title>
                                <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
                            </svg>
                        )}
                    </h2>
                    <p className="text-xs text-text-secondary min-h-[16px] transition-all">
                        {getTypingText()}
                    </p>
                </div>
                <div className="ml-auto flex items-center gap-2">
                    <button
                        onClick={onStartGroupCall}
                        className="p-2 rounded-full hover:bg-bg-tertiary"
                        title="Групповой звонок"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                            <path d="M13 7a3 3 0 11-6 0 3 3 0 016 0z" />
                            <path fillRule="evenodd" d="M2 13a5 5 0 015-5h6a5 5 0 015 5v2a1 1 0 01-1 1H3a1 1 0 01-1-1v-2z" clipRule="evenodd" />
                        </svg>
                    </button>
                    <button
                        onClick={onToggleScreenShare}
                        className="p-2 rounded-full hover:bg-bg-tertiary"
                        title="Экран"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                            <path d="M2 3a1 1 0 011-1h14a1 1 0 011 1v9a1 1 0 01-1 1H3a1 1 0 01-1-1V3z" /><path d="M7 16a1 1 0 100 2h6a1 1 0 100-2H7z"/>
                        </svg>
                    </button>
                    <button
                        onClick={onOpenParticipants}
                        className="p-2 rounded-full hover:bg-bg-tertiary relative"
                        title="Участники"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                           <path d="M13 7a3 3 0 11-6 0 3 3 0 016 0z" />
                           <path fillRule="evenodd" d="M2 13a5 5 0 015-5h6a5 5 0 015 5v2a1 1 0 01-1 1H3a1 1 0 01-1-1v-2z" clipRule="evenodd" />
                        </svg>
                        {typeof participantsCount === 'number' && participantsCount > 0 && (
                          <span className="absolute -top-1 -right-1 bg-accent text-text-inverted text-xs font-bold rounded-full h-4 w-4 flex items-center justify-center">
                            {participantsCount}
                          </span>
                        )}
                    </button>

                    <button
                        onClick={onOpenSearch}
                        className="p-2 rounded-full hover:bg-bg-tertiary"
                        title="Поиск по сообщениям (Ctrl/Cmd + K)"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                            <path fillRule="evenodd" d="M12.9 14.32a7 7 0 111.414-1.414l4.387 4.387a1 1 0 01-1.414 1.414l-4.387-4.387zM14 9a5 5 0 11-10 0 5 5 0 0110 0z" clipRule="evenodd" />
                        </svg>
                    </button>
                     {scheduledMessageCount > 0 && (
                        <button
                            onClick={onOpenViewScheduled}
                            className="p-2 rounded-full hover:bg-bg-tertiary relative" 
                            title="View scheduled messages"
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clipRule="evenodd" />
                            </svg>
                             <span className="absolute -top-1 -right-1 bg-accent text-text-inverted text-xs font-bold rounded-full h-4 w-4 flex items-center justify-center">
                                {scheduledMessageCount}
                            </span>
                        </button>
                    )}
                    {isDirectMessageRoom && (
                        <div className="relative" ref={callMenuRef}>
                            <button
                                onClick={() => setCallMenuOpen(prev => !prev)}
                                className="p-2 rounded-full hover:bg-bg-tertiary"
                                title="Start call"
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                                    <path d="M2 3a1 1 0 011-1h2.153a1 1 0 01.986.836l.74 4.435a1 1 0 01-.54 1.06l-1.548.773a11.037 11.037 0 006.105 6.105l.774-1.548a1 1 0 011.059-.54l4.435.74a1 1 0 01.836.986V17a1 1 0 01-1 1h-2C7.82 18 2 12.18 2 5V3z" />
                                </svg>
                            </button>
                            {callMenuOpen && (
                                <div className="absolute right-0 mt-2 w-48 bg-bg-secondary border border-border-primary rounded-md shadow-lg z-20">
                                    <button onClick={() => { onPlaceCall('voice'); setCallMenuOpen(false); }} className="w-full text-left flex items-center gap-3 px-4 py-2 text-sm text-text-primary hover:bg-bg-tertiary">
                                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path d="M2 3a1 1 0 011-1h2.153a1 1 0 01.986.836l.74 4.435a1 1 0 01-.54 1.06l-1.548.773a11.037 11.037 0 006.105 6.105l.774-1.548a1 1 0 011.059-.54l4.435.74a1 1 0 01.836.986V17a1 1 0 01-1 1h-2C7.82 18 2 12.18 2 5V3z" /></svg>
                                        Voice Call
                                    </button>
                                     <button onClick={() => { onPlaceCall('video'); setCallMenuOpen(false); }} className="w-full text-left flex items-center gap-3 px-4 py-2 text-sm text-text-primary hover:bg-bg-tertiary">
                                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path d="M2 6a2 2 0 012-2h6a2 2 0 012 2v8a2 2 0 01-2 2H4a2 2 0 01-2-2V6zM14.553 7.106A1 1 0 0014 8v4a1 1 0 001.553.832l3-2a1 1 0 000-1.664l-3-2z" /></svg>
                                        Video Call
                                    </button>
                                </div>
                            )}
                        </div>
                    )}
                    {canInvite && (
                        <button 
                            onClick={onOpenInvite} 
                            className="p-2 rounded-full hover:bg-bg-tertiary" 
                            title="Invite user"
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                                <path d="M8 9a3 3 0 100-6 3 3 0 000 6zM8 11a6 6 0 016 6H2a6 6 0 016-6zM16 11a1 1 0 10-2 0v1h-1a1 1 0 100 2h1v1a1 1 0 102 0v-1h1a1 1 0 100-2h-1v-1z" />
                            </svg>
                        </button>
                    )}
                </div>
            </div>
            {pinnedMessage && (
                <PinnedMessageBar
                    message={pinnedMessage}
                    onUnpin={() => onPinToggle(pinnedMessage.id)}
                />
            )}
        </header>
    );
};

export default ChatHeader;