import { EventType, NotificationCountType } from 'matrix-js-sdk';
import {
  MatrixClient,
  MatrixRoom,
  Room as UIRoom,
  RoomNotificationMode,
} from '../types';
import { parseMatrixEvent } from './parseMatrixEvent';
import { isRoomHidden, mxcToHttp } from '../services/matrixService';

export type ChatRoomType = 'all' | 'direct' | 'group' | 'saved';
export type ChatRoomStatus = 'all' | 'joined' | 'invited' | 'left';

const SLOW_MODE_EVENT_TYPE = 'org.matrix.msc3946.room.slow_mode';

export interface RoomSummary extends UIRoom {
  roomType: Exclude<ChatRoomType, 'all'>;
  status: ChatRoomStatus;
  lastMessagePreview: string | null;
  lastMessageAt: number | null;
  mentionCount: number;
  scheduledMessageCount: number;
  secureAlertCount: number;
  isHidden: boolean;
}

export interface RoomSelection {
  room: RoomSummary;
  isServiceRoom: boolean;
  lastEventTs: number;
}

export interface RoomBuildOptions {
  client: MatrixClient;
  matrixRoom: MatrixRoom;
  savedMessagesRoomId: string;
  roomNotificationModes: Record<string, RoomNotificationMode>;
  scheduledCountByRoom?: Record<string, number>;
  secureAlertCountByRoom?: Record<string, number>;
}

export interface UnifiedAccountDescriptor {
  key: string;
  client: MatrixClient;
  savedMessagesRoomId: string | null;
  roomNotificationModes: Record<string, RoomNotificationMode>;
  userId: string;
  displayName?: string | null;
  avatarUrl?: string | null;
  homeserverUrl: string;
  scheduledCountByRoom?: Record<string, number>;
  secureAlertCountByRoom?: Record<string, number>;
}

export interface UnifiedRoomSummary extends RoomSummary {
  accountKey: string;
  accountUserId: string;
  accountDisplayName: string;
  accountAvatarUrl?: string | null;
  homeserverName: string;
  compositeId: string;
  isServiceRoom: boolean;
}

export const membershipToStatus = (membership?: string): ChatRoomStatus => {
  if (membership === 'invite') return 'invited';
  if (membership === 'leave') return 'left';
  return 'joined';
};

export const getRoomType = (
  room: MatrixRoom,
  savedMessagesRoomId: string,
): Exclude<ChatRoomType, 'all'> => {
  if (room.roomId === savedMessagesRoomId) {
    return 'saved';
  }
  return room.getJoinedMemberCount() === 2 ? 'direct' : 'group';
};

