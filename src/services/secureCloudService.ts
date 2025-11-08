import { RoomEvent, EventType } from 'matrix-js-sdk';
import type { MatrixClient, MatrixEvent, MatrixRoom } from '../types';

export type SecureCloudMode = 'disabled' | 'managed' | 'self-hosted';

export interface SecureCloudProfile {
    mode: SecureCloudMode;
    apiBaseUrl: string;
    metadataToken?: string;
    analyticsToken?: string;
    enablePremium?: boolean;
    enableAnalytics?: boolean;
    riskThreshold?: number;
    allowedEventTypes?: string[];
}

export interface SuspiciousEventNotice {
    eventId: string;
    roomId: string;
    roomName?: string;
    sender: string;
    timestamp: number;
    riskScore: number;
    reasons: string[];
    summary: string;
    keywords: string[];
}

export interface SecureCloudCallbacks {
    onSuspiciousEvent?: (notice: SuspiciousEventNotice) => void;
    onError?: (error: Error) => void;
}

export interface SecureCloudSession {
    stop: () => void;
    updateProfile: (profile: SecureCloudProfile) => void;
}

const KEYWORD_PATTERNS = [
    'btc',
    'bitcoin',
    'crypt',
    'wallet',
    'transfer',
    'wire',
    'password',
    'verification',
    'urgent',
    'click here',
    'limited time',
    'airdrop',
    'giveaway',
];

const suspiciousEvents = new WeakMap<MatrixClient, Map<string, SuspiciousEventNotice[]>>();

const ensureStore = (client: MatrixClient): Map<string, SuspiciousEventNotice[]> => {
    let store = suspiciousEvents.get(client);
    if (!store) {
        store = new Map();
        suspiciousEvents.set(client, store);
    }
    return store;
};

const normaliseBaseUrl = (baseUrl: string): string => {
    return baseUrl.replace(/\/+$/, '');
};

const evaluateEventRisk = (event: MatrixEvent, room: MatrixRoom, profile: SecureCloudProfile): SuspiciousEventNotice | null => {
    const content = (event.getContent?.() as Record<string, unknown>) || {};
    const body = typeof content['body'] === 'string' ? content['body'] : '';
    const msgtype = typeof content['msgtype'] === 'string' ? content['msgtype'] : event.getType();

    const lowerBody = body.toLowerCase();
    const keywords = KEYWORD_PATTERNS.filter(pattern => lowerBody.includes(pattern));
    const reasons: string[] = [];
    let riskScore = 0;

    if (keywords.length > 0) {
        riskScore += 0.45 + Math.min(0.2, keywords.length * 0.05);
        reasons.push('keyword_match');
    }

    if (msgtype && msgtype !== 'm.text') {
        riskScore += 0.1;
        reasons.push('non_text_message');
    }

    const urlRegex = /(https?:\/\/[^\s]+)/gi;
    if (urlRegex.test(lowerBody)) {
        riskScore += 0.2;
        reasons.push('contains_url');
    }

    if (body.length > 500) {
        riskScore += 0.05;
        reasons.push('long_body');
    }

    const threshold = typeof profile.riskThreshold === 'number' ? profile.riskThreshold : 0.6;
    const cappedScore = Math.min(1, riskScore);

    if (cappedScore < threshold) {
        return null;
    }

    const summary = body.length > 160 ? `${body.substring(0, 157)}...` : body;

    return {
        eventId: event.getId?.() ?? 'unknown',
        roomId: room.roomId,
        roomName: room.name ?? room.roomId,
        sender: event.getSender?.() ?? 'unknown',
        timestamp: event.getTs?.() ?? Date.now(),
        riskScore: Number(cappedScore.toFixed(2)),
        reasons,
        summary,
        keywords,
    };
};

