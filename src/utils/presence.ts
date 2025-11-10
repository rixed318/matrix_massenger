import { formatDistanceToNow } from 'date-fns';
import type { MatrixClient, MatrixRoom } from '../types';
import type { PresenceEventContent } from '../state/presenceReducer';

export interface PresenceSummary {
    userId?: string;
    displayName?: string;
    formattedUserId?: string;
    status: 'online' | 'offline' | 'unavailable' | 'unknown' | 'restricted' | 'hidden';
    label: string;
    statusMessage?: string;
    lastActiveAt?: number;
}

const PRESENCE_PRIORITY: Record<string, PresenceSummary['status']> = {
    online: 'online',
    unavailable: 'unavailable',
    offline: 'offline',
};

export const formatMatrixIdForDisplay = (userId: string): string => {
    const [localPart, domain] = userId.split(':');
    if (!domain) return userId;
    return `${localPart}@${domain}`;
};

const coercePresenceState = (content?: PresenceEventContent, fallbackPresence?: string): PresenceSummary['status'] => {
    const source = content?.presence ?? fallbackPresence;
    if (!source) return 'unknown';
    return PRESENCE_PRIORITY[source] ?? 'unknown';
};

const resolveLastActive = (content?: PresenceEventContent, fallbackAgo?: number): number | undefined => {
    if (typeof content?.last_active_ts === 'number') {
        return content.last_active_ts;
    }
    if (typeof content?.last_active_ago === 'number') {
        return Date.now() - content.last_active_ago;
    }
    if (typeof fallbackAgo === 'number') {
        return Date.now() - fallbackAgo;
    }
    return undefined;
};

export const describePresence = (
    userId: string,
    content: PresenceEventContent | undefined,
    client: MatrixClient,
): PresenceSummary => {
    const user = client.getUser(userId);
    const presenceState = coercePresenceState(content, user?.presence);
    const lastActiveAt = resolveLastActive(content, user?.lastActiveAgo ?? undefined);
    const statusMessage = typeof content?.status_msg === 'string' && content.status_msg.trim().length > 0
        ? content.status_msg.trim()
        : undefined;

    if (presenceState === 'online' || content?.currently_active || user?.currentlyActive) {
        return {
            userId,
            status: 'online',
            label: statusMessage ? `Online — ${statusMessage}` : 'Online',
            statusMessage,
            lastActiveAt: Date.now(),
        };
    }

    if (presenceState === 'unavailable') {
        const label = lastActiveAt
            ? `Away • last seen ${formatDistanceToNow(lastActiveAt, { addSuffix: true })}`
            : 'Away';
        return {
            userId,
            status: 'unavailable',
            label: statusMessage ? `${label} — ${statusMessage}` : label,
            statusMessage,
            lastActiveAt,
        };
    }

    if (presenceState === 'offline') {
        const label = lastActiveAt
            ? `Offline • last seen ${formatDistanceToNow(lastActiveAt, { addSuffix: true })}`
            : 'Offline';
        return {
            userId,
            status: 'offline',
            label: statusMessage ? `${label} — ${statusMessage}` : label,
            statusMessage,
            lastActiveAt,
        };
    }

    return {
        userId,
        status: 'unknown',
        label: statusMessage ? `Status unknown — ${statusMessage}` : 'Status unknown',
        statusMessage,
        lastActiveAt,
    };
};

interface PowerLevelsContent {
    events?: Record<string, number>;
    events_default?: number;
    users?: Record<string, number>;
    users_default?: number;
}

const resolveRequiredLevel = (content: PowerLevelsContent | undefined, eventType: string): number => {
    if (!content) return 0;
    if (content.events && typeof content.events[eventType] === 'number') {
        return content.events[eventType];
    }
    if (typeof content.events_default === 'number') {
        return content.events_default;
    }
    return 0;
};

const resolveUserLevel = (content: PowerLevelsContent | undefined, userId: string): number => {
    if (!content) return 0;
    if (content.users && typeof content.users[userId] === 'number') {
        return content.users[userId];
    }
    if (typeof content.users_default === 'number') {
        return content.users_default;
    }
    if (typeof content.events_default === 'number') {
        return content.events_default;
    }
    return 0;
};

export const canSharePresenceInRoom = (room: MatrixRoom | null | undefined, userId: string | null | undefined): boolean => {
    if (!room || !userId) return true;
    try {
        const powerLevelsEvent = room.currentState?.getStateEvents?.('m.room.power_levels', '');
        const content = powerLevelsEvent?.getContent?.() as PowerLevelsContent | undefined;
        const required = resolveRequiredLevel(content, 'm.presence');
        const level = resolveUserLevel(content, userId);
        return level >= required;
    } catch (err) {
        console.warn('Failed to evaluate presence power-levels', err);
        return true;
    }
};

export const buildRestrictedPresenceSummary = (): PresenceSummary => ({
    status: 'restricted',
    label: 'Presence restricted by room permissions',
});

export const buildHiddenPresenceSummary = (): PresenceSummary => ({
    status: 'hidden',
    label: 'Presence hidden',
});

export const presenceStatusToClass = (status: PresenceSummary['status']): string => {
    switch (status) {
        case 'online':
            return 'bg-emerald-500';
        case 'unavailable':
            return 'bg-amber-400';
        case 'offline':
            return 'bg-gray-500';
        case 'restricted':
            return 'bg-purple-400';
        case 'hidden':
            return 'bg-slate-500';
        default:
            return 'bg-gray-600';
    }
};
