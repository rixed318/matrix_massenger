import { useCallback, useEffect, useMemo, useState } from 'react';
import { ClientEvent, EventType, RoomEvent } from 'matrix-js-sdk';
import { MatrixClient, MatrixEvent, RoomNotificationMode } from '../types';
import { useAccountStore } from '../services/accountManager';
import {
    ChatRoomStatus,
    ChatRoomType,
    RoomSelection,
    RoomSummary,
    buildRoomSelection,
    collectUnifiedRooms,
    type UnifiedAccountDescriptor,
    type UnifiedRoomSummary,
} from '../utils/chatSelectors';

interface UseChatsOptions {
    client: MatrixClient;
    savedMessagesRoomId: string;
}

export interface UseChatsResult {
    rooms: RoomSummary[];
    filteredRooms: RoomSummary[];
    isLoading: boolean;
    searchTerm: string;
    setSearchTerm: (value: string) => void;
    roomTypeFilter: ChatRoomType;
    setRoomTypeFilter: (value: ChatRoomType) => void;
    statusFilter: ChatRoomStatus;
    setStatusFilter: (value: ChatRoomStatus) => void;
    refresh: () => void;
}

export function useChats({ client, savedMessagesRoomId }: UseChatsOptions): UseChatsResult {
    const [roomSelections, setRoomSelections] = useState<RoomSelection[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [roomTypeFilter, setRoomTypeFilter] = useState<ChatRoomType>('all');
    const [statusFilter, setStatusFilter] = useState<ChatRoomStatus>('joined');
    const roomNotificationModes = useAccountStore<Record<string, RoomNotificationMode>>(state => {
        const activeKey = state.activeKey;
        return activeKey ? (state.accounts[activeKey]?.roomNotificationModes ?? {}) : {};
    });

    const refresh = useCallback(() => {
        const matrixRooms = client.getRooms().slice().sort((a, b) => {
            const aEvents = a.getLiveTimeline().getEvents();
            const bEvents = b.getLiveTimeline().getEvents();
            const lastA = aEvents[aEvents.length - 1];
            const lastB = bEvents[bEvents.length - 1];
            return (lastB?.getTs() || 0) - (lastA?.getTs() || 0);
        });

        const nextSelections: RoomSelection[] = [];
        let savedSelection: RoomSelection | null = null;

        matrixRooms.forEach(room => {
            const built = buildRoomSelection({
                client,
                matrixRoom: room,
                savedMessagesRoomId,
                roomNotificationModes,
            });
            if (!built) {
                return;
            }
            if (room.roomId === savedMessagesRoomId) {
                savedSelection = built;
            } else {
                nextSelections.push(built);
            }
        });

        if (savedSelection) {
            setRoomSelections([savedSelection, ...nextSelections]);
        } else {
            setRoomSelections(nextSelections);
        }
        setIsLoading(false);
    }, [client, roomNotificationModes, savedMessagesRoomId]);

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

    const rooms = useMemo(() => roomSelections.map(selection => selection.room), [roomSelections]);

    const filteredRooms = useMemo(() => {
        const query = searchTerm.trim().toLowerCase();
        return roomSelections.filter(selection => {
            const room = selection.room;
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
        }).map(selection => selection.room);
    }, [roomSelections, roomTypeFilter, statusFilter, searchTerm]);

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

export const mapClientsToUnifiedRooms = (
    descriptors: UnifiedAccountDescriptor[],
): UnifiedRoomSummary[] => collectUnifiedRooms(descriptors);

export type { ChatRoomType, ChatRoomStatus, RoomSummary, UnifiedAccountDescriptor, UnifiedRoomSummary };
