import React from 'react';
import { render, screen } from '@testing-library/react';
import RoomListItem from '../../src/components/RoomListItem';
import type { Room } from '@matrix-messenger/core';

describe('RoomListItem visual badges', () => {
 const roomBase: Room = {
    roomId: 'room-badges',
    name: 'Security Ops',
    topic: 'Incident coordination',
    avatarUrl: null,
    lastMessage: {
      id: 'evt1',
      sender: { id: '@alice:server', name: 'Alice', avatarUrl: null },
      content: { body: 'Latest triage update', msgtype: 'm.text' },
      timestamp: 1_700_000_000_000,
      isOwn: false,
      reactions: null,
      isEdited: false,
      isRedacted: false,
      replyTo: null,
      readBy: {},
      threadReplyCount: 0,
      isSticker: false,
      isGif: false,
      rawEvent: undefined,
      poll: undefined,
      linkPreview: undefined,
      selfDestruct: null,
    },
    unreadCount: 4,
    pinnedEvents: ['pin1'],
    isEncrypted: true,
    isDirectMessageRoom: false,
    isSavedMessages: false,
    roomType: 'group',
    isSpace: false,
    spaceChildIds: [],
    spaceParentIds: [],
    canonicalAlias: '#secops:server',
    notificationMode: 'all',
    historyVisibility: null,
    joinRule: null,
    isFederationEnabled: true,
    slowModeSeconds: null,
    isHidden: false,
    selfDestructSeconds: null,
    mentionCount: 3,
    scheduledMessageCount: 2,
    secureAlertCount: 1,
    isServiceRoom: false,
  } as unknown as Room;

  it('renders mention, schedule and secure badges', () => {
    render(<RoomListItem room={roomBase} isSelected={false} onSelect={() => undefined} />);

    expect(screen.getByText('@3')).toBeInTheDocument();
    expect(screen.getByText('⏰ 2')).toBeInTheDocument();
    expect(screen.getByText('⚠️ 1')).toBeInTheDocument();
  });
});
