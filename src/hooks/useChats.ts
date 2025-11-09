import { useCallback, useEffect, useMemo, useState } from 'react';
import { ClientEvent, EventType, NotificationCountType, RoomEvent } from 'matrix-js-sdk';
import { MatrixClient, MatrixEvent, MatrixRoom, Room as UIRoom } from '../types';
import { mxcToHttp } from '../services/matrixService';
import { parseMatrixEvent } from '../utils/parseMatrixEvent';

export type ChatRoomType = 'all' | 'direct' | 'group' | 'saved';
export type ChatRoomStatus = 'all' | 'joined' | 'invited' | 'left';

interface UseChatsOptions {
    client: MatrixClient;
    savedMessagesRoomId: string;
}

export interface UseChatsResult {
    rooms: UIRoom[];
    filteredRooms: UIRoom[];
    isLoading: boolean;
    searchTerm: string;
    setSearchTerm: (value: string) => void;
    roomTypeFilter: ChatRoomType;
    setRoomTypeFilter: (value: ChatRoomType) => void;
    statusFilter: ChatRoomStatus;
    setStatusFilter: (value: ChatRoomStatus) => void;
    refresh: () => void;
}

const membershipToStatus = (membership?: string): ChatRoomStatus => {
    if (membership === 'invite') return 'invited';
    if (membership === 'leave') return 'left';
    return 'joined';
};

const getRoomType = (room: MatrixRoom, savedMessagesRoomId: string): Exclude<ChatRoomType, 'all'> => {
    if (room.roomId === savedMessagesRoomId) {
        return 'saved';
    }
    return room.getJoinedMemberCount() === 2 ? 'direct' : 'group';
};

export function useChats({ client, savedMessagesRoomId }: UseChatsOptions): UseChatsResult {
    const [rooms, setRooms] = useState<UIRoom[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [roomTypeFilter, setRoomTypeFilter] = useState<ChatRoomType>('all');
    const [statusFilter, setStatusFilter] = useState<ChatRoomStatus>('joined');

    const buildRoom = useCallback((room: MatrixRoom): UIRoom | null => {
        if (!room) return null;
        const membership = room.getMyMembership();
        const status = membershipToStatus(membership);

        const type = getRoomType(room, savedMessagesRoomId);

        const timeline = room.getLiveTimeline().getEvents();
        const lastEvent = timeline[timeline.length - 1];
        const pinnedEvent = room.currentState.getStateEvents(EventType.RoomPinnedEvents, '');
        const lastMessage = lastEvent ? parseMatrixEvent(client, lastEvent) : null;

        return {
            roomId: room.roomId,
            name: room.name || room.roomId,
            avatarUrl: mxcToHttp(client, room.getMxcAvatarUrl()),
            lastMessage,
            unreadCount: room.getUnreadNotificationCount(NotificationCountType.Total),
            pinnedEvents: pinnedEvent?.getContent().pinned || [],
            isEncrypted: client.isRoomEncrypted(room.roomId),
            isDirectMessageRoom: type === 'direct',
            isSavedMessages: type === 'saved',
            roomType: type,
            status,
            lastMessagePreview: lastMessage?.content.body ?? null,
            lastMessageAt: lastMessage?.timestamp ?? lastEvent?.getTs() ?? null,
        } as UIRoom & { roomType: Exclude<ChatRoomType, 'all'>; status: ChatRoomStatus; lastMessagePreview: string | null; lastMessageAt: number | null; };
    }, [client, savedMessagesRoomId]);

    const refresh = useCallback(() => {
        const matrixRooms = client.getRooms();
        const sortedRooms = matrixRooms
            .slice()
            .sort((a, b) => {
                const aEvents = a.getLiveTimeline().getEvents();
                const bEvents = b.getLiveTimeline().getEvents();
                const lastA = aEvents[aEvents.length - 1];
                const lastB = bEvents[bEvents.length - 1];
                return (lastB?.getTs() || 0) - (lastA?.getTs() || 0);
            });

        const nextRooms: UIRoom[] = [];
        let savedRoom: UIRoom | null = null;

        sortedRooms.forEach(room => {
            const built = buildRoom(room);
            if (!built) {
                return;
            }
            if (room.roomId === savedMessagesRoomId) {
                savedRoom = { ...built, name: 'Saved Messages', isSavedMessages: true };
            } else {
                nextRooms.push(built);
            }
        });

        if (savedRoom) {
            setRooms([savedRoom, ...nextRooms]);
        } else {
            setRooms(nextRooms);
        }
        setIsLoading(false);
    }, [buildRoom, client, savedMessagesRoomId]);

    useEffect(() => {
        refresh();
    }, [refresh]);

    useEffect(() => {
        const handleSync = (state: string) => {
            if (state === 'PREPARED' || state === 'SYNCING') {
                refresh();
            }
        };

        const handleTimeline = (event: MatrixEvent) => {
            if (event.getType() === EventType.RoomMessage || event.getType() === 'm.sticker') {
                refresh();
            }
        };

        const handleRoom = () => refresh();

        client.on(ClientEvent.Sync, handleSync as any);
        client.on(RoomEvent.Timeline, handleTimeline);
        client.on(ClientEvent.Room, handleRoom);

        return () => {
            client.removeListener(ClientEvent.Sync, handleSync as any);
            client.removeListener(RoomEvent.Timeline, handleTimeline);
            client.removeListener(ClientEvent.Room, handleRoom);
        };
    }, [client, refresh]);

    const filteredRooms = useMemo(() => {
        const query = searchTerm.trim().toLowerCase();
        return rooms.filter(room => {
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
    }, [rooms, roomTypeFilter, statusFilter, searchTerm]);

    return {
        rooms,
        filteredRooms,
        isLoading,
        searchTerm,
        setSearchTerm,
        roomTypeFilter,
        setRoomTypeFilter,
        statusFilter,
        setStatusFilter,
        refresh,
    };
}
