import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import ChatList from '../../src/components/ChatList';
import { Folder, MatrixClient, Room } from '../../src/types';
import { getAccountStore } from '../../src/services/accountManager';
import { buildQuickFilterSummaries } from '../../src/utils/chatSelectors';

vi.mock('../../src/services/matrixService', () => ({
    mxcToHttp: () => null,
}));

vi.mock('../../src/services/mediaIndexService', () => ({
    getSmartCollections: vi.fn().mockResolvedValue([]),
}));

const createClient = (): MatrixClient => ({
    getUserId: () => '@test:server',
    getUser: () => ({ displayName: 'Tester', avatarUrl: null }) as any,
} as MatrixClient);

const baseRooms: Room[] = [
    {
        roomId: 'room-1',
        name: 'General',
        avatarUrl: null,
        lastMessage: null,
        unreadCount: 5,
        pinnedEvents: [],
        isEncrypted: false,
        isDirectMessageRoom: false,
        roomType: 'group',
        status: 'joined',
        lastMessagePreview: 'Welcome to the general room',
        lastMessageAt: Date.now(),
    },
    {
        roomId: 'room-2',
        name: 'Design Standup',
        avatarUrl: null,
        lastMessage: null,
        unreadCount: 0,
        pinnedEvents: [],
        isEncrypted: true,
        isDirectMessageRoom: true,
        roomType: 'direct',
        status: 'invited',
        lastMessagePreview: 'Shall we meet at 10?',
        lastMessageAt: Date.now(),
    },
];

const folders: Folder[] = [
    { id: 'favorites', name: 'Favorites', roomIds: ['room-1'] },
];

const accountStore = getAccountStore();

beforeAll(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-01T12:00:00Z'));
});

afterAll(() => {
    vi.useRealTimers();
});

beforeEach(() => {
    accountStore.setState({
        accounts: {},
        activeKey: null,
        aggregatedRooms: [],
        aggregatedQuickFilters: buildQuickFilterSummaries([]),
        aggregatedUnread: 0,
        universalMode: 'active',
        activeQuickFilterId: 'all',
    });
});

const renderChatList = (override: Partial<React.ComponentProps<typeof ChatList>> = {}) => {
    const props: React.ComponentProps<typeof ChatList> = {
        rooms: baseRooms,
        allRooms: baseRooms,
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
        searchTerm: '',
        onSearchTermChange: vi.fn(),
        roomTypeFilter: 'all',
        onRoomTypeFilterChange: vi.fn(),
        statusFilter: 'joined',
        onStatusFilterChange: vi.fn(),
        ...override,
    };

    return render(<ChatList {...props} />);
};

describe('ChatList', () => {
    it('renders rooms with metadata', () => {
        renderChatList();
        expect(screen.getByText('General')).toBeTruthy();
        expect(screen.getByText('Design Standup')).toBeTruthy();
        expect(screen.getByPlaceholderText('Search chats or messages')).toBeTruthy();
    });

    it('matches the default snapshot', () => {
        const { container } = renderChatList();
        const root = container.firstChild as HTMLElement;
        expect({
            tag: root.tagName,
            className: root.className,
            roomCount: root.querySelectorAll('li').length,
        }).toMatchInlineSnapshot(`
            {
              "className": "chat-list bg-bg-primary border-r border-border-primary flex flex-col w-80",
              "roomCount": 2,
              "tag": "ASIDE",
            }
        `);
    });

    it('invokes callbacks for search and filters', () => {
        const onSearchTermChange = vi.fn();
        const onRoomTypeFilterChange = vi.fn();
        const onStatusFilterChange = vi.fn();

        renderChatList({
            onSearchTermChange,
            onRoomTypeFilterChange,
            onStatusFilterChange,
        });

        fireEvent.change(screen.getByPlaceholderText('Search chats or messages'), { target: { value: 'design' } });
        expect(onSearchTermChange).toHaveBeenCalledWith('design');

        fireEvent.click(screen.getByText('Direct'));
        expect(onRoomTypeFilterChange).toHaveBeenCalledWith('direct');

        fireEvent.click(screen.getByText('Invites'));
        expect(onStatusFilterChange).toHaveBeenCalledWith('invited');
    });

    it('renders aggregated inbox with badges when enabled', () => {
        const aggregatedRoom = {
            roomId: 'agg-1',
            name: 'Ops Bridge',
            avatarUrl: null,
            lastMessage: null,
            unreadCount: 2,
            pinnedEvents: [],
            isEncrypted: false,
            isDirectMessageRoom: false,
            isSavedMessages: false,
            roomType: 'group' as const,
            status: 'joined' as const,
            lastMessagePreview: 'System ping',
            lastMessageAt: Date.now(),
            notificationMode: 'all' as const,
            historyVisibility: null,
            joinRule: null,
            isFederationEnabled: true,
            slowModeSeconds: null,
            topic: undefined,
            isSpace: false,
            spaceChildIds: undefined,
            spaceParentIds: undefined,
            canonicalAlias: null,
            mentionCount: 0,
            scheduledMessageCount: 0,
            secureAlertCount: 0,
            isHidden: false,
            accountKey: 'acc-1',
            accountUserId: '@duty:example.org',
            accountDisplayName: '@duty:example.org',
            accountAvatarUrl: null,
            homeserverName: 'example.org',
            compositeId: 'acc-1|agg-1',
            isServiceRoom: false,
        } satisfies Parameters<typeof buildQuickFilterSummaries>[0][number];

        accountStore.setState({
            aggregatedRooms: [aggregatedRoom],
            aggregatedQuickFilters: buildQuickFilterSummaries([aggregatedRoom]),
            aggregatedUnread: aggregatedRoom.unreadCount ?? 0,
            universalMode: 'all',
        });

        const onSelectRoom = vi.fn();
        renderChatList({ onSelectRoom });

        expect(screen.getByText('Все аккаунты')).toBeTruthy();
        expect(screen.getByText(aggregatedRoom.name)).toBeTruthy();
        expect(screen.getByText(aggregatedRoom.accountUserId)).toBeTruthy();

        fireEvent.click(screen.getByText(aggregatedRoom.name));
        expect(onSelectRoom).toHaveBeenCalledWith('agg-1');
    });
});