const deriveHomeserverName = (userId: string, homeserverUrl: string): string => {
  const [, domain] = userId.split(':');
  if (domain) {
    return domain;
  }
  try {
    const url = new URL(homeserverUrl);
    return url.hostname;
  } catch {
    return homeserverUrl.replace(/^https?:\/\//, '').replace(/\/+$/, '');
  }
};

export const buildRoomSelection = ({
  client,
  matrixRoom,
  savedMessagesRoomId,
  roomNotificationModes,
  scheduledCountByRoom = {},
  secureAlertCountByRoom = {},
}: RoomBuildOptions): RoomSelection | null => {
  const membership = matrixRoom.getMyMembership();
  const status = membershipToStatus(membership);
  const type = getRoomType(matrixRoom, savedMessagesRoomId);

  const timeline = matrixRoom.getLiveTimeline().getEvents();
  const lastEvent = timeline[timeline.length - 1];
  const pinnedEvent = matrixRoom.currentState.getStateEvents(EventType.RoomPinnedEvents, '');
  const lastMessage = lastEvent ? parseMatrixEvent(client, lastEvent) : null;

  const historyVisibilityEvent = matrixRoom.currentState.getStateEvents(EventType.RoomHistoryVisibility, '');
  const joinRuleEvent = matrixRoom.currentState.getStateEvents(EventType.RoomJoinRules, '');
  const createEvent = matrixRoom.currentState.getStateEvents(EventType.RoomCreate, '');
  const slowModeEvent = matrixRoom.currentState.getStateEvents(SLOW_MODE_EVENT_TYPE as EventType, '');

  const historyVisibility = (historyVisibilityEvent?.getContent()?.history_visibility ?? null) as
    | RoomSummary['historyVisibility']
    | null;
  const joinRule = (joinRuleEvent?.getContent()?.join_rule ?? null) as RoomSummary['joinRule'] | null;
  const isFederationEnabled = createEvent?.getContent()?.['m.federate'] !== false;
  const slowModeSeconds = typeof slowModeEvent?.getContent()?.seconds === 'number'
    ? slowModeEvent.getContent().seconds as number
    : null;

  const unreadCount = matrixRoom.getUnreadNotificationCount(NotificationCountType.Total);
  const mentionCount = matrixRoom.getUnreadNotificationCount(NotificationCountType.Highlight);
  const lastMessageAt = lastMessage?.timestamp ?? lastEvent?.getTs() ?? null;

  const isServiceRoom = matrixRoom.getType?.() === 'm.server_notice';
  const isHidden = isRoomHidden(client, matrixRoom.roomId);
  const scheduledMessageCount = scheduledCountByRoom[matrixRoom.roomId] ?? 0;
  const secureAlertCount = secureAlertCountByRoom[matrixRoom.roomId] ?? 0;

  const summary: RoomSummary = {
    roomId: matrixRoom.roomId,
    name: matrixRoom.roomId === savedMessagesRoomId ? 'Saved Messages' : (matrixRoom.name || matrixRoom.roomId),
    avatarUrl: mxcToHttp(client, matrixRoom.getMxcAvatarUrl()),
    lastMessage,
    unreadCount,
    pinnedEvents: pinnedEvent?.getContent().pinned || [],
    isEncrypted: client.isRoomEncrypted(matrixRoom.roomId),
    isDirectMessageRoom: type === 'direct',
    isSavedMessages: type === 'saved',
    roomType: type,
    status,
    lastMessagePreview: lastMessage?.content.body ?? null,
    lastMessageAt,
    notificationMode: roomNotificationModes[matrixRoom.roomId],
    historyVisibility,
    joinRule,
    isFederationEnabled,
    slowModeSeconds,
    topic: matrixRoom.currentState.getStateEvents(EventType.RoomTopic, '')?.getContent()?.topic,
    isSpace: matrixRoom.isSpaceRoom?.() ?? false,
    spaceChildIds: matrixRoom.getChildRooms?.()?.map(child => child.roomId),
    spaceParentIds: matrixRoom.getParentRooms?.()?.map(parent => parent.roomId),
    canonicalAlias: matrixRoom.getCanonicalAlias?.() ?? null,
    mentionCount,
    scheduledMessageCount,
    secureAlertCount,
    isHidden,
  } as RoomSummary;

  return {
    room: summary,
    isServiceRoom,
    lastEventTs: lastMessageAt ?? 0,
  };
};

export const collectRoomsForClient = ({
  client,
  savedMessagesRoomId,
  roomNotificationModes,
  scheduledCountByRoom = {},
  secureAlertCountByRoom = {},
}: Omit<UnifiedAccountDescriptor, 'key' | 'userId' | 'displayName' | 'avatarUrl' | 'homeserverUrl'>): RoomSelection[] => {
  const rooms = client.getRooms().slice().sort((a, b) => {
    const aEvents = a.getLiveTimeline().getEvents();
    const bEvents = b.getLiveTimeline().getEvents();
    const lastA = aEvents[aEvents.length - 1];
    const lastB = bEvents[bEvents.length - 1];
    return (lastB?.getTs() || 0) - (lastA?.getTs() || 0);
  });

  const selections: RoomSelection[] = [];

  rooms.forEach(room => {
    const built = buildRoomSelection({
      client,
      matrixRoom: room,
      savedMessagesRoomId: savedMessagesRoomId ?? '',
      roomNotificationModes,
      scheduledCountByRoom,
      secureAlertCountByRoom,
    });

    if (!built) {
      return;
    }

    selections.push(built);
  });

  return selections;
};

export const collectUnifiedRooms = (
  descriptors: UnifiedAccountDescriptor[],
): UnifiedRoomSummary[] => {
  const aggregated: UnifiedRoomSummary[] = [];

  descriptors.forEach(descriptor => {
    const selections = collectRoomsForClient({
      client: descriptor.client,
      savedMessagesRoomId: descriptor.savedMessagesRoomId ?? '',
      roomNotificationModes: descriptor.roomNotificationModes,
      scheduledCountByRoom: descriptor.scheduledCountByRoom ?? {},
      secureAlertCountByRoom: descriptor.secureAlertCountByRoom ?? {},
    });

    const displayName = descriptor.displayName ?? descriptor.userId;
    const homeserverName = deriveHomeserverName(descriptor.userId, descriptor.homeserverUrl);

    selections.forEach(selection => {
      aggregated.push({
        ...selection.room,
        accountKey: descriptor.key,
        accountUserId: descriptor.userId,
        accountDisplayName: displayName,
        accountAvatarUrl: descriptor.avatarUrl ?? null,
        homeserverName,
        compositeId: `${descriptor.key}|${selection.room.roomId}`,
        isServiceRoom: selection.isServiceRoom,
      });
    });
  });

  aggregated.sort((a, b) => (b.lastMessageAt ?? 0) - (a.lastMessageAt ?? 0));

  return aggregated;
};

export type UniversalQuickFilterId =
  | 'all'
  | 'unread'
  | 'mentions'
  | 'scheduled'
  | 'secure'
  | 'hidden'
  | 'pinned'
  | 'service';

export const UNIVERSAL_QUICK_FILTER_ORDER: UniversalQuickFilterId[] = [
  'all',
  'unread',
  'mentions',
  'scheduled',
  'secure',
  'hidden',
  'pinned',
  'service',
];

export const UNIVERSAL_QUICK_FILTER_METADATA: Record<UniversalQuickFilterId, { label: string; description?: string }> = {
  all: { label: 'Все чаты' },
  unread: { label: 'Все непрочитанные', description: 'Комнаты с непрочитанными сообщениями' },
  mentions: { label: 'Упоминания', description: 'Есть новые @упоминания или подсветки' },
  scheduled: { label: 'Запланированные', description: 'Есть отложенные сообщения' },
  secure: { label: 'Secure Cloud', description: 'Есть предупреждения Secure Cloud' },
  hidden: { label: 'Скрытые', description: 'Чаты, защищённые PIN-кодом' },
  pinned: { label: 'С закрепами', description: 'Есть закреплённые сообщения' },
  service: { label: 'Служебные', description: 'Системные и сервисные уведомления' },
};

export const isUniversalQuickFilterId = (value: unknown): value is UniversalQuickFilterId =>
  typeof value === 'string' && UNIVERSAL_QUICK_FILTER_ORDER.includes(value as UniversalQuickFilterId);

export interface QuickFilterContext {
  unreadCount?: number | null;
  isServiceRoom?: boolean;
  mentionCount?: number | null;
  scheduledMessageCount?: number | null;
  secureAlertCount?: number | null;
  isHidden?: boolean;
  pinnedEvents?: string[];
}

export const evaluateQuickFilterMembership = (
  context: QuickFilterContext,
): Record<UniversalQuickFilterId, boolean> => {
  const unread = (context.unreadCount ?? 0) > 0;
  const mentions = (context.mentionCount ?? 0) > 0;
  const scheduled = (context.scheduledMessageCount ?? 0) > 0;
  const secure = (context.secureAlertCount ?? 0) > 0;
  const hidden = Boolean(context.isHidden);
  const pinned = (context.pinnedEvents?.length ?? 0) > 0;
  const service = Boolean(context.isServiceRoom);

  return {
    all: true,
    unread,
    mentions,
    scheduled,
    secure,
    hidden,
    pinned,
    service,
  } satisfies Record<UniversalQuickFilterId, boolean>;
};

export interface UniversalQuickFilterSummary {
  id: UniversalQuickFilterId;
  label: string;
  description?: string;
  roomCount: number;
  unreadCount: number;
}

export const buildQuickFilterSummaries = (
  rooms: UnifiedRoomSummary[],
): UniversalQuickFilterSummary[] => {
  const accumulator = UNIVERSAL_QUICK_FILTER_ORDER.reduce(
    (acc, id) => {
      acc[id] = { roomCount: 0, unreadCount: 0 };
      return acc;
    },
    {} as Record<UniversalQuickFilterId, { roomCount: number; unreadCount: number }>,
  );

  rooms.forEach(room => {
    const membership = evaluateQuickFilterMembership(room);
    (Object.entries(membership) as Array<[UniversalQuickFilterId, boolean]>).forEach(([id, matches]) => {
      if (!matches) {
        return;
      }
      const summary = accumulator[id];
      summary.roomCount += 1;
      summary.unreadCount += room.unreadCount ?? 0;
    });
  });

  return UNIVERSAL_QUICK_FILTER_ORDER.map(id => ({
    id,
    label: UNIVERSAL_QUICK_FILTER_METADATA[id].label,
    description: UNIVERSAL_QUICK_FILTER_METADATA[id].description,
    roomCount: accumulator[id].roomCount,
    unreadCount: accumulator[id].unreadCount,
  }));
};
