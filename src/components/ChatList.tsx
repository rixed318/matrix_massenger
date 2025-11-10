import React, { useMemo } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { Folder, MatrixClient, Room } from '../types';
import Avatar from './Avatar';
import RoomListItem from './RoomListItem';
import { mxcToHttp } from '../services/matrixService';
import { ChatRoomStatus, ChatRoomType } from '../hooks/useChats';
import {
    AggregatedRoomSnapshot,
    InboxViewMode,
    useAccountStore,
} from '../services/accountManager';
import {
    UNIVERSAL_QUICK_FILTER_METADATA,
    evaluateQuickFilterMembership,
    type UniversalQuickFilterId,
} from '../utils/chatSelectors';

interface ChatListProps {
    rooms: Room[];
    allRooms: Room[];
    selectedRoomId: string | null;
    onSelectRoom: (roomId: string) => void;
    isLoading: boolean;
    onLogout: () => void;
    client: MatrixClient;
    onOpenSettings: () => void;
    onOpenCreateRoom: () => void;
    folders: Folder[];
    activeFolderId: string;
    onSelectFolder: (folderId: string) => void;
    onManageFolders: () => void;
    searchTerm: string;
    onSearchTermChange: (value: string) => void;
    roomTypeFilter: ChatRoomType;
    onRoomTypeFilterChange: (value: ChatRoomType) => void;
    statusFilter: ChatRoomStatus;
    onStatusFilterChange: (value: ChatRoomStatus) => void;
}

const typeFilters: { value: ChatRoomType; label: string; icon: string }[] = [
    { value: 'all', label: 'All', icon: '🌐' },
    { value: 'direct', label: 'Direct', icon: '👤' },
    { value: 'group', label: 'Groups', icon: '👥' },
    { value: 'saved', label: 'Saved', icon: '⭐' },
];

const statusFilters: { value: ChatRoomStatus; label: string }[] = [
    { value: 'joined', label: 'Active' },
    { value: 'invited', label: 'Invites' },
    { value: 'all', label: 'All status' },
    { value: 'left', label: 'Archived' },
];

const quickFilterLabelClass = (isActive: boolean) =>
    `px-3 py-1.5 text-xs font-medium rounded-full transition-colors ${
        isActive ? 'bg-chip-selected text-text-inverted' : 'bg-bg-tertiary text-text-secondary hover:text-text-primary'
    }`;

const modeButtonClass = (currentMode: InboxViewMode, mode: InboxViewMode) =>
    `flex-1 px-3 py-1.5 text-xs font-semibold rounded-full transition-colors ${
        currentMode === mode
            ? 'bg-chip-selected text-text-inverted shadow-sm'
            : 'text-text-secondary hover:text-text-primary'
    }`;

