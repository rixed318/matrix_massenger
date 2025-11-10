import type { MatrixClient, MatrixEvent, MatrixRoom, Message } from '../../../src/types';
import { parseMatrixEvent } from '../../../src/utils/parseMatrixEvent';
import { EventType, RoomEvent } from 'matrix-js-sdk';

export type TimelineEventFilter = (event: MatrixEvent) => boolean;

const defaultTimelineFilter: TimelineEventFilter = event => {
  const type = event.getType();
  return type === EventType.RoomMessage || type === 'm.sticker';
};

export const mapRoomTimeline = (
  client: MatrixClient,
  room: MatrixRoom,
  limit?: number,
  filter: TimelineEventFilter = defaultTimelineFilter,
): Message[] => {
  const timeline = room.getLiveTimeline().getEvents();
  const slice = typeof limit === 'number' ? timeline.slice(-limit) : timeline;
  return slice
    .filter(filter)
    .map((event: MatrixEvent) => parseMatrixEvent(client, event))
    .filter((event): event is Message => Boolean(event));
};

export const subscribeRoomTimeline = (
  client: MatrixClient,
  roomId: string,
  onChange: () => void,
  filter: TimelineEventFilter = defaultTimelineFilter,
): (() => void) => {
  const handleTimeline = (event: MatrixEvent, room: MatrixRoom | undefined) => {
    if (!room || room.roomId !== roomId) return;
    if (filter(event)) {
      onChange();
    }
  };

  const handleDecryption = (event: MatrixEvent, _success: boolean, room: MatrixRoom | undefined) => {
    if (!room || room.roomId !== roomId) return;
    if (event.isDecryptionFailure() || filter(event)) {
      onChange();
    }
  };

  client.on(RoomEvent.Timeline, handleTimeline);
  (client as any).on?.('Event.decrypted', handleDecryption);

  return () => {
    client.removeListener(RoomEvent.Timeline, handleTimeline);
    (client as any).removeListener?.('Event.decrypted', handleDecryption);
  };
};
