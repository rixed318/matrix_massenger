import React, { useMemo, useState } from 'react';
import { Room, MatrixClient, Folder } from '@matrix-messenger/core';
import RoomListItem from './RoomListItem';
import Avatar from './Avatar';
import { mxcToHttp } from '@matrix-messenger/core';
import { AccountListItemSnapshot, useAccountStore } from '../services/accountManager';
import {
  UNIVERSAL_QUICK_FILTER_METADATA,
  UNIVERSAL_QUICK_FILTER_ORDER,
  evaluateQuickFilterMembership,
  type UniversalQuickFilterId,
} from '../utils/chatSelectors';
import { buildSearchIndexFromRooms, type RoomSearchResult } from '../utils/roomSearchIndex';

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

const quickFilterChipClass = (isActive: boolean) =>
  `px-3 py-1.5 text-xs font-medium rounded-full transition-colors ${
    isActive
      ? 'bg-chip-selected text-text-inverted shadow-sm'
      : 'bg-bg-tertiary text-text-secondary hover:text-text-primary'
  }`;

const MATCH_SOURCE_LABELS: Record<RoomSearchResult['source'], string> = {
  name: 'Название',
  alias: 'Алиас',
  message: 'Сообщение',
  account: 'Аккаунт',
};

const SUGGESTION_CATEGORY_PRIORITY: UniversalQuickFilterId[] = [
  'mentions',
  'secure',
  'scheduled',
  'hidden',
  'pinned',
  'unread',
  'service',
];

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
  const [isSearchFocused, setIsSearchFocused] = useState(false);

  const { activeQuickFilterId, setActiveQuickFilterId } = useAccountStore(state => ({
    activeQuickFilterId: state.activeQuickFilterId,
    setActiveQuickFilterId: state.setActiveQuickFilterId,
  }));

  const activeAccount = accounts.find(account => account.key === activeAccountKey) ?? null;
  const accountBadge = activeAccount?.displayName ?? activeAccount?.userId ?? null;

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
  }, [rooms, folders, activeFolderId]);

  const quickFilterMap = useMemo(() => {
    const map = new Map<string, ReturnType<typeof evaluateQuickFilterMembership>>();
    rooms.forEach(room => {
      map.set(
        room.roomId,
        evaluateQuickFilterMembership({
          unreadCount: room.unreadCount,
          isServiceRoom: room.isServiceRoom,
          mentionCount: room.mentionCount,
          scheduledMessageCount: room.scheduledMessageCount,
          secureAlertCount: room.secureAlertCount,
          isHidden: room.isHidden,
          pinnedEvents: room.pinnedEvents,
        }),
      );
    });
    return map;
  }, [rooms]);

  const quickFilterSummaries = useMemo(() => {
    const accumulator = UNIVERSAL_QUICK_FILTER_ORDER.reduce(
      (acc, id) => {
        acc[id] = { roomCount: 0, unreadCount: 0 };
        return acc;
      },
      {} as Record<UniversalQuickFilterId, { roomCount: number; unreadCount: number }>,
    );

    rooms.forEach(room => {
      const membership = quickFilterMap.get(room.roomId);
      if (!membership) {
        return;
      }
      (Object.entries(membership) as Array<[UniversalQuickFilterId, boolean]>).forEach(([id, matches]) => {
        if (!matches) {
          return;
        }
        accumulator[id].roomCount += 1;
        accumulator[id].unreadCount += room.unreadCount ?? 0;
      });
    });

    return UNIVERSAL_QUICK_FILTER_ORDER
      .filter(id => id === 'all' || accumulator[id].roomCount > 0)
      .map(id => ({
        id,
        roomCount: accumulator[id].roomCount,
        unreadCount: accumulator[id].unreadCount,
        label: UNIVERSAL_QUICK_FILTER_METADATA[id].label,
        description: UNIVERSAL_QUICK_FILTER_METADATA[id].description,
      }));
  }, [rooms, quickFilterMap]);

  const roomsMatchingFilter = useMemo(() => {
    return roomsByFolder.filter(room => {
      const membership = quickFilterMap.get(room.roomId);
      if (!membership) {
        return false;
      }
      return membership[activeQuickFilterId];
    });
  }, [roomsByFolder, quickFilterMap, activeQuickFilterId]);

  const searchIndex = useMemo(
    () => buildSearchIndexFromRooms(roomsMatchingFilter, accountBadge),
    [roomsMatchingFilter, accountBadge],
  );

  const searchResults = useMemo(() => {
    const trimmed = searchQuery.trim();
    if (!trimmed) {
      return [] as RoomSearchResult[];
    }
    return searchIndex.search(trimmed, 8);
  }, [searchIndex, searchQuery]);

  const roomById = useMemo(() => {
    const map = new Map<string, Room>();
    roomsMatchingFilter.forEach(room => {
      map.set(room.roomId, room);
    });
    return map;
  }, [roomsMatchingFilter]);

  const orderedRooms = useMemo(() => {
    const trimmed = searchQuery.trim();
    if (!trimmed) {
      return roomsMatchingFilter;
    }
    const orderMap = new Map<string, number>();
    searchResults.forEach((result, index) => {
      orderMap.set(result.roomId, index);
    });
    return roomsMatchingFilter
      .filter(room => orderMap.has(room.roomId))
      .sort((a, b) => (orderMap.get(a.roomId) ?? 0) - (orderMap.get(b.roomId) ?? 0));
  }, [roomsMatchingFilter, searchResults, searchQuery]);

  const suggestions = useMemo(() => {
    if (!searchQuery.trim()) {
      return [] as Array<{ room: Room; result: RoomSearchResult; category: UniversalQuickFilterId }>;
    }
    return searchResults
      .map(result => {
        const room = roomById.get(result.roomId);
        if (!room) {
          return null;
        }
        const membership = quickFilterMap.get(room.roomId);
        let category: UniversalQuickFilterId = 'all';
        if (membership) {
          const matched = SUGGESTION_CATEGORY_PRIORITY.find(id => membership[id]);
          if (matched) {
            category = matched;
          } else if (membership.unread) {
            category = 'unread';
          }
        }
        return { room, result, category };
      })
      .filter((entry): entry is { room: Room; result: RoomSearchResult; category: UniversalQuickFilterId } => Boolean(entry))
      .slice(0, 5);
  }, [searchResults, roomById, quickFilterMap, searchQuery]);
  
  const getFolderUnreadCount = (folder: Folder) => {
    return folder.roomIds.reduce((acc, roomId) => {
      const room = rooms.find(r => r.roomId === roomId);
      return acc + (room?.unreadCount ?? 0);
    }, 0);
  };

  const allChatsUnreadCount = rooms.reduce((acc, room) => acc + (room.unreadCount ?? 0), 0);

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
        <div className="relative">
          <input
            type="text"
            placeholder="Search chats..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            onFocus={() => setIsSearchFocused(true)}
            onBlur={() => window.setTimeout(() => setIsSearchFocused(false), 120)}
            className="w-full bg-bg-secondary text-text-primary px-3 py-2 pr-9 rounded-md focus:outline-none focus:ring-1 focus:ring-ring-focus sm:text-sm"
          />
          {searchQuery && (
            <button
              type="button"
              onMouseDown={event => {
                event.preventDefault();
                setSearchQuery('');
              }}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-text-secondary hover:text-text-primary"
              aria-label="Очистить поиск"
            >
              ×
            </button>
          )}
          {isSearchFocused && suggestions.length > 0 && (
            <ul className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-md border border-border-secondary bg-bg-primary shadow-lg">
              {suggestions.map(({ room, result, category }) => (
                <li key={`${room.roomId}-${result.source}`} className="border-b border-border-tertiary last:border-none">
                  <button
                    type="button"
                    onMouseDown={event => {
                      event.preventDefault();
                      setSearchQuery('');
                      setIsSearchFocused(false);
                      onSelectRoom(room.roomId);
                    }}
                    className="flex w-full flex-col gap-1 px-3 py-2 text-left hover:bg-bg-tertiary"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-semibold text-text-primary truncate">{room.name}</span>
                      <span className="text-[11px] uppercase tracking-wide text-text-secondary">
                        {UNIVERSAL_QUICK_FILTER_METADATA[category].label}
                      </span>
                    </div>
                    <span className="text-[11px] text-text-secondary">
                      Совпадение: {MATCH_SOURCE_LABELS[result.source]}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="px-2 py-2 border-b border-border-primary">
        <div className="flex flex-wrap gap-2">
          {quickFilterSummaries.map(summary => (
            <button
              key={summary.id}
              type="button"
              onClick={() => setActiveQuickFilterId(summary.id)}
              className={quickFilterChipClass(activeQuickFilterId === summary.id)}
              title={summary.description ?? summary.label}
            >
              <span>{summary.label}</span>
              <span className="ml-2 inline-flex min-w-[1.5rem] items-center justify-center rounded-full bg-bg-secondary px-1.5 text-[11px] font-semibold">
                {summary.id === 'all' ? summary.roomCount : summary.unreadCount || summary.roomCount}
              </span>
            </button>
          ))}
        </div>
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
            {orderedRooms.map(room => (
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
