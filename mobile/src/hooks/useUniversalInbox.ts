import { useMemo } from 'react';
import type { RoomSummary } from '@matrix-messenger/core';

type InboxCategory = 'unread' | 'mentions' | 'secure';

export interface InboxEntry {
  key: InboxCategory;
  count: number;
}

export const useUniversalInbox = (rooms: RoomSummary[]) => {
  return useMemo<InboxEntry[]>(() => {
    const unread = rooms.filter(room => (room.unreadCount ?? 0) > 0).length;
    const mentions = rooms.filter(room => (room.mentionCount ?? 0) > 0).length;
    const secure = rooms.filter(room => (room.secureAlertCount ?? 0) > 0).length;
    return [
      { key: 'unread', count: unread },
      { key: 'mentions', count: mentions },
      { key: 'secure', count: secure },
    ];
  }, [rooms]);
};
