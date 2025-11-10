import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getAccountStore } from '../../src/services/accountManager';
import { searchUniversalMessages, type UniversalSearchCursor } from '../../src/services/universalSearchService';
import type { MatrixClient, MatrixEvent } from '../../src/types';

vi.mock('../../src/services/searchService');

import { searchMessages } from '../../src/services/searchService';

const searchMessagesMock = vi.mocked(searchMessages);

const createMockEvent = (id: string, ts: number, body: string): MatrixEvent => ({
    getId: () => id,
    getTs: () => ts,
    getContent: () => ({ body }),
    getType: () => 'm.room.message',
} as unknown as MatrixEvent);

const createAccountRuntime = (key: string, client: MatrixClient, overrides: Partial<ReturnType<typeof getAccountStore>['getState']['accounts'][string]> = {}) => ({
    creds: {
        key,
        user_id: `@${key}:example.org`,
        access_token: 'token',
        device_id: 'device',
        homeserver_url: `https://${key}.example.org`,
    },
    client,
    savedMessagesRoomId: null,
    unread: 0,
    avatarUrl: null,
    displayName: `User ${key}`,
    roomNotificationModes: {},
    ...overrides,
});

describe('universalSearchService', () => {
    const accountStore = getAccountStore();
    const clientA = { id: 'a' } as MatrixClient;
    const clientB = { id: 'b' } as MatrixClient;

    beforeEach(() => {
        vi.clearAllMocks();
        accountStore.setState({
            accounts: {
                'acc-a': createAccountRuntime('acc-a', clientA),
                'acc-b': createAccountRuntime('acc-b', clientB),
            },
        });
    });

    it('merges and sorts results across accounts', async () => {
        searchMessagesMock.mockImplementation(async (client, options) => {
            if (client === clientA) {
                return {
                    count: 2,
                    highlights: ['alpha'],
                    nextBatch: undefined,
                    results: [
                        { event: createMockEvent('a-1', 200, 'First A'), roomId: '!room:a', rank: 200, context: { before: [], after: [] }, highlights: ['alpha'] },
                        { event: createMockEvent('a-2', 100, 'Second A'), roomId: '!room:a', rank: 100, context: { before: [], after: [] }, highlights: [] },
                    ],
                };
            }
            expect(client).toBe(clientB);
            expect(options.nextBatch).toBeUndefined();
            return {
                count: 2,
                highlights: ['beta'],
                nextBatch: undefined,
                results: [
                    { event: createMockEvent('b-1', 300, 'First B'), roomId: '!room:b', rank: 300, context: { before: [], after: [] }, highlights: ['beta'] },
                    { event: createMockEvent('b-2', 50, 'Second B'), roomId: '!room:b', rank: 50, context: { before: [], after: [] }, highlights: [] },
                ],
            };
        });

        const response = await searchUniversalMessages({ searchTerm: 'test' });

        expect(response.results.map(item => item.event.getId())).toEqual(['b-1', 'a-1', 'a-2', 'b-2']);
        expect(response.highlights.sort()).toEqual(['alpha', 'beta']);
        expect(response.results.map(item => item.accountKey)).toEqual(['acc-b', 'acc-a', 'acc-a', 'acc-b']);
        expect(response.cursor).toBeNull();
    });

    it('returns paginated cursor with remaining items and consumes next batches', async () => {
        const responses = new Map<string, number>();

        searchMessagesMock.mockImplementation(async (client, options) => {
            const key = client === clientA ? 'a' : 'b';
            const invocation = responses.get(key) ?? 0;
            responses.set(key, invocation + 1);

            if (key === 'a') {
                if (!options.nextBatch) {
                    return {
                        count: 3,
                        highlights: [],
                        nextBatch: 'token-a',
                        results: [
                            { event: createMockEvent('a-1', 300, 'A1'), roomId: '!room:a', rank: 300, context: { before: [], after: [] }, highlights: [] },
                            { event: createMockEvent('a-2', 250, 'A2'), roomId: '!room:a', rank: 250, context: { before: [], after: [] }, highlights: [] },
                            { event: createMockEvent('a-3', 50, 'A3'), roomId: '!room:a', rank: 50, context: { before: [], after: [] }, highlights: [] },
                        ],
                    };
                }
                return {
                    count: 1,
                    highlights: [],
                    nextBatch: undefined,
                    results: [
                        { event: createMockEvent('a-4', 25, 'A4'), roomId: '!room:a', rank: 25, context: { before: [], after: [] }, highlights: [] },
                    ],
                };
            }

            if (!options.nextBatch) {
                return {
                    count: 2,
                    highlights: [],
                    nextBatch: 'token-b',
                    results: [
                        { event: createMockEvent('b-1', 275, 'B1'), roomId: '!room:b', rank: 275, context: { before: [], after: [] }, highlights: [] },
                        { event: createMockEvent('b-2', 60, 'B2'), roomId: '!room:b', rank: 60, context: { before: [], after: [] }, highlights: [] },
                    ],
                };
            }

            return {
                count: 1,
                highlights: [],
                nextBatch: undefined,
                results: [
                    { event: createMockEvent('b-3', 40, 'B3'), roomId: '!room:b', rank: 40, context: { before: [], after: [] }, highlights: [] },
                ],
            };
        });

        const firstPage = await searchUniversalMessages({ searchTerm: 'hello', limit: 3 });

        expect(firstPage.results.map(item => item.event.getId())).toEqual(['a-1', 'b-1', 'a-2']);
        expect(firstPage.cursor?.accounts['acc-a']?.remaining.map(item => item.event.getId())).toEqual(['a-3']);
        expect(firstPage.cursor?.accounts['acc-b']?.remaining.map(item => item.event.getId())).toEqual(['b-2']);

        const secondPage = await searchUniversalMessages({
            searchTerm: 'hello',
            limit: 3,
            cursor: firstPage.cursor as UniversalSearchCursor,
        });

        expect(secondPage.results.map(item => item.event.getId())).toEqual(['b-2', 'a-3', 'b-3']);
        expect(searchMessagesMock).toHaveBeenCalledTimes(4);
    });

    it('filters accounts when includedAccountKeys provided', async () => {
        searchMessagesMock.mockResolvedValue({
            count: 1,
            highlights: [],
            nextBatch: undefined,
            results: [
                { event: createMockEvent('a-only', 100, 'Only A'), roomId: '!room:a', rank: 100, context: { before: [], after: [] }, highlights: [] },
            ],
        });

        const response = await searchUniversalMessages({ searchTerm: 'filter', includedAccountKeys: ['acc-a'] });

        expect(searchMessagesMock).toHaveBeenCalledTimes(1);
        expect(searchMessagesMock).toHaveBeenCalledWith(clientA, expect.objectContaining({ searchTerm: 'filter' }));
        expect(response.results.map(item => item.accountKey)).toEqual(['acc-a']);
    });
});
