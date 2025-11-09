import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { MatrixClient, MatrixRoom } from '../../src/types';

const mockGetRoomMediaSummary = vi.fn();
const mockPaginateRoomMedia = vi.fn();

vi.mock('../../src/components/RoomList', () => ({
  __esModule: true,
  default: ({ rooms, onSelectRoom }: { rooms: any[]; onSelectRoom: (id: string) => void }) => (
    <div>
      <button type="button" onClick={() => onSelectRoom(rooms[0]?.roomId)}>
        Select room
      </button>
    </div>
  ),
}));

vi.mock('../../src/components/MessageView', () => ({ __esModule: true, default: () => <div data-testid="message-view" /> }));
vi.mock('../../src/components/MessageComposer', () => ({ __esModule: true, default: () => <div data-testid="composer" /> }));
vi.mock('../../src/components/ThreadView', () => ({ __esModule: true, default: () => null }));
vi.mock('../../src/components/SettingsModal', () => ({ __esModule: true, default: () => null }));
vi.mock('../../src/components/CreateRoomModal', () => ({ __esModule: true, default: () => null }));
vi.mock('../../src/components/InviteUserModal', () => ({ __esModule: true, default: () => null }));
vi.mock('../../src/components/ForwardMessageModal', () => ({ __esModule: true, default: () => null }));
vi.mock('../../src/components/ImageViewerModal', () => ({ __esModule: true, default: () => null }));
vi.mock('../../src/components/CreatePollModal', () => ({ __esModule: true, default: () => null }));
vi.mock('../../src/components/ManageFoldersModal', () => ({ __esModule: true, default: () => null }));
vi.mock('../../src/components/ScheduleMessageModal', () => ({ __esModule: true, default: () => null }));
vi.mock('../../src/components/ViewScheduledMessagesModal', () => ({ __esModule: true, default: () => null }));
vi.mock('../../src/components/IncomingCallModal', () => ({ __esModule: true, default: () => null }));
vi.mock('../../src/components/CallView', () => ({ __esModule: true, default: () => null }));
vi.mock('../../src/components/GroupCallView', () => ({ __esModule: true, default: () => null }));
vi.mock('../../src/components/CallParticipantsPanel', () => ({ __esModule: true, default: () => null }));
vi.mock('../../src/components/SearchModal', () => ({ __esModule: true, default: () => null }));

vi.mock('../../src/services/accountManager', () => ({
  __esModule: true,
  useAccountStore: (selector: (state: any) => any) => selector({
    accounts: {},
    activeKey: null,
    removeAccount: vi.fn(),
  }),
}));