const ChatList: React.FC<ChatListProps> = ({
    rooms,
    allRooms,
    selectedRoomId,
    onSelectRoom,
    isLoading,
    onLogout,
    client,
    onOpenSettings,
    onOpenCreateRoom,
    folders,
    activeFolderId,
    onSelectFolder,
    onManageFolders,
    searchTerm,
    onSearchTermChange,
    roomTypeFilter,
    onRoomTypeFilterChange,
    statusFilter,
    onStatusFilterChange,
}) => {
    const [smartCollections, setSmartCollections] = useState<SmartCollection[]>([]);

    useEffect(() => {
        let cancelled = false;
        const userId = client.getUserId?.();
        if (!userId) {
            setSmartCollections([]);
            return () => {
                cancelled = true;
            };
        }
        getSmartCollections(userId)
            .then(collections => {
                if (!cancelled) {
                    setSmartCollections(collections);
                }
            })
            .catch(() => {
                if (!cancelled) {
                    setSmartCollections([]);
                }
            });
        return () => {
            cancelled = true;
        };
    }, [client, rooms]);

    const user = client.getUser(client.getUserId());
    const userAvatarUrl = mxcToHttp(client, user?.avatarUrl);

    const {
        aggregatedRooms,
        aggregatedQuickFilters,
        aggregatedUnread,
        universalMode,
        activeQuickFilterId,
    } = useAccountStore(state => ({
        aggregatedRooms: state.aggregatedRooms,
        aggregatedQuickFilters: state.aggregatedQuickFilters,
        aggregatedUnread: state.aggregatedUnread,
        universalMode: state.universalMode,
        activeQuickFilterId: state.activeQuickFilterId,
    }));
    const setUniversalMode = useAccountStore(state => state.setUniversalMode);
    const setActiveQuickFilterId = useAccountStore(state => state.setActiveQuickFilterId);
    const setActiveAccountKey = useAccountStore(state => state.setActiveKey);
    const activeAccountKey = useAccountStore(state => state.activeKey);
    const accountCount = useAccountStore(state => Object.keys(state.accounts).length);

    const isUniversal = universalMode === 'all';
    const canUseUniversal = accountCount > 1 || aggregatedRooms.length > 0;

    const roomsByFolder = useMemo(() => {
        if (isUniversal) {
            return rooms;
        }
        if (activeFolderId === 'all') {
            return rooms;
        }
        const activeFolder = folders.find(folder => folder.id === activeFolderId);
        if (!activeFolder) {
            return rooms;
        }
        const allowedIds = new Set(activeFolder.roomIds);
        return rooms.filter(room => allowedIds.has(room.roomId));
    }, [isUniversal, activeFolderId, folders, rooms]);

    const folderUnread = (folder: Folder) =>
        folder.roomIds.reduce((total, roomId) => {
            const target = allRooms.find(room => room.roomId === roomId);
            return total + (target?.unreadCount ?? 0);
        }, 0);

    const totalUnread = allRooms.reduce((acc, room) => acc + (room.unreadCount ?? 0), 0);

    const aggregatedFilteredRooms = useMemo(() => {
        const query = searchTerm.trim().toLowerCase();
        return aggregatedRooms.filter(room => {
            const membership = evaluateQuickFilterMembership(room);
            if (!membership[activeQuickFilterId]) {
                return false;
            }

            const matchesType = roomTypeFilter === 'all' || room.roomType === roomTypeFilter;
            const matchesStatus = statusFilter === 'all' || room.status === statusFilter;
            if (!matchesType || !matchesStatus) {
                return false;
            }

            if (!query) {
                return true;
            }

            const nameMatch = room.name.toLowerCase().includes(query);
            const previewMatch = room.lastMessagePreview?.toLowerCase().includes(query) ?? false;
            return nameMatch || previewMatch;
        });
    }, [aggregatedRooms, activeQuickFilterId, roomTypeFilter, statusFilter, searchTerm]);

    const handleSelectAggregatedRoom = (room: AggregatedRoomSnapshot) => {
        setActiveAccountKey(room.accountKey);
        onSelectRoom(room.roomId);
    };

    const renderAggregatedRoom = (room: AggregatedRoomSnapshot) => {
        const lastMessage = room.lastMessage;
        const timestamp = room.lastMessageAt
            ? formatDistanceToNow(new Date(room.lastMessageAt), { addSuffix: true })
            : '';
        const hasRecentAttachment = !!lastMessage && (
            lastMessage.isSticker
            || ['m.image', 'm.video', 'm.audio', 'm.file', 'm.location'].includes(lastMessage.content.msgtype)
        );

        const renderMetaText = () => {
            if (room.isSpace) {
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
            if (room.isSpace) {
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
            return <Avatar name={room.name} imageUrl={room.avatarUrl || undefined} />;
        };

        const isSelected = room.roomId === selectedRoomId && activeAccountKey === room.accountKey;

        return (
            <li
                key={room.compositeId}
                onClick={() => handleSelectAggregatedRoom(room)}
                className={`flex flex-col p-3 cursor-pointer hover:bg-bg-tertiary ${isSelected ? 'bg-bg-hover' : ''}`}
            >
                <div className="flex items-center">
                    {renderAvatar()}
                    <div className="flex-1 ml-3 overflow-hidden">
                        <div className="flex justify-between items-center">
                            <p className="font-semibold text-sm truncate flex items-center gap-2">
                                {room.name}
                                {room.isSpace && (
                                    <span className="text-[10px] uppercase tracking-wide font-semibold px-1.5 py-0.5 rounded-full bg-bg-tertiary text-text-secondary">
                                        Space
                                    </span>
                                )}
                                {room.notificationMode === 'mentions' && !room.isSpace && (
                                    <span className="text-[10px] uppercase tracking-wide font-semibold px-1.5 py-0.5 rounded-full bg-bg-tertiary text-text-secondary" title="Mentions only">
                                        @
                                    </span>
                                )}
                                {room.notificationMode === 'mute' && !room.isSpace && (
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
                        <div className="flex flex-wrap items-center gap-2 mt-1 text-[11px] text-text-secondary">
                            <span
                                className="px-2 py-0.5 rounded-full bg-bg-tertiary truncate max-w-[160px]"
                                title={room.accountUserId}
                            >
                                {room.accountUserId}
                            </span>
                            <span className="px-2 py-0.5 rounded-full bg-bg-tertiary">{room.homeserverName}</span>
                        </div>
                        <div className="flex justify-between items-start mt-1">
                            <p className="text-sm text-text-secondary truncate flex items-center gap-2">
                                <span className="truncate">{renderMetaText()}</span>
                                {hasRecentAttachment && (
                                    <span className="px-1.5 py-0.5 rounded-full bg-accent/10 text-[10px] uppercase tracking-wide text-accent font-semibold">Shared</span>
                                )}
                            </p>
                            {room.unreadCount > 0 && (
                                <span className="bg-accent text-text-inverted text-xs font-bold rounded-full h-5 min-w-[1.25rem] px-1.5 flex items-center justify-center flex-shrink-0 ml-2">
                                    {room.unreadCount}
                                </span>
                            )}
                        </div>
                    </div>
                </div>
            </li>
        );
    };

    return (
        <aside className="chat-list bg-bg-primary border-r border-border-primary flex flex-col w-80">
            <div className="p-4 border-b border-border-secondary">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <Avatar name={user?.displayName || user?.userId || 'You'} imageUrl={userAvatarUrl || undefined} />
                        <div>
                            <p className="text-sm text-text-secondary">Logged in as</p>
                            <p className="font-semibold text-text-primary max-w-[160px] truncate">{user?.displayName || user?.userId}</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <button onClick={onOpenSettings} className="p-2 rounded-full hover:bg-bg-tertiary" title="Settings">
                            <span role="img" aria-label="settings">⚙️</span>
                        </button>
                        <button onClick={onLogout} className="p-2 rounded-full hover:bg-bg-tertiary" title="Logout">
                            <span role="img" aria-label="logout">🚪</span>
                        </button>
                    </div>
                </div>
                <div className="mt-4 flex items-center gap-2">
                    <button
                        onClick={onOpenCreateRoom}
                        className="flex-1 flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium rounded-md bg-accent text-text-inverted hover:bg-accent-hover transition-colors"
                    >
                        <span role="img" aria-label="new chat">➕</span>
                        New chat
                    </button>
                    <button
                        onClick={onManageFolders}
                        className="px-3 py-2 text-sm font-medium rounded-md border border-border-primary text-text-secondary hover:text-text-primary"
                    >
                        Folders
                    </button>
                </div>
                {canUseUniversal && (
                    <div className="mt-3 flex items-center gap-2 rounded-full bg-bg-secondary/60 p-1">
                        <button
                            type="button"
                            className={modeButtonClass(universalMode, 'active')}
                            onClick={() => setUniversalMode('active')}
                        >
                            Текущий аккаунт
                        </button>
                        <button
                            type="button"
                            className={`${modeButtonClass(universalMode, 'all')} flex items-center justify-center gap-1`}
                            onClick={() => setUniversalMode('all')}
                        >
                            Все аккаунты
                            {aggregatedUnread > 0 && (
                                <span className="inline-flex items-center justify-center rounded-full bg-accent text-text-inverted px-1.5 text-[10px] leading-none">
                                    {aggregatedUnread}
                                </span>
                            )}
                        </button>
                    </div>
                )}
            </div>

            <div className="border-b border-border-secondary px-4 py-3 space-y-2">
                <div className="relative">
                    <input
                        type="text"
                        value={searchTerm}
                        onChange={event => onSearchTermChange(event.target.value)}
                        placeholder={isUniversal ? 'Search across accounts' : 'Search chats or messages'}
                        className="w-full bg-bg-secondary text-text-primary px-4 py-2 rounded-md focus:outline-none focus:ring-2 focus:ring-ring-focus"
                    />
                    {searchTerm && (
                        <button
                            onClick={() => onSearchTermChange('')}
                            className="absolute right-2 top-1/2 -translate-y-1/2 text-text-secondary hover:text-text-primary"
                            aria-label="Clear search"
                        >
                            ×
                        </button>
                    )}
                </div>
                <div className="flex flex-wrap gap-2">
                    {typeFilters.map(filter => (
                        <button
                            key={filter.value}
                            onClick={() => onRoomTypeFilterChange(filter.value)}
                            className={`flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-full transition-colors ${
                                roomTypeFilter === filter.value ? 'bg-chip-selected text-text-inverted' : 'bg-bg-tertiary text-text-secondary hover:text-text-primary'
                            }`}
                        >
                            <span>{filter.icon}</span>
                            {filter.label}
                        </button>
                    ))}
                </div>
                <div className="flex gap-2 overflow-x-auto">
                    {statusFilters.map(filter => (
                        <button
                            key={filter.value}
                            onClick={() => onStatusFilterChange(filter.value)}
                            className={`px-3 py-1.5 text-xs font-medium rounded-md border transition-colors ${
                                statusFilter === filter.value
                                    ? 'border-accent text-text-primary bg-chip-selected'
                                    : 'border-border-primary text-text-secondary hover:text-text-primary'
                            }`}
                        >
                            {filter.label}
                        </button>
                    ))}
                </div>
                {isUniversal && (
                    <div className="flex flex-wrap gap-2">
                        {aggregatedQuickFilters
                            .filter(filter => filter.id === 'all' || filter.roomCount > 0)
                            .map(filter => (
                                <button
                                    key={filter.id}
                                    onClick={() => setActiveQuickFilterId(filter.id)}
                                    className={quickFilterLabelClass(activeQuickFilterId === filter.id)}
                                    title={filter.description ?? UNIVERSAL_QUICK_FILTER_METADATA[filter.id]?.description}
                                >
                                    <span>{filter.label}</span>
                                    <span className="ml-2 inline-flex items-center justify-center rounded-full bg-bg-secondary px-1.5 text-[10px]">
                                        {filter.unreadCount}
                                    </span>
                                </button>
                            ))}
                    </div>
                )}
            </div>

            {!isUniversal && (
                <div className="flex-shrink-0 border-b border-border-secondary px-3">
                    <div className="flex items-center gap-2 overflow-x-auto py-2">
                        <button
                            onClick={() => onSelectFolder('all')}
                            className={`relative px-4 py-2 text-sm font-medium rounded-md transition-colors ${
                                activeFolderId === 'all' ? 'bg-chip-selected text-text-inverted' : 'bg-bg-tertiary text-text-secondary hover:text-text-primary'
                            }`}
                        >
                            All ({totalUnread})
                        </button>
                        {folders.map(folder => (
                            <button
                                key={folder.id}
                                onClick={() => onSelectFolder(folder.id)}
                                className={`relative px-4 py-2 text-sm font-medium rounded-md transition-colors ${
                                    activeFolderId === folder.id ? 'bg-chip-selected text-text-inverted' : 'bg-bg-tertiary text-text-secondary hover:text-text-primary'
                                }`}
                            >
                                {folder.name}
                                {folderUnread(folder) > 0 && (
                                    <span className="ml-2 inline-flex items-center justify-center rounded-full bg-accent text-text-inverted px-2 text-xs">
                                        {folderUnread(folder)}
                                    </span>
                                )}
                            </button>
                        ))}
                    </div>
                </div>
            )}

            <div className="flex-1 overflow-y-auto">
                {isLoading && !isUniversal ? (
                    <div className="p-4 text-text-secondary">Loading chats...</div>
                ) : (
                    <>
                        {isUniversal ? (
                            aggregatedFilteredRooms.length === 0 ? (
                                <div className="p-4 text-text-secondary">
                                    {searchTerm ? 'No chats match your search.' : 'No messages across accounts yet.'}
                                </div>
                            ) : (
                                <ul className="space-y-1">
                                    {aggregatedFilteredRooms.map(room => renderAggregatedRoom(room))}
                                </ul>
                            )
                        ) : roomsByFolder.length === 0 ? (
                            <div className="p-4 text-text-secondary">
                                {searchTerm ? 'No chats match your search.' : 'No chats in this filter yet.'}
                            </div>
                        ) : (
                            <ul>
                                {roomsByFolder.map(room => (
                                    <RoomListItem
                                        key={room.roomId}
                                        room={room}
                                        isSelected={room.roomId === selectedRoomId}
                                        onSelect={() => onSelectRoom(room.roomId)}
                                    />
                                ))}
                            </ul>
                        )}
                    </>
                )}
            </div>
        </aside>
    );
};

export default ChatList;
