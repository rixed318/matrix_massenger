import React, { useState } from 'react';
import { Room, MatrixClient, Folder } from '@matrix-messenger/core';
import RoomListItem from './RoomListItem';
import Avatar from './Avatar';
import { mxcToHttp } from '@matrix-messenger/core';
import { AccountListItemSnapshot } from '../services/accountManager';
import type { PresenceSummary } from '../utils/presence';

interface RoomListProps {
  rooms: Room[];
  selectedRoomId: string | null;
  onSelectRoom: (roomId: string) => void;
  isLoading: boolean;
  onLogout: () => void;
  client: MatrixClient;
  onOpenSettings: () => void;
  onOpenPlugins: () => void;
  onOpenCreateRoom: () => void;
  folders: Folder[];
  activeFolderId: string;
  onSelectFolder: (folderId: string) => void;
  onManageFolders: () => void;
  accounts: AccountListItemSnapshot[];
  activeAccountKey: string | null;
  onSwitchAccount: (key: string) => void;
  onAddAccount: () => void;
  hiddenRoomIds?: string[];
  onUnlockHidden?: () => void;
  isHiddenUnlocked?: boolean;
  presenceSummaries?: Map<string, PresenceSummary>;
}

const RoomList: React.FC<RoomListProps> = ({
  rooms, selectedRoomId, onSelectRoom, isLoading, onLogout, client,
  onOpenSettings, onOpenPlugins, onOpenCreateRoom, folders, activeFolderId, onSelectFolder, onManageFolders,
  accounts, activeAccountKey, onSwitchAccount, onAddAccount,
  hiddenRoomIds = [], onUnlockHidden, isHiddenUnlocked = true,
  presenceSummaries,
}) => {
  const user = client.getUser(client.getUserId());
  const userAvatarUrl = mxcToHttp(client, user?.avatarUrl);
  const [searchQuery, setSearchQuery] = useState('');

  const filteredRoomsByFolder = (activeFolderId === 'all'
    ? rooms
    : rooms.filter(r => folders.find(f => f.id === activeFolderId)?.roomIds.includes(r.roomId))
  );

  const filteredRooms = filteredRoomsByFolder.filter(room => 
    room.name.toLowerCase().includes(searchQuery.toLowerCase())
  );
  
  const getFolderUnreadCount = (folder: Folder) => {
    return folder.roomIds.reduce((acc, roomId) => {
      const room = rooms.find(r => r.roomId === roomId);
      return acc + (room?.unreadCount || 0);
    }, 0);
  };

  const allChatsUnreadCount = rooms.reduce((acc, room) => acc + room.unreadCount, 0);

  const FolderTab: React.FC<{id: string; name: string; unreadCount: number;}> = ({id, name, unreadCount}) => (
    <button 
      onClick={() => onSelectFolder(id)} 
      className={`relative px-4 py-2 text-sm font-medium transition-colors border-b-2 whitespace-nowrap ${activeFolderId === id ? 'border-text-accent text-text-primary' : 'border-transparent text-text-secondary hover:text-text-primary'}`}
    >
      {name}
      {unreadCount > 0 && (
        <span className="absolute top-1 right-0 block h-5 min-w-[20px] px-1.5 py-0.5 text-xs font-bold bg-accent rounded-full text-text-inverted">
          {unreadCount}
        </span>
      )}
    </button>
  );

  return (
    <aside className="w-80 bg-bg-primary flex flex-col">
      <div className="p-4 border-b border-border-primary">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-bold">Chats</h1>
          <div className="flex items-center gap-2">
            <button onClick={onOpenCreateRoom} className="p-2 rounded-full hover:bg-bg-tertiary" title="Create Room">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clipRule="evenodd" />
              </svg>
            </button>
            <button onClick={onAddAccount} className="p-2 rounded-full hover:bg-bg-tertiary" title="Add account">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor"><path d="M12 7a5 5 0 100 10 5 5 0 000-10zm-1 6H8v-2h3V8h2v3h3v2h-3v3h-2v-3z"/></svg>
            </button>
            <button onClick={onLogout} className="p-2 rounded-full hover:bg-bg-tertiary" title="Logout active">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M3 3a1 1 0 00-1 1v12a1 1 0 102 0V4a1 1 0 00-1-1zm10.293 9.293a1 1 0 001.414 1.414l3-3a1 1 0 000-1.414l-3-3a1 1 0 10-1.414 1.414L14.586 9H7a1 1 0 100 2h7.586l-1.293 1.293z" clipRule="evenodd" />
              </svg>
            </button>
          </div>
        </div>

        <div className="mt-3 flex items-center gap-2 overflow-x-auto">
          {accounts.map(account => (
            <button
              key={account.key}
              onClick={() => onSwitchAccount(account.key)}
              className={`relative p-1 rounded-full ${account.key === activeAccountKey ? 'ring-2 ring-accent' : ''}`}
              title={`${account.displayName || account.userId}`}
            >
              <Avatar name={account.displayName || account.userId} imageUrl={account.avatarUrl || undefined} size="sm" />
              {account.unread > 0 && (
                <span className="absolute -top-1 -right-1 bg-accent text-text-inverted text-[10px] leading-none px-1.5 py-0.5 rounded-full">
                  {account.unread}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-shrink-0 border-b border-border-primary">
        <div className="flex items-center overflow-x-auto px-2">
          <FolderTab id="all" name="All Chats" unreadCount={allChatsUnreadCount} />
          {folders.map(folder => (
            <FolderTab key={folder.id} id={folder.id} name={folder.name} unreadCount={getFolderUnreadCount(folder)} />
          ))}
          <button onClick={onManageFolders} className="ml-auto p-2 text-text-secondary hover:text-text-primary" title="Manage folders">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
              <path d="M17.408 8.366A4.5 4.5 0 0012.5 4H8.698A4.502 4.502 0 004 8.698V12.5a4.5 4.5 0 004.698 4.408l.38-.19a3 3 0 012.224 0l.38.19A4.5 4.5 0 0016 12.5V8.698a4.502 4.502 0 00-.092-.832zM14.5 12.5a3 3 0 01-3-3h-3a3 3 0 01-3 3v-3.802a3 3 0 013-3h3.802a3 3 0 013 3V12.5z" />
            </svg>
          </button>
        </div>
      </div>

      <div className="p-2 border-b border-border-primary">
        <input
          type="text"
          placeholder="Search chats..."
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          className="w-full bg-bg-secondary text-text-primary px-3 py-2 rounded-md focus:outline-none focus:ring-1 focus:ring-ring-focus sm:text-sm"
        />
      </div>

      {!isHiddenUnlocked && hiddenRoomIds.length > 0 && (
        <div className="px-3 pb-2 text-xs text-text-secondary flex items-center justify-between gap-2">
          <span>Скрытые чаты заблокированы PIN-кодом.</span>
          {onUnlockHidden && (
            <button onClick={onUnlockHidden} className="text-accent hover:underline text-xs font-semibold">Разблокировать</button>
          )}
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="p-4 text-text-secondary">Loading rooms...</div>
        ) : (
          <ul>
            {filteredRooms.map(room => (
              <RoomListItem
                key={room.roomId}
                room={room}
                isSelected={room.roomId === selectedRoomId}
                onSelect={() => onSelectRoom(room.roomId)}
                presenceSummary={presenceSummaries?.get(room.roomId)}
              />
            ))}
          </ul>
        )}
      </div>

      <div className="p-4 border-t border-border-primary flex items-center justify-between gap-3">
        <div className="flex items-center">
          <Avatar name={user?.displayName || client.getUserId()} imageUrl={userAvatarUrl} size="sm" />
          <div className="ml-3">
            <p className="font-semibold text-sm">{user?.displayName || 'User'}</p>
            <p className="text-xs text-text-secondary">{client.getUserId()}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={onOpenPlugins} className="p-2 rounded-full hover:bg-bg-tertiary" title="Plugins">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
              <path d="M19 11h-2.17a3.001 3.001 0 00-5.66 0H9a1 1 0 100 2h2.17a3.001 3.001 0 005.66 0H19a1 1 0 100-2zm-7-9a1 1 0 00-1 1v2.17a3.001 3.001 0 000 5.66V13a1 1 0 102 0v-2.17a3.001 3.001 0 000-5.66V3a1 1 0 00-1-1zM5 11a1 1 0 100 2h2.17a3.001 3.001 0 005.66 0H15a1 1 0 100-2h-2.17a3.001 3.001 0 00-5.66 0H5z" />
            </svg>
          </button>
          <button onClick={onOpenSettings} className="p-2 rounded-full hover:bg-bg-tertiary" title="Settings">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01-.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z" clipRule="evenodd" />
            </svg>
          </button>
        </div>
      </div>
    </aside>
  );
};

export default RoomList;
