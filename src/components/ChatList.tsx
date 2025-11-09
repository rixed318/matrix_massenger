import React, { useMemo } from 'react';
import { Folder, MatrixClient, Room } from '../types';
import Avatar from './Avatar';
import RoomListItem from './RoomListItem';
import { mxcToHttp } from '../services/matrixService';
import { ChatRoomStatus, ChatRoomType } from '../hooks/useChats';

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
    const user = client.getUser(client.getUserId());
    const userAvatarUrl = mxcToHttp(client, user?.avatarUrl);

    const roomsByFolder = useMemo(() => {
        if (activeFolderId === 'all') {
            return rooms;
        }
        const activeFolder = folders.find(folder => folder.id === activeFolderId);
        if (!activeFolder) {
            return rooms;
        }
        const allowedIds = new Set(activeFolder.roomIds);
        return rooms.filter(room => allowedIds.has(room.roomId));
    }, [activeFolderId, folders, rooms]);

    const folderUnread = (folder: Folder) => {
        return folder.roomIds.reduce((total, roomId) => {
            const target = allRooms.find(room => room.roomId === roomId);
            return total + (target?.unreadCount ?? 0);
        }, 0);
    };

    const totalUnread = allRooms.reduce((acc, room) => acc + (room.unreadCount ?? 0), 0);

    return (
        <aside className="chat-list bg-bg-primary border-r border-border-primary flex flex-col w-80">
            <div className="p-4 border-b border-border-secondary">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <Avatar name={user?.displayName || user?.userId || 'You'} imageUrl={userAvatarUrl || undefined} />
                        <div>
                            <p className="text-[11px] uppercase tracking-wide text-text-secondary">Активный профиль</p>
                            <p className="font-semibold text-text-primary max-w-[160px] truncate">{user?.displayName || user?.userId}</p>
                            <p className="text-xs text-text-secondary max-w-[160px] truncate">{client.getHomeserverUrl?.() ?? ''}</p>
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
            </div>

            <div className="border-b border-border-secondary px-4 py-3 space-y-2">
                <div className="relative">
                    <input
                        type="text"
                        value={searchTerm}
                        onChange={event => onSearchTermChange(event.target.value)}
                        placeholder="Search chats or messages"
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
                            className={`flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-full transition-colors ${roomTypeFilter === filter.value ? 'bg-chip-selected text-text-inverted' : 'bg-bg-tertiary text-text-secondary hover:text-text-primary'}`}
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
                            className={`px-3 py-1.5 text-xs font-medium rounded-md border transition-colors ${statusFilter === filter.value ? 'border-accent text-text-primary bg-chip-selected' : 'border-border-primary text-text-secondary hover:text-text-primary'}`}
                        >
                            {filter.label}
                        </button>
                    ))}
                </div>
            </div>

            <div className="flex-shrink-0 border-b border-border-secondary px-3">
                <div className="flex items-center gap-2 overflow-x-auto py-2">
                    <button
                        onClick={() => onSelectFolder('all')}
                        className={`relative px-4 py-2 text-sm font-medium rounded-md transition-colors ${activeFolderId === 'all' ? 'bg-chip-selected text-text-inverted' : 'bg-bg-tertiary text-text-secondary hover:text-text-primary'}`}
                    >
                        All ({totalUnread})
                    </button>
                    {folders.map(folder => (
                        <button
                            key={folder.id}
                            onClick={() => onSelectFolder(folder.id)}
                            className={`relative px-4 py-2 text-sm font-medium rounded-md transition-colors ${activeFolderId === folder.id ? 'bg-chip-selected text-text-inverted' : 'bg-bg-tertiary text-text-secondary hover:text-text-primary'}`}
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

            <div className="flex-1 overflow-y-auto">
                {isLoading ? (
                    <div className="p-4 text-text-secondary">Loading chats...</div>
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
            </div>
        </aside>
    );
};

export default ChatList;
