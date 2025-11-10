import { describe, expect, it } from 'vitest';
import { presenceReducer, buildPresenceMap, type PresenceEventContent, type PresenceMap } from '../../src/state/presenceReducer';

const samplePresence = (overrides: Partial<PresenceEventContent> = {}): PresenceEventContent => ({
    presence: 'online',
    status_msg: 'Available',
    currently_active: true,
    last_active_ago: 0,
    ...overrides,
});

describe('presenceReducer', () => {
    it('creates a map from updates', () => {
        const map = buildPresenceMap([
            { userId: '@alice:example.org', content: samplePresence() },
            { userId: '@bob:example.org', content: samplePresence({ presence: 'offline' }) },
        ]);
        expect(map.size).toBe(2);
        expect(map.get('@alice:example.org')?.presence).toBe('online');
        expect(map.get('@bob:example.org')?.presence).toBe('offline');
        expect(map.get('@bob:example.org')).not.toBe(samplePresence); // defensive copy
    });

    it('replaces a single entry while preserving immutability', () => {
        const initial: PresenceMap = buildPresenceMap([
            { userId: '@alice:example.org', content: samplePresence({ status_msg: 'Initial' }) },
        ]);
        const updated = presenceReducer(initial, {
            type: 'replace',
            userId: '@alice:example.org',
            content: samplePresence({ status_msg: 'Updated', presence: 'unavailable' }),
        });
        expect(initial).not.toBe(updated);
        expect(updated.get('@alice:example.org')?.presence).toBe('unavailable');
        expect(updated.get('@alice:example.org')?.status_msg).toBe('Updated');
    });

    it('merges bulk updates and removes entries', () => {
        const initial: PresenceMap = buildPresenceMap([
            { userId: '@alice:example.org', content: samplePresence({ presence: 'online' }) },
            { userId: '@bob:example.org', content: samplePresence({ presence: 'unavailable' }) },
        ]);
        const merged = presenceReducer(initial, {
            type: 'bulk',
            updates: [
                { userId: '@alice:example.org', content: samplePresence({ presence: 'offline' }) },
                { userId: '@carol:example.org', content: samplePresence({ presence: 'online', status_msg: 'Here' }) },
            ],
        });
        expect(merged.get('@alice:example.org')?.presence).toBe('offline');
        expect(merged.get('@carol:example.org')?.status_msg).toBe('Here');

        const reduced = presenceReducer(merged, { type: 'remove', userId: '@bob:example.org' });
        expect(reduced.has('@bob:example.org')).toBe(false);
    });

    it('clears the map only when needed', () => {
        const initial: PresenceMap = buildPresenceMap([
            { userId: '@alice:example.org', content: samplePresence() },
        ]);
        const cleared = presenceReducer(initial, { type: 'clear' });
        expect(cleared.size).toBe(0);
        const empty = new Map<string, PresenceEventContent>();
        const same = presenceReducer(empty, { type: 'clear' });
        expect(same).toBe(empty);
    });
});