const sendMetadata = async (profile: SecureCloudProfile, notice: SuspiciousEventNotice): Promise<void> => {
    if (!profile.apiBaseUrl) {
        return;
    }

    const baseUrl = normaliseBaseUrl(profile.apiBaseUrl);
    const payload = {
        event_id: notice.eventId,
        room_id: notice.roomId,
        sender: notice.sender,
        timestamp: notice.timestamp,
        risk_score: notice.riskScore,
        reasons: notice.reasons,
        keywords: notice.keywords,
        room_name: notice.roomName,
        summary: notice.summary,
        mode: profile.mode,
        features: {
            premium: Boolean(profile.enablePremium),
            analytics: Boolean(profile.enableAnalytics),
        },
    };

    const headers: Record<string, string> = {
        'Content-Type': 'application/json',
    };
    if (profile.metadataToken) {
        headers['Authorization'] = `Bearer ${profile.metadataToken}`;
    }
    if (profile.enableAnalytics && profile.analyticsToken) {
        headers['X-Analytics-Token'] = profile.analyticsToken;
    }

    await fetch(`${baseUrl}/events`, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        keepalive: true,
    });
};

const shouldObserveEvent = (event: MatrixEvent, profile: SecureCloudProfile): boolean => {
    if (Array.isArray(profile.allowedEventTypes) && profile.allowedEventTypes.length > 0) {
        return profile.allowedEventTypes.includes(event.getType());
    }
    return event.getType() === EventType.RoomMessage;
};

const isRoomEncrypted = (room?: MatrixRoom | null, event?: MatrixEvent): boolean => {
    try {
        if (room && typeof (room as any).isEncrypted === 'function') {
            return Boolean((room as any).isEncrypted());
        }
    } catch {/* noop */}

    try {
        if (event && typeof (event as any).isEncrypted === 'function') {
            return Boolean((event as any).isEncrypted());
        }
    } catch {/* noop */}

    return false;
};

export const startSecureCloudSession = (
    client: MatrixClient,
    initialProfile: SecureCloudProfile,
    callbacks: SecureCloudCallbacks = {},
): SecureCloudSession => {
    let profile = initialProfile;
    const processedEvents = new Set<string>();

    const store = ensureStore(client);

    const handler = async (event: MatrixEvent, room: MatrixRoom | undefined) => {
        if (!profile || profile.mode === 'disabled') {
            return;
        }
        if (!room || isRoomEncrypted(room, event)) {
            return;
        }
        if (!shouldObserveEvent(event, profile)) {
            return;
        }

        const eventId = event.getId?.();
        if (eventId && processedEvents.has(eventId)) {
            return;
        }

        const notice = evaluateEventRisk(event, room, profile);
        if (!notice) {
            if (eventId) {
                processedEvents.add(eventId);
            }
            return;
        }

        const existing = store.get(notice.roomId) ?? [];
        if (!existing.some(item => item.eventId === notice.eventId)) {
            store.set(notice.roomId, [...existing, notice]);
            callbacks.onSuspiciousEvent?.(notice);
        }

        try {
            await sendMetadata(profile, notice);
        } catch (error) {
            if (error instanceof Error) {
                callbacks.onError?.(error);
            } else {
                callbacks.onError?.(new Error('Failed to send metadata to Secure Cloud.'));
            }
        } finally {
            if (eventId) {
                processedEvents.add(eventId);
            }
        }
    };

    client.on(RoomEvent.Timeline, handler);

    return {
        stop: () => {
            client.removeListener(RoomEvent.Timeline, handler);
        },
        updateProfile: (nextProfile: SecureCloudProfile) => {
            profile = nextProfile;
        },
    };
};

export const getSuspiciousEvents = (
    client: MatrixClient,
    roomId?: string,
): SuspiciousEventNotice[] => {
    const store = suspiciousEvents.get(client);
    if (!store) {
        return [];
    }
    if (roomId) {
        return store.get(roomId)?.slice() ?? [];
    }
    return Array.from(store.values()).flat();
};

export const acknowledgeSuspiciousEvents = (
    client: MatrixClient,
    roomId: string,
    eventIds?: string[],
): void => {
    const store = suspiciousEvents.get(client);
    if (!store) {
        return;
    }
    if (!store.has(roomId)) {
        return;
    }
    if (!eventIds || eventIds.length === 0) {
        store.delete(roomId);
        return;
    }
    const filtered = (store.get(roomId) ?? []).filter(item => !eventIds.includes(item.eventId));
    if (filtered.length === 0) {
        store.delete(roomId);
    } else {
        store.set(roomId, filtered);
    }
};
