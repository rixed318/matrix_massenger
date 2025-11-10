import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve as resolvePath } from 'path';
import { EventEmitter } from 'events';
import { RoomEvent, EventType } from 'matrix-js-sdk';
import type { MatrixClient, MatrixEvent, MatrixRoom } from '../../src/types';
import {
    startSecureCloudSession,
    normaliseSecureCloudProfile,
    exportSuspiciousEventsLog,
    exportSecureCloudAggregatedStats,
    type SecureCloudAggregatedStats,
    type SecureCloudProfile,
    type SuspiciousEventNotice,
    type SecureCloudDetector,
} from '../../src/services/secureCloudService';
import * as secureCloudServiceModule from '../../src/services/secureCloudService';

class MockMatrixClient extends EventEmitter {
    public override on(eventName: string | symbol, listener: (...args: any[]) => void): this {
        return super.on(eventName, listener);
    }

    public override removeListener(eventName: string | symbol, listener: (...args: any[]) => void): this {
        return super.removeListener(eventName, listener);
    }
}

const createMatrixEvent = (id: string, body: string, sender = '@alice:example.org'): MatrixEvent => {
    const eventLike = {
        getContent: () => ({ body, msgtype: 'm.text' }),
        getType: () => EventType.RoomMessage,
        getId: () => id,
        getSender: () => sender,
        getTs: () => 1700000000000,
    } as Partial<MatrixEvent>;
    return eventLike as MatrixEvent;
};

const createRoom = (roomId: string): MatrixRoom => {
    const roomLike = {
        roomId,
        name: 'Test room',
        isEncrypted: () => false,
    } as Partial<MatrixRoom>;
    return roomLike as MatrixRoom;
};

afterEach(() => {
    vi.restoreAllMocks();
});

describe('startSecureCloudSession detector aggregation', () => {
    let client: MatrixClient;
    let room: MatrixRoom;

    beforeEach(() => {
        client = new MockMatrixClient() as unknown as MatrixClient;
        room = createRoom('!room:example.org');
    });

    const emitTimeline = (event: MatrixEvent) => {
        (client as unknown as EventEmitter).emit(RoomEvent.Timeline, event, room);
    };

    it('combines risk contributions from all enabled detectors', async () => {
        const notices: SuspiciousEventNotice[] = [];
        const errors: string[] = [];

        const detectorA: SecureCloudDetector = {
            id: 'detA',
            displayName: 'Detector A',
            score: vi.fn(async () => ({
                riskScore: 0.3,
                reasons: ['match'],
                keywords: ['token'],
            })),
        };

        const detectorB: SecureCloudDetector = {
            id: 'detB',
            displayName: 'Detector B',
            score: vi.fn(async () => ({
                riskScore: 0.4,
                reasons: ['flag'],
            })),
        };

        const profile: SecureCloudProfile = {
            mode: 'managed',
            apiBaseUrl: '',
            detectors: [
                { detector: detectorA, enabled: true },
                { detector: detectorB, enabled: true },
            ],
            riskThreshold: 0.6,
        };

        const session = startSecureCloudSession(client, normaliseSecureCloudProfile(profile), {
            onSuspiciousEvent: notice => notices.push(notice),
            onError: error => errors.push(error.message),
        });

        emitTimeline(createMatrixEvent('$event1', 'Hello world without heuristics keywords.'));

        await new Promise(resolve => setTimeout(resolve, 0));

        expect(notices).toHaveLength(1);
        expect(errors).toHaveLength(0);
        expect(notices[0].riskScore).toBeCloseTo(0.7, 5);
        expect(notices[0].reasons).toContain('detA:match');
        expect(notices[0].reasons).toContain('detB:flag');
        expect(notices[0].keywords).toContain('token');

        session.stop();
    });

    it('reports detector errors without skipping successful detectors', async () => {
        const notices: SuspiciousEventNotice[] = [];
        const errors: string[] = [];

        const failingDetector: SecureCloudDetector = {
            id: 'failDet',
            displayName: 'Failing detector',
            score: vi.fn(async () => {
                throw new Error('Model missing');
            }),
        };

        const workingDetector: SecureCloudDetector = {
            id: 'goodDet',
            displayName: 'Working detector',
            score: vi.fn(async () => ({
                riskScore: 0.75,
                reasons: ['signal'],
            })),
        };

        const profile: SecureCloudProfile = {
            mode: 'managed',
            apiBaseUrl: '',
            detectors: [
                { detector: failingDetector, enabled: true },
                { detector: workingDetector, enabled: true },
            ],
            riskThreshold: 0.5,
        };

        const session = startSecureCloudSession(client, normaliseSecureCloudProfile(profile), {
            onSuspiciousEvent: notice => notices.push(notice),
            onError: error => errors.push(error.message),
        });

        emitTimeline(createMatrixEvent('$event2', 'Plain text body'));

        await new Promise(resolve => setTimeout(resolve, 0));

        expect(notices).toHaveLength(1);
        expect(notices[0].riskScore).toBeCloseTo(0.75, 5);
        expect(notices[0].reasons).toEqual(['goodDet:signal']);
        expect(errors).toHaveLength(1);
        expect(errors[0]).toContain('Secure Cloud detector failDet failed: Model missing');

        session.stop();
    });

    it('enriches notices with local ML classification when premium mode is enabled', async () => {
        const modelDefinition = readFileSync(
            resolvePath(__dirname, '../../src/assets/secure-cloud/lite-model.json'),
            'utf-8',
        );
        const originalFetch = globalThis.fetch;
        const mockFetch = vi.fn(async (input: RequestInfo | URL) => {
            const urlString = typeof input === 'string' ? input : input instanceof URL ? input.href : '';
            if (urlString.includes('lite-model.json')) {
                return new Response(modelDefinition, {
                    headers: { 'Content-Type': 'application/json' },
                });
            }
            if (typeof originalFetch === 'function') {
                return originalFetch(input as any);
            }
            throw new Error(`Unexpected fetch call for ${urlString}`);
        });
        (globalThis as any).fetch = mockFetch as any;

        const notices: SuspiciousEventNotice[] = [];
        const errors: string[] = [];

        const profile: SecureCloudProfile = {
            mode: 'managed',
            apiBaseUrl: '',
            enablePremium: true,
            riskThreshold: 0.45,
        };

        let session: SecureCloudSession | null = null;
        try {
            session = startSecureCloudSession(client, normaliseSecureCloudProfile(profile), {
                onSuspiciousEvent: notice => notices.push(notice),
                onError: error => errors.push(error.message),
            });

            emitTimeline(createMatrixEvent('$ml-event', 'FREE bonus verify your account now https://secure.example/login\nInstant nudes 18+ only today!'));

            await new Promise(resolve => setTimeout(resolve, 25));

            expect(errors).toHaveLength(0);
            expect(notices).toHaveLength(1);
            const notice = notices[0];
            expect(notice.reasons.some(reason => reason.startsWith('secure-cloud-lite-ml:'))).toBe(true);
            expect(notice.keywords).toEqual(expect.arrayContaining(['bonus', 'verify']));
            expect(notice.summary).toContain('FREE bonus verify');
        } finally {
            session?.stop();
            (globalThis as any).fetch = originalFetch;
        }
    });
});


