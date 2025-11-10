import React from 'react';
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { EventEmitter } from 'events';
import ChatPage from '../../src/components/ChatPage';
import { ClientEvent } from 'matrix-js-sdk';

vi.mock('../../src/services/accountManager', () => ({
    __esModule: true,
    useAccountStore: (selector: (state: any) => any) => selector({
        accounts: {},
        activeKey: null,
        removeAccount: vi.fn(),
        setRoomNotificationMode: vi.fn(),
    }),
    useAccountListSnapshot: () => ({
        accounts: [],
        activeKey: null,
        setActiveKey: vi.fn(),
        openAddAccount: vi.fn(),
    }),
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

vi.mock('@matrix-messenger/core', () => ({
    __esModule: true,
    mxcToHttp: () => null,
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
    getRoomNotificationMode: vi.fn(() => 'all'),
    setRoomNotificationMode: vi.fn(),
    getScheduledMessages: vi.fn(() => []),
    addScheduledMessage: vi.fn(),
    deleteScheduledMessage: vi.fn(),
    updateScheduledMessage: vi.fn(),
    bulkUpdateScheduledMessages: vi.fn(),
    markScheduledMessageSent: vi.fn(),
    recordScheduledMessageError: vi.fn(),
    parseScheduledMessagesFromEvent: vi.fn(),
    getRoomTTL: vi.fn(() => null),
    setRoomTTL: vi.fn(),
    isRoomHidden: () => false,
    startGroupCall: vi.fn(),
    joinGroupCall: vi.fn(),
    getDisplayMedia: vi.fn(),
    enumerateDevices: vi.fn(),
    getRoomMediaSummary: vi.fn(),
    paginateRoomMedia: vi.fn(),
    sendNotification: vi.fn(),
    setupNotificationListeners: vi.fn(),
    subscribeToWebPush: vi.fn(),
    isWebPushSupported: () => false,
    registerMatrixWebPush: vi.fn(),
    setRoomNotificationPreference: vi.fn(),
    setRoomNotificationPreferences: vi.fn(),
    acknowledgeSuspiciousEvents: vi.fn(),
    startSecureCloudSession: vi.fn(),
    normaliseSecureCloudProfile: vi.fn(),
}));

class MockMatrixRoom {
    roomId = '!room:example.org';
    name = 'Bob Example';
    timeline: any[] = [];
    currentState = {
        getStateEvents: (type: string) => {
            if (type === 'm.room.power_levels') {
                return {
                    getContent: () => ({ events_default: 0, users_default: 0, events: {} }),
                };
            }
            return null;
        },
        maySendStateEvent: () => true,
    };

    getJoinedMemberCount() {
        return 2;
    }

    getLiveTimeline() {
        return {
            getEvents: () => [],
            getTimelineSet: () => ({}),
        };
    }

    getTimelineForEvent() {
        return null;
    }

    getPendingEvents() {
        return [];
    }

    findEventById() {
        return null;
    }

    getMxcAvatarUrl() {
        return null;
    }

    canInvite() {
        return true;
    }

    getType() {
        return null;
    }

    getJoinedMembers() {
        return [
            { userId: '@alice:example.org', name: 'Alice', user: { userId: '@alice:example.org', displayName: 'Alice' } },
            { userId: '@bob:example.org', name: 'Bob Example', user: { userId: '@bob:example.org', displayName: 'Bob Example' } },
        ];
    }

    getMembersWithTyping() {
        return [];
    }

    getAccountData() {
        return { getContent: () => ({}) };
    }

    getUnreadNotificationCount() {
        return 0;
    }
}

class MockMatrixClient extends EventEmitter {
    private room: MockMatrixRoom;
    private users: Map<string, any>;
    public setPresence = vi.fn().mockResolvedValue(undefined);

    constructor(room: MockMatrixRoom) {
        super();
        this.room = room;
        this.users = new Map([
            ['@alice:example.org', { userId: '@alice:example.org', presence: 'online', displayName: 'Alice', currentlyActive: true }],
            ['@bob:example.org', { userId: '@bob:example.org', presence: 'offline', displayName: 'Bob Example', currentlyActive: false, lastActiveAgo: 120000 }],
        ]);
    }

    getUserId() {
        return '@alice:example.org';
    }

    getUser(userId: string) {
        return this.users.get(userId) ?? null;
    }

    getRooms() {
        return [this.room];
    }

    getRoom(roomId: string) {
        return roomId === this.room.roomId ? this.room : null;
    }

    isRoomEncrypted() {
        return false;
    }

    getDeviceId() {
        return 'device';
    }
}

const createClient = () => new MockMatrixClient(new MockMatrixRoom());

describe('presence UI integration', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2024-01-01T00:00:00Z'));
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('updates presence indicators when sync events arrive', async () => {
        const client = createClient();
        render(<ChatPage client={client as any} savedMessagesRoomId="" />);

        const roomItem = await screen.findByText('Bob Example');
        expect(roomItem).toBeInTheDocument();

        fireEvent.click(roomItem);

        await waitFor(() => {
            expect(screen.getByText('Bob Example')).toBeInTheDocument();
        });

        await waitFor(() => expect(client.listeners(ClientEvent.Sync).length).toBeGreaterThan(0));

        act(() => {
            client.emit(ClientEvent.Sync, 'SYNCING', null, {
                presence: {
                    events: [
                        {
                            sender: '@bob:example.org',
                            content: { presence: 'online', currently_active: true, status_msg: 'Working remotely' },
                        },
                    ],
                },
            });
        });

        await waitFor(() => {
            expect(screen.getAllByText(/Online — Working remotely/).length).toBeGreaterThan(0);
        });

        await waitFor(() => {
            expect(screen.getByText(/@bob@example.org • Online — Working remotely/)).toBeInTheDocument();
        });

        act(() => {
            client.emit(ClientEvent.Sync, 'SYNCING', null, {
                presence: {
                    events: [
                        {
                            sender: '@bob:example.org',
                            content: { presence: 'offline', last_active_ago: 60_000 },
                        },
                    ],
                },
            });
        });

        await waitFor(() => {
            expect(screen.getAllByText(/Offline • last seen 1 minute ago/).length).toBeGreaterThan(0);
        });
    });
});
