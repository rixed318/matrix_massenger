import { useCallback, useEffect, useMemo, useState } from 'react';
import { EventType, RoomEvent } from 'matrix-js-sdk';
import { MatrixClient, MatrixEvent, MatrixRoom, Message } from '../types';
import { parseMatrixEvent } from '../utils/parseMatrixEvent';

export interface UseRoomTimelineOptions {
  client: MatrixClient;
  roomId: string;
  limit?: number;
}

export interface UseRoomTimelineResult {
  events: Message[];
  isLoading: boolean;
  sendMessage: (message: string) => Promise<void>;
  sendAttachment: (data: ArrayBuffer, info: { mimeType?: string; name?: string; size?: number }) => Promise<void>;
  sendVoiceMessage: (data: ArrayBuffer, duration: number, info?: { mimeType?: string; size?: number }) => Promise<void>;
  refresh: () => void;
}

const toTimeline = (client: MatrixClient, room: MatrixRoom, limit?: number): Message[] => {
  const timeline = room.getLiveTimeline().getEvents();
  const slice = typeof limit === 'number' ? timeline.slice(-limit) : timeline;
  return slice
    .map((event: MatrixEvent) => parseMatrixEvent(client, event))
    .filter((event): event is Message => Boolean(event));
};

export const useRoomTimeline = ({ client, roomId, limit }: UseRoomTimelineOptions): UseRoomTimelineResult => {
  const [events, setEvents] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const refresh = useCallback(() => {
    const room = client.getRoom(roomId);
    if (!room) {
      setEvents([]);
      setIsLoading(false);
      return;
    }
    setEvents(toTimeline(client, room, limit));
    setIsLoading(false);
  }, [client, roomId, limit]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    const handleTimeline = (event: MatrixEvent, room: MatrixRoom | undefined) => {
      if (!room || room.roomId !== roomId) {
        return;
      }
      if (event.getType() === EventType.RoomMessage || event.getType() === 'm.sticker') {
        refresh();
      }
    };

    const handleDecryption = (event: MatrixEvent, _success: boolean, room: MatrixRoom | undefined) => {
      if (!room || room.roomId !== roomId) {
        return;
      }
      if (event.isDecryptionFailure() || event.getType() === EventType.RoomMessage) {
        refresh();
      }
    };

    client.on(RoomEvent.Timeline, handleTimeline);
    (client as any).on?.('Event.decrypted', handleDecryption);

    return () => {
      client.removeListener(RoomEvent.Timeline, handleTimeline);
      (client as any).removeListener?.('Event.decrypted', handleDecryption);
    };
  }, [client, refresh, roomId]);

  const sendMessage = useCallback(async (message: string) => {
    const trimmed = message.trim();
    if (!trimmed) return;
    await client.sendTextMessage(roomId, trimmed);
  }, [client, roomId]);

  const uploadContent = useCallback(async (data: ArrayBuffer, info: { mimeType?: string; name?: string; size?: number }) => {
    const uploadInfo = await client.uploadContent(data, {
      type: info.mimeType,
      name: info.name,
      rawResponse: false,
      includeFilename: true,
      onlyContentUri: true,
      progressHandler: undefined,
      abortSignal: undefined,
    } as any);
    return typeof uploadInfo === 'string' ? uploadInfo : (uploadInfo?.content_uri ?? uploadInfo?.contentUri);
  }, [client]);

  const sendAttachment = useCallback(async (data: ArrayBuffer, info: { mimeType?: string; name?: string; size?: number }) => {
    const url = await uploadContent(data, info);
    if (!url) {
      throw new Error('Не удалось загрузить вложение');
    }
    await client.sendMessage(roomId, {
      msgtype: 'm.file',
      body: info.name ?? 'Attachment',
      filename: info.name,
      url,
      info: {
        mimetype: info.mimeType,
        size: info.size,
      },
    } as any);
  }, [client, roomId, uploadContent]);

  const sendVoiceMessage = useCallback(async (data: ArrayBuffer, duration: number, info?: { mimeType?: string; size?: number }) => {
    const mimeType = info?.mimeType ?? 'audio/ogg';
    const url = await uploadContent(data, {
      mimeType,
      name: 'voice-message.ogg',
      size: info?.size,
    });
    if (!url) {
      throw new Error('Не удалось загрузить голосовое сообщение');
    }
    await client.sendMessage(roomId, {
      msgtype: 'm.audio',
      body: 'Voice message',
      url,
      info: {
        mimetype: mimeType,
        size: info?.size,
        duration,
      },
    } as any);
  }, [client, roomId, uploadContent]);

  return useMemo(() => ({
    events,
    isLoading,
    sendMessage,
    sendAttachment,
    sendVoiceMessage,
    refresh,
  }), [events, isLoading, refresh, sendAttachment, sendMessage, sendVoiceMessage]);
};