describe('exportSuspiciousEventsLog filters', () => {
    it('applies room and time range filters', () => {
        const client = {} as MatrixClient;
        const now = Date.now();
        const notices = [
            {
                eventId: 'evt-1',
                roomId: '!alpha:example.org',
                roomName: 'Alpha',
                sender: '@alice:example.org',
                timestamp: now - 1_000,
                riskScore: 0.9,
                reasons: ['det:test'],
                keywords: ['alert'],
                summary: 'Alert 1',
            },
            {
                eventId: 'evt-2',
                roomId: '!beta:example.org',
                roomName: 'Beta',
                sender: '@bob:example.org',
                timestamp: now - 60_000,
                riskScore: 0.5,
                reasons: ['det:test'],
                keywords: [],
                summary: 'Alert 2',
            },
        ] as any;

        vi.spyOn(secureCloudServiceModule, 'getSuspiciousEvents').mockReturnValue(notices);

        const filteredJson = exportSuspiciousEventsLog(client, {
            format: 'json',
            roomId: '!alpha:example.org',
            fromTimestamp: now - 5_000,
            toTimestamp: now - 100,
        });
        const parsed = JSON.parse(filteredJson) as Array<Record<string, unknown>>;
        expect(parsed).toHaveLength(1);
        expect(parsed[0]?.room_id).toBe('!alpha:example.org');

        const filteredCsv = exportSuspiciousEventsLog(client, {
            format: 'csv',
            fromTimestamp: now - 120_000,
            toTimestamp: now,
        });
        const csvLines = filteredCsv.trim().split('\n');
        expect(csvLines[0]).toContain('event_id');
        expect(csvLines).toHaveLength(3);
    });
});

describe('exportSecureCloudAggregatedStats', () => {
    it('serialises aggregated snapshot to csv and json', () => {
        const client = {} as MatrixClient;
        const snapshot: SecureCloudAggregatedStats = {
            totalFlagged: 5,
            openNotices: 2,
            flags: { 'det:reason': 3 },
            actions: { flagged: 5, acknowledged: 1 },
            rooms: [
                {
                    roomId: '!alpha:example.org',
                    roomName: 'Alpha',
                    total: 4,
                    open: 1,
                    lastAlertTimestamp: 1700000000000,
                },
            ],
            retention: {
                count: 3,
                averageMs: 1_200_000,
                minMs: 600_000,
                maxMs: 1_800_000,
                buckets: { under_1h: 1, under_24h: 2 } as Record<string, number>,
                policyDays: 7,
            },
            updatedAt: 1700000000000,
        };

        vi.spyOn(secureCloudServiceModule, 'getSecureCloudAggregatedStats').mockReturnValue(snapshot);

        const csv = exportSecureCloudAggregatedStats(client, { format: 'csv' });
        expect(csv).toContain('rooms');
        expect(csv).toContain('Alpha');
        expect(csv).toContain('open:1');

        const json = exportSecureCloudAggregatedStats(client, { format: 'json' });
        const parsed = JSON.parse(json) as SecureCloudAggregatedStats;
        expect(parsed.rooms[0]?.roomId).toBe('!alpha:example.org');
        expect(parsed.flags['det:reason']).toBe(3);
    });
});
