import React, { useState, useRef, useEffect } from 'react';
import { Room, Message, RoomNotificationMode } from '@matrix-messenger/core';
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
    canStartGroupCall?: boolean;
    groupCallDisabledReason?: string | null;
    connectionStatus?: 'online' | 'offline' | 'connecting';
    notificationMode?: RoomNotificationMode;
    onNotificationModeChange?: (mode: RoomNotificationMode) => void;
    onMuteRoom?: () => void;
    selfDestructSeconds?: number | null;
    onSelfDestructChange?: (seconds: number | null) => void;
    isHiddenRoom?: boolean;
    onToggleHiddenRoom?: () => void;
    appLockEnabled?: boolean;
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

const notificationModeLabels: Record<RoomNotificationMode, string> = {
    all: 'Enabled',
    mentions: 'Mentions only',
    mute: 'Muted',
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
    notificationMode = 'all',
    onNotificationModeChange,
    onMuteRoom,
    selfDestructSeconds,
    onSelfDestructChange,
    isHiddenRoom = false,
    onToggleHiddenRoom,
    appLockEnabled = false,
}) => {
    const [callMenuOpen, setCallMenuOpen] = useState(false);
    const callMenuRef = useRef<HTMLDivElement>(null);
    const [notificationMenuOpen, setNotificationMenuOpen] = useState(false);
    const notificationMenuRef = useRef<HTMLDivElement>(null);
    const [timerMenuOpen, setTimerMenuOpen] = useState(false);
    const timerMenuRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const onClick = (event: MouseEvent) => {
            if (callMenuRef.current && !callMenuRef.current.contains(event.target as Node)) {
                setCallMenuOpen(false);
            }
            if (notificationMenuRef.current && !notificationMenuRef.current.contains(event.target as Node)) {
                setNotificationMenuOpen(false);
            }
            if (timerMenuRef.current && !timerMenuRef.current.contains(event.target as Node)) {
                setTimerMenuOpen(false);
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
    const notificationIcon = notificationMode === 'mute' ? '🔕' : '🔔';
    const timerOptions: Array<{ label: string; seconds: number | null }> = [
        { label: 'Выключено', seconds: null },
        { label: '30 секунд', seconds: 30 },
        { label: '5 минут', seconds: 5 * 60 },
        { label: '1 час', seconds: 60 * 60 },
        { label: '1 день', seconds: 24 * 60 * 60 },
    ];
    const formatTimer = (seconds: number | null | undefined) => {
        if (!seconds) return 'Выключено';
        if (seconds < 60) return `${seconds}с`;
        if (seconds < 3600) {
            const minutes = Math.round(seconds / 60);
            return `${minutes}м`;
        }
        if (seconds < 86400) {
            const hours = Math.round(seconds / 3600);
            return `${hours}ч`;
        }
        const days = Math.round(seconds / 86400);
        return `${days}д`;
    };
    const timerSummary = formatTimer(selfDestructSeconds ?? null);

    const handleNotificationSelection = (mode: RoomNotificationMode) => {
        if (mode === 'mute') {
            onMuteRoom?.();
        } else {
            onNotificationModeChange?.(mode);
        }
        setNotificationMenuOpen(false);
    };

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
                        {selfDestructSeconds && selfDestructSeconds > 0 && (
                            <span className="px-2 py-0.5 text-xs rounded-full bg-amber-500/10 text-amber-300" title={`Самоуничтожение сообщений: ${timerSummary}`}>
                                ⏱ {timerSummary}
                            </span>
                        )}
                        {isHiddenRoom && (
                            <span className="px-2 py-0.5 text-xs rounded-full bg-purple-500/10 text-purple-200" title={appLockEnabled ? 'Чат скрыт и требует PIN' : 'Чат скрыт (PIN не настроен)'}>
                                🔒 Hidden
                            </span>
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
                    {onSelfDestructChange && (
                        <div className="relative" ref={timerMenuRef}>
                            <button
                                onClick={() => setTimerMenuOpen(prev => !prev)}
                                className="px-3 py-2 rounded-full hover:bg-bg-tertiary flex items-center gap-2 text-sm"
                                title="Самоуничтожение сообщений"
                            >
                                <span>⏱</span>
                                <span className="text-xs text-text-secondary">{timerSummary}</span>
                            </button>
                            {timerMenuOpen && (
                                <div className="absolute right-0 mt-2 w-52 bg-bg-secondary border border-border-primary rounded-md shadow-lg z-20 py-1">
                                    {timerOptions.map(option => (
                                        <button
                                            key={option.label}
                                            onClick={() => {
                                                onSelfDestructChange(option.seconds);
                                                setTimerMenuOpen(false);
                                            }}
                                            className={`w-full text-left flex items-center gap-2 px-4 py-2 text-sm hover:bg-bg-tertiary ${selfDestructSeconds === option.seconds ? 'text-text-primary font-semibold' : 'text-text-secondary'}`}
                                        >
                                            {option.label}
                                        </button>
                                    ))}
                                    <p className="px-4 py-2 text-[11px] text-text-secondary/70 border-t border-border-primary">
                                        Участники получат уведомление при изменении таймера.
                                    </p>
                                </div>
                            )}
                        </div>
                    )}
                    <div className="relative" ref={notificationMenuRef}>
                        <button
                            onClick={() => setNotificationMenuOpen(prev => !prev)}
                            className="px-3 py-2 rounded-full hover:bg-bg-tertiary flex items-center gap-2 text-sm"
                            title="Notifications"
                        >
                            <span>{notificationIcon}</span>
                            <span className="text-xs text-text-secondary">{notificationModeLabels[notificationMode]}</span>
                        </button>
                        {notificationMenuOpen && (
                            <div className="absolute right-0 mt-2 w-48 bg-bg-secondary border border-border-primary rounded-md shadow-lg z-20 py-1">
                                <button
                                    onClick={() => handleNotificationSelection('all')}
                                    className={`w-full text-left flex items-center gap-2 px-4 py-2 text-sm hover:bg-bg-tertiary ${notificationMode === 'all' ? 'text-text-primary font-semibold' : 'text-text-secondary'}`}
                                >
                                    🔔 Enabled
                                </button>
                                <button
                                    onClick={() => handleNotificationSelection('mentions')}
                                    className={`w-full text-left flex items-center gap-2 px-4 py-2 text-sm hover:bg-bg-tertiary ${notificationMode === 'mentions' ? 'text-text-primary font-semibold' : 'text-text-secondary'}`}
                                >
                                    @ Mentions only
                                </button>
                                <button
                                    onClick={() => handleNotificationSelection('mute')}
                                    className={`w-full text-left flex items-center gap-2 px-4 py-2 text-sm hover:bg-bg-tertiary ${notificationMode === 'mute' ? 'text-text-primary font-semibold' : 'text-text-secondary'}`}
                                >
                                    🔕 Muted
                                </button>
                            </div>
                        )}
                    </div>
                    {onStartGroupCall && (
                        <button
                            onClick={canStartGroupCall === false ? undefined : onStartGroupCall}
                            className={`p-2 rounded-full ${canStartGroupCall === false ? 'opacity-50 cursor-not-allowed bg-bg-secondary text-text-tertiary' : 'hover:bg-bg-tertiary'}`}
                            title={canStartGroupCall === false ? groupCallDisabledReason || 'Недостаточно прав' : 'Начать групповой звонок'}
                            disabled={canStartGroupCall === false}
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
                    {onToggleHiddenRoom && (
                        <button
                            onClick={onToggleHiddenRoom}
                            className={`p-2 rounded-full hover:bg-bg-tertiary ${isHiddenRoom ? 'text-purple-200' : ''}`}
                            title={isHiddenRoom ? 'Сделать чат видимым' : 'Скрыть чат (требует PIN)'}
                        >
                            🔒
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
