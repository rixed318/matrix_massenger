import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import ChatList from '../../src/components/ChatList';
import { Folder, MatrixClient, Room } from '../../src/types';
import { getSmartCollections } from '../../src/services/mediaIndexService';

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

    it('shows smart collections when available', async () => {
        vi.mocked(getSmartCollections).mockResolvedValueOnce([
            {
                id: 'important',
                label: 'Важно',
                description: 'critical messages',
                count: 3,
                token: 'smart:important',
            },
        ]);

        renderChatList();

        expect(await screen.findByText('Интеллектуальные подборки')).toBeTruthy();
        expect(await screen.findByText('Важно')).toBeTruthy();
    });
});