vi.mock('@matrix-messenger/core', async () => {
  const actual = await vi.importActual<any>('@matrix-messenger/core');
  const summary = {
    itemsByCategory: {
      media: [
        {
          eventId: 'img1',
          roomId: '!room:example.org',
          timestamp: Date.now(),
          senderId: '@alice:example.org',
          senderName: 'Alice',
          senderAvatarUrl: null,
          body: 'Photo',
          mimetype: 'image/png',
          size: 1024,
          url: 'https://example.org/photo.png',
          thumbnailUrl: 'https://example.org/thumb.png',
          info: {},
          eventType: 'm.image',
          category: 'media',
        },
      ],
      files: [],
      links: [],
      voice: [],
    },
    countsByCategory: { media: 1, files: 0, links: 0, voice: 0 },
    hasMore: true,
    eventIds: ['img1'],
  };

  mockGetRoomMediaSummary.mockReturnValue(summary);
  mockPaginateRoomMedia.mockResolvedValue({
    itemsByCategory: {
      media: [
        {
          eventId: 'img2',
          roomId: '!room:example.org',
          timestamp: Date.now() - 1000,
          senderId: '@bob:example.org',
          senderName: 'Bob',
          senderAvatarUrl: null,
          body: 'Older photo',
          mimetype: 'image/png',
          size: 2048,
          url: 'https://example.org/older.png',
          thumbnailUrl: 'https://example.org/older-thumb.png',
          info: {},
          eventType: 'm.image',
          category: 'media',
        },
      ],
      files: [],
      links: [],
      voice: [],
    },
    countsByCategory: { media: 1, files: 0, links: 0, voice: 0 },
    newEventIds: ['img2'],
    hasMore: false,
  });

  return {
    ...actual,
    useChats: () => ({
      rooms: [
        {
          roomId: '!room:example.org',
          name: 'Example Room',
          topic: '',
          avatarUrl: null,
          lastMessage: null,
          unreadCount: 0,
          pinnedEvents: [],
          isEncrypted: false,
          isDirectMessageRoom: false,
          roomType: null,
          isSpace: false,
          isSavedMessages: false,
        },
      ],
      filteredRooms: [
        {
          roomId: '!room:example.org',
          name: 'Example Room',
          topic: '',
          avatarUrl: null,
          lastMessage: null,
          unreadCount: 0,
          pinnedEvents: [],
          isEncrypted: false,
          isDirectMessageRoom: false,
          roomType: null,
          isSpace: false,
          isSavedMessages: false,
        },
      ],
      isLoading: false,
      searchTerm: '',
      setSearchTerm: vi.fn(),
      roomTypeFilter: 'all',
      setRoomTypeFilter: vi.fn(),
      statusFilter: 'all',
      setStatusFilter: vi.fn(),
      refresh: vi.fn(),
    }),
    getRoomMediaSummary: mockGetRoomMediaSummary,
    paginateRoomMedia: mockPaginateRoomMedia,
    sendReaction: vi.fn(),
    sendTypingIndicator: vi.fn(),
    editMessage: vi.fn(),
    sendMessage: vi.fn(),
    deleteMessage: vi.fn(),
    sendImageMessage: vi.fn(),
    sendReadReceipt: vi.fn(),
    sendFileMessage: vi.fn(),
    setDisplayName: vi.fn(),
    setAvatar: vi.fn(),
    createRoom: vi.fn(),
    inviteUser: vi.fn(),
    forwardMessage: vi.fn(),
    paginateRoomHistory: vi.fn(),
    sendAudioMessage: vi.fn(),
    setPinnedMessages: vi.fn(),
    sendPollStart: vi.fn(),
    sendPollResponse: vi.fn(),
    translateText: vi.fn(async (text: string) => text),
    sendStickerMessage: vi.fn(),
    sendGifMessage: vi.fn(),
    getSecureCloudProfileForClient: vi.fn(),
  };
});

// Import after mocks
import ChatPage from '../../src/components/ChatPage';

const createMockClient = (): MatrixClient => {
  const timeline = {
    getEvents: () => [],
    getTimelineSet: () => ({}) as any,
    getPaginationToken: () => null,
  };

  const room: Partial<MatrixRoom> = {
    roomId: '!room:example.org',
    name: 'Example Room',
    getLiveTimeline: () => timeline as any,
    getPendingEvents: () => [],
    canInvite: () => true,
    currentState: {
      maySendStateEvent: () => true,
    },
    findEventById: () => null,
    getMember: () => ({ name: 'Member', userId: '@member:example.org', getMxcAvatarUrl: () => null }),
  };

  return {
    getUserId: () => '@tester:example.org',
    getUser: () => ({ displayName: 'Tester', avatarUrl: null }),
    getRoom: () => room as MatrixRoom,
    getRooms: () => [room as MatrixRoom],
    getAccountData: () => ({ getContent: () => ({}) }),
    setAccountData: vi.fn(),
    paginateEventTimeline: vi.fn().mockResolvedValue(true),
    sendTyping: vi.fn(),
    sendEvent: vi.fn(),
    stopClient: vi.fn(),
    on: vi.fn(),
    removeListener: vi.fn(),
  } as unknown as MatrixClient;
};

describe('ChatPage shared media integration', () => {
  beforeEach(() => {
    mockGetRoomMediaSummary.mockClear();
    mockPaginateRoomMedia.mockClear();
  });

  it('opens shared media panel from chat page and loads more media', async () => {
    const client = createMockClient();

    render(<ChatPage client={client} savedMessagesRoomId="" />);

    fireEvent.click(screen.getByText('Select room'));

    await waitFor(() => {
      expect(mockGetRoomMediaSummary).toHaveBeenCalled();
    });

    const openButton = await screen.findByTitle('Shared media');
    fireEvent.click(openButton);

    expect(await screen.findByText('Shared media')).toBeInTheDocument();

    const loadMoreButton = await screen.findByRole('button', { name: 'Загрузить ещё' });
    fireEvent.click(loadMoreButton);

    await waitFor(() => {
      expect(mockPaginateRoomMedia).toHaveBeenCalled();
    });
  });
});
