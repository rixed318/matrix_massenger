import { describe, expect, it, vi, beforeEach } from 'vitest';
import { searchMessages } from '../../src/services/searchService';
import type { MatrixClient } from '../../src/types';
import type { SearchKey } from 'matrix-js-sdk';

const createMockClient = () => {
    const search = vi.fn().mockResolvedValue({
        search_categories: {
            room_events: {
                results: [],
                highlights: [],
                count: 0,
            },
        },
    });
    const client = {
        search,
        getEventMapper: () => (event: any) => event,
    } as unknown as MatrixClient;

    return { client, search };
};

describe('searchMessages', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('builds filter payload with advanced options', async () => {
        const { client, search } = createMockClient();
        const senders = ['@alice:example', '@bob:example'];
        const messageTypes = ['m.room.message'];
        const keys = ['content.body', 'sender'] as SearchKey[];
        const from = new Date('2024-01-01T00:00:00Z');
        const to = '2024-01-31';

        await searchMessages(client, {
            searchTerm: 'hello',
            roomId: '!room:server',
            limit: 10,
            keys,
            senders,
            messageTypes,
            dateRange: { from, to },
            hasMedia: true,
        });

        expect(search).toHaveBeenCalledTimes(1);
        const [{ body }] = search.mock.calls;
        const roomEvents = body.search_categories.room_events;

        expect(roomEvents.search_term).toBe('hello');
        expect(roomEvents.keys).toEqual(keys);
        expect(roomEvents.filter.limit).toBe(10);
        expect(roomEvents.filter.rooms).toEqual(['!room:server']);
        expect(roomEvents.filter.senders).toEqual(senders);
        expect(roomEvents.filter.types).toEqual(messageTypes);
        expect(roomEvents.filter.contains_url).toBe(true);
        expect(roomEvents.filter.range.from).toBe(from.getTime());
        expect(roomEvents.filter.range.to).toBeGreaterThan(0);
    });

    it('falls back to defaults when filters are not provided', async () => {
        const { client, search } = createMockClient();

        await searchMessages(client, {
            searchTerm: 'matrix',
        });

        expect(search).toHaveBeenCalledTimes(1);
        const [{ body }] = search.mock.calls;
        const roomEvents = body.search_categories.room_events;

        expect(roomEvents.keys).toEqual(['content.body']);
        expect(roomEvents.filter.limit).toBe(20);
        expect(roomEvents.filter.rooms).toBeUndefined();
        expect(roomEvents.filter.senders).toBeUndefined();
        expect(roomEvents.filter.types).toBeUndefined();
        expect(roomEvents.filter.contains_url).toBeUndefined();
        expect(roomEvents.filter.range).toBeUndefined();
    });
});
