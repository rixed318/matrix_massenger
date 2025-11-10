import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import {
    describePresence,
    formatMatrixIdForDisplay,
    canSharePresenceInRoom,
} from '../../src/utils/presence';
import type { PresenceEventContent } from '../../src/state/presenceReducer';

describe('formatMatrixIdForDisplay', () => {
    it('formats matrix identifiers for multi-account display', () => {
        expect(formatMatrixIdForDisplay('@alice:example.org')).toBe('@alice@example.org');
        expect(formatMatrixIdForDisplay('@bot:matrix.example')).toBe('@bot@matrix.example');
        expect(formatMatrixIdForDisplay('@no-domain')).toBe('@no-domain');
    });
});

describe('describePresence', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2024-01-01T00:00:00Z'));
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('prefers currently active status and status message', () => {
        const client: any = {
            getUser: () => ({
                userId: '@bob:example.org',
                presence: 'offline',
                displayName: 'Bob',
                currentlyActive: false,
            }),
        };
        const content: PresenceEventContent = {
            presence: 'online',
            currently_active: true,
            status_msg: 'Working remotely',
        };

        const summary = describePresence('@bob:example.org', content, client);
        expect(summary.status).toBe('online');
        expect(summary.label).toContain('Online');
        expect(summary.label).toContain('Working remotely');
        expect(summary.lastActiveAt).toBeDefined();
    });

    it('falls back to offline summary with last seen timestamp', () => {
        const client: any = {
            getUser: () => null,
        };
        const content: PresenceEventContent = {
            presence: 'offline',
            last_active_ago: 120_000,
        };

        const summary = describePresence('@carol:example.org', content, client);
        expect(summary.status).toBe('offline');
        expect(summary.label).toMatch(/last seen 2 minutes ago/);
        expect(summary.lastActiveAt).toBe(Date.now() - 120_000);
    });
});

describe('canSharePresenceInRoom', () => {
    it('requires sufficient power level for m.presence events', () => {
        const room: any = {
            currentState: {
                getStateEvents: (type: string) => {
                    if (type !== 'm.room.power_levels') return null;
                    return {
                        getContent: () => ({
                            events: { 'm.presence': 50 },
                            users: { '@alice:example.org': 10 },
                            events_default: 0,
                            users_default: 0,
                        }),
                    };
                },
            },
        };

        expect(canSharePresenceInRoom(room, '@alice:example.org')).toBe(false);
    });

    it('allows presence sharing when no restriction is set', () => {
        const room: any = {
            currentState: {
                getStateEvents: () => null,
            },
        };
        expect(canSharePresenceInRoom(room, '@alice:example.org')).toBe(true);
        expect(canSharePresenceInRoom(null, '@alice:example.org')).toBe(true);
    });
});
