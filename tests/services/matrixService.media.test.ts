import { describe, expect, it, beforeEach, vi } from 'vitest';
import { getRoomMediaSummary, paginateRoomMedia } from '../../src/services/matrixService';
import type { MatrixClient, MatrixEvent, MatrixRoom } from '../../src/types';

type MockTimeline = {
  events: MatrixEvent[];
  getEvents: () => MatrixEvent[];
  getPaginationToken: (direction: 'b' | 'f') => string | null;
};

const createEvent = (
  eventId: string,
  type: string,
  content: Record<string, any>,
  sender = '@user:example.org',
  timestamp = Date.now(),
): MatrixEvent => ({
  getId: () => eventId,
  getTxnId: () => eventId,
  getType: () => type,
  getContent: () => content,
  getSender: () => sender,
  getTs: () => timestamp,
} as unknown as MatrixEvent);

describe('matrixService media helpers', () => {
  let timeline: MockTimeline;
  let room: MatrixRoom;
  let client: MatrixClient;
  let canPaginate: boolean;

  beforeEach(() => {
    const events: MatrixEvent[] = [
      createEvent('img1', 'm.room.message', {
        msgtype: 'm.image',
        body: 'Photo',
        url: 'mxc://media/photo',
        info: { thumbnail_url: 'mxc://thumb/photo', mimetype: 'image/png', size: 1024 },
      }, '@alice:example.org', 10_000),
      createEvent('stk1', 'm.sticker', {
        body: 'Sticker',
        url: 'mxc://media/sticker',
        info: { thumbnail_url: 'mxc://thumb/sticker' },
      }, '@bob:example.org', 9_000),
      createEvent('voc1', 'm.room.message', {
        msgtype: 'm.audio',
        body: 'Voice note',
        url: 'mxc://media/voice',
        'org.matrix.msc3245.voice': {},
      }, '@carol:example.org', 8_500),
      createEvent('file1', 'm.room.message', {
        msgtype: 'm.file',
        body: 'Document.pdf',
        url: 'mxc://media/file',
      }, '@dave:example.org', 8_000),
      createEvent('loc1', 'm.room.message', {
        msgtype: 'm.location',
        body: 'Meet here',
        external_url: 'https://maps.example.org',
        info: { thumbnail_url: 'mxc://thumb/location' },
      }, '@erin:example.org', 7_500),
    ];

    timeline = {
      events,
      getEvents: () => timeline.events,
      getPaginationToken: () => (canPaginate ? 'token' : null),
    };

    canPaginate = true;

    room = {
      roomId: '!room:example.org',
      getLiveTimeline: () => timeline as unknown as any,
      canPaginate: vi.fn(() => canPaginate),
      getMember: vi.fn(() => ({
        name: 'Member',
        getMxcAvatarUrl: () => 'mxc://avatar/member',
      })),
    } as unknown as MatrixRoom;

    client = {
      mxcUrlToHttp: vi.fn((mxc: string) => `https://cdn/${mxc}`),
      paginateEventTimeline: vi.fn(async () => {
        timeline.events.push(
          createEvent('file-old', 'm.room.message', {
            msgtype: 'm.file',
            body: 'Archive.zip',
            url: 'mxc://media/archive',
          }, '@alice:example.org', 1_000),
        );
        canPaginate = false;
        return true;
      }),
      getRoom: () => room,
    } as unknown as MatrixClient;
  });

  it('collects shared media summary and caches thumbnails', () => {
    const summary = getRoomMediaSummary(client, room, { limit: 10 });

    expect(summary.countsByCategory.media).toBe(2); // image + sticker
    expect(summary.countsByCategory.voice).toBe(1);
    expect(summary.countsByCategory.files).toBe(1);
    expect(summary.countsByCategory.links).toBe(1);
    expect(summary.hasMore).toBe(true);

    const mediaItems = summary.itemsByCategory.media;
    expect(mediaItems[0].eventId).toBe('img1');
    expect(mediaItems[0].thumbnailUrl).toContain('thumb/photo');

    const stickerCalls = vi.mocked(client.mxcUrlToHttp).mock.calls.filter(call => call[0] === 'mxc://thumb/sticker');
    expect(stickerCalls.length).toBeGreaterThan(0);

    vi.mocked(client.mxcUrlToHttp).mockClear();
    getRoomMediaSummary(client, room, { limit: 10 });
    const repeatedStickerCalls = vi.mocked(client.mxcUrlToHttp).mock.calls.filter(call => call[0] === 'mxc://thumb/sticker');
    expect(repeatedStickerCalls.length).toBe(0);
  });

  it('paginates older media entries', async () => {
    const summary = getRoomMediaSummary(client, room, { limit: 10 });
    const known = new Set(summary.eventIds);

    const page = await paginateRoomMedia(client, room, { knownEventIds: known, limit: 5 });

    expect(client.paginateEventTimeline).toHaveBeenCalledTimes(1);
    expect(page.itemsByCategory.files).toHaveLength(1);
    expect(page.itemsByCategory.files[0].body).toBe('Archive.zip');
    expect(page.countsByCategory.files).toBe(1);
    expect(page.hasMore).toBe(false);

    page.newEventIds.forEach(id => known.add(id));
    const secondPage = await paginateRoomMedia(client, room, { knownEventIds: known, limit: 5 });
    expect(secondPage.itemsByCategory.media).toHaveLength(0);
    expect(secondPage.hasMore).toBe(false);
  });
});
