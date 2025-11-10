import { describe, expect, it } from 'vitest';
import type { UnifiedRoomSummary } from '../../src/utils/chatSelectors';
import {
  buildQuickFilterSummaries,
  evaluateQuickFilterMembership,
} from '../../src/utils/chatSelectors';

const createRoom = (overrides: Partial<UnifiedRoomSummary>): UnifiedRoomSummary => ({
  roomId: 'room-1',
  name: 'Alpha',
  topic: null,
  avatarUrl: null,
  lastMessage: null,
  unreadCount: 0,
  pinnedEvents: [],
  isEncrypted: false,
  isDirectMessageRoom: false,
  isSavedMessages: false,
  roomType: 'group',
  status: 'joined',
  lastMessagePreview: null,
  lastMessageAt: null,
  notificationMode: 'all',
  historyVisibility: null,
  joinRule: null,
  isFederationEnabled: true,
  slowModeSeconds: null,
  topic: null,
  isSpace: false,
  spaceChildIds: [],
  spaceParentIds: [],
  canonicalAlias: null,
  mentionCount: 0,
  scheduledMessageCount: 0,
  secureAlertCount: 0,
  isHidden: false,
  accountKey: 'acc',
  accountUserId: '@user:server',
  accountDisplayName: '@user:server',
  accountAvatarUrl: null,
  homeserverName: 'server',
  compositeId: 'acc|room-1',
  isServiceRoom: false,
  ...overrides,
});

describe('chatSelectors quick filters', () => {
  it('buildQuickFilterSummaries aggregates all categories', () => {
    const rooms: UnifiedRoomSummary[] = [
      createRoom({ roomId: 'mention', unreadCount: 5, mentionCount: 2 }),
      createRoom({ roomId: 'scheduled', unreadCount: 1, scheduledMessageCount: 3 }),
      createRoom({ roomId: 'secure', secureAlertCount: 4 }),
      createRoom({ roomId: 'hidden', isHidden: true }),
      createRoom({ roomId: 'pinned', pinnedEvents: ['ev1'] }),
      createRoom({ roomId: 'service', isServiceRoom: true }),
    ];

    const summaries = buildQuickFilterSummaries(rooms);
    const map = Object.fromEntries(summaries.map(summary => [summary.id, summary]));

    expect(map.all.roomCount).toBe(rooms.length);
    expect(map.unread.unreadCount).toBe(6);
    expect(map.mentions.roomCount).toBe(1);
    expect(map.mentions.unreadCount).toBe(5);
    expect(map.scheduled.roomCount).toBe(1);
    expect(map.secure.roomCount).toBe(1);
    expect(map.hidden.roomCount).toBe(1);
    expect(map.pinned.roomCount).toBe(1);
    expect(map.service.roomCount).toBe(1);
  });

  it('evaluateQuickFilterMembership reflects context flags', () => {
    const membership = evaluateQuickFilterMembership(createRoom({
      unreadCount: 2,
      mentionCount: 1,
      scheduledMessageCount: 1,
      secureAlertCount: 1,
      isHidden: true,
      pinnedEvents: ['pin'],
      isServiceRoom: true,
    }));

    expect(membership.all).toBe(true);
    expect(membership.unread).toBe(true);
    expect(membership.mentions).toBe(true);
    expect(membership.scheduled).toBe(true);
    expect(membership.secure).toBe(true);
    expect(membership.hidden).toBe(true);
    expect(membership.pinned).toBe(true);
    expect(membership.service).toBe(true);
  });
});
