import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import RoomList from '../../src/components/RoomList';
import type { MatrixClient, Room, Folder } from '@matrix-messenger/core';
import { AccountProvider, getAccountStore } from '../../src/services/accountManager';
import { buildQuickFilterSummaries } from '../../src/utils/chatSelectors';

vi.mock('@matrix-messenger/core', async () => {
  const actual = await vi.importActual<any>('@matrix-messenger/core');
  return {
    ...actual,
    mxcToHttp: () => null,
  };
});

const createClient = (): MatrixClient => ({
  getUserId: () => '@tester:server',
  getUser: () => ({ displayName: 'Tester', avatarUrl: null }) as any,
} as MatrixClient);

const baseRooms: Room[] = [
  {
    roomId: 'room-1',
    name: 'General',
    topic: null,
    avatarUrl: null,
    lastMessage: null,
    unreadCount: 0,
    pinnedEvents: [],
    isEncrypted: false,
    isDirectMessageRoom: false,
    isSpace: false,
    spaceChildIds: [],
    spaceParentIds: [],
    canonicalAlias: null,
  } as unknown as Room,
];

const folders: Folder[] = [];

const baseProps: React.ComponentProps<typeof RoomList> = {
  rooms: baseRooms,
  selectedRoomId: null,
  onSelectRoom: vi.fn(),
  isLoading: false,
  onLogout: vi.fn(),
  client: createClient(),
  onOpenSettings: vi.fn(),
  onOpenCreateRoom: vi.fn(),
  folders,
  activeFolderId: 'all',
  onSelectFolder: vi.fn(),
  onManageFolders: vi.fn(),
  accounts: [
    { key: 'one', userId: '@alice:server', displayName: 'Alice', avatarUrl: null, unread: 0 },
    { key: 'two', userId: '@bob:server', displayName: 'Bob', avatarUrl: null, unread: 3 },
  ],
  activeAccountKey: 'one',
  onSwitchAccount: vi.fn(),
  onAddAccount: vi.fn(),
};

describe('RoomList', () => {
  beforeEach(() => {
    const store = getAccountStore();
    store.setState({
      aggregatedRooms: [],
      aggregatedQuickFilters: buildQuickFilterSummaries([]),
      aggregatedUnread: 0,
      universalMode: 'active',
      activeQuickFilterId: 'all',
    });
  });

  it('switches active account immediately without timers', () => {
    const onSwitchAccount = vi.fn();
    const { rerender } = render(
      <AccountProvider>
        <RoomList
          {...baseProps}
          onSwitchAccount={onSwitchAccount}
          activeAccountKey="one"
        />
      </AccountProvider>,
    );

    expect(screen.getByTitle('Alice')).toHaveClass('ring-2');

    const bobButton = screen.getByTitle('Bob');
    fireEvent.click(bobButton);
    expect(onSwitchAccount).toHaveBeenCalledWith('two');

    rerender(
      <AccountProvider>
        <RoomList
          {...baseProps}
          onSwitchAccount={onSwitchAccount}
          activeAccountKey="two"
        />
      </AccountProvider>,
    );

    expect(screen.getByTitle('Bob')).toHaveClass('ring-2');
    expect(screen.getByTitle('Alice')).not.toHaveClass('ring-2');
  });
});
