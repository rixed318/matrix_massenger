import { RoomEvent, EventType } from 'matrix-js-sdk';
import type { MatrixClient, MatrixEvent, MatrixRoom } from '../types';
import { getLocalMlDetectors } from './secureCloudDetectors/localMl';

export type SecureCloudMode = 'disabled' | 'managed' | 'self-hosted';

export interface SecureCloudDetectorResult {
    riskScore: number;
    reasons?: string[];
    keywords?: string[];
    summary?: string;
}

export interface SecureCloudDetectorStatus {
    state: 'idle' | 'loading' | 'ready' | 'error';
    detail?: string;
}

export interface SecureCloudDetector {
    id: string;
    displayName: string;
    description?: string;
    required?: boolean;
    score: (
        event: MatrixEvent,
        room: MatrixRoom,
        profile: SecureCloudProfile,
    ) => Promise<SecureCloudDetectorResult | null> | SecureCloudDetectorResult | null;
    getStatus?: () => Promise<SecureCloudDetectorStatus> | SecureCloudDetectorStatus;
}

export interface SecureCloudDetectorState {
    detector: SecureCloudDetector;
    enabled: boolean;
    config?: Record<string, unknown>;
}

export interface SecureCloudProfile {
    mode: SecureCloudMode;
    apiBaseUrl: string;
    metadataToken?: string;
    analyticsToken?: string;
    enablePremium?: boolean;
    enableAnalytics?: boolean;
    riskThreshold?: number;
    allowedEventTypes?: string[];
    detectors?: SecureCloudDetectorState[];
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

const summariseMessageBody = (body: string): string => {
    return body.length > 160 ? `${body.substring(0, 157)}...` : body;
};

const readEventBody = (event: MatrixEvent): { body: string; msgtype: string } => {
    const content = (event.getContent?.() as Record<string, unknown>) || {};
    const body = typeof content['body'] === 'string' ? content['body'] : '';
    const msgtype = typeof content['msgtype'] === 'string' ? content['msgtype'] : event.getType();
    return { body, msgtype };
};

const builtinDetectors: SecureCloudDetector[] = [
    {
        id: 'basic',
        displayName: 'Базовые эвристики',
        description: 'Поиск ключевых слов и признаков фишинга в сообщениях.',
        required: true,
        score: (event) => {
            const { body, msgtype } = readEventBody(event);
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

            const hasUrl = lowerBody.match(/https?:\/\/[^\s]+/g);
            if (hasUrl) {
                riskScore += 0.2;
                reasons.push('contains_url');
            }

            if (body.length > 500) {
                riskScore += 0.05;
                reasons.push('long_body');
            }

            const cappedScore = Math.min(1, riskScore);
            if (cappedScore <= 0) {
                return null;
            }

            return {
                riskScore: cappedScore,
                reasons,
                keywords,
                summary: summariseMessageBody(body),
            } satisfies SecureCloudDetectorResult;
        },
    },
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

const mergeDetectors = (profile: SecureCloudProfile): SecureCloudDetectorState[] => {
    const states = new Map<string, SecureCloudDetectorState>();

    const register = (state: SecureCloudDetectorState): void => {
        const detector = state.detector;
        if (!detector) {
            return;
        }
        const required = Boolean(detector.required);
        const enabled = required ? true : state.enabled !== false;
        states.set(detector.id, { ...state, detector, enabled });
    };

    for (const detector of builtinDetectors) {
        register({ detector, enabled: true });
    }

    for (const state of profile.detectors ?? []) {
        if (!state?.detector) {
            continue;
        }
        register(state);
    }

    for (const detector of getLocalMlDetectors()) {
        const existing = states.get(detector.id);
        if (existing) {
            register({ ...existing, detector, enabled: existing.enabled });
        } else {
            register({ detector, enabled: false });
        }
    }

    return Array.from(states.values());
};

export const resolveSecureCloudDetectors = (profile: SecureCloudProfile): SecureCloudDetectorState[] => {
    return mergeDetectors(profile);
};

export const normaliseSecureCloudProfile = (profile: SecureCloudProfile): SecureCloudProfile => {
    return {
        ...profile,
        detectors: mergeDetectors(profile),
    };
};

interface DetectorExecutionError {
    detectorId: string;
    error: Error;
}

const evaluateEventRisk = async (
    event: MatrixEvent,
    room: MatrixRoom,
    profile: SecureCloudProfile,
): Promise<{ notice: SuspiciousEventNotice | null; errors: DetectorExecutionError[] }> => {
    const detectors = resolveSecureCloudDetectors(profile);
    const errors: DetectorExecutionError[] = [];
    const keywords = new Set<string>();
    const reasons: string[] = [];
    let aggregatedScore = 0;
    let summaryFromDetectors: string | undefined;

    const { body } = readEventBody(event);

    for (const state of detectors) {
        const detector = state.detector;
        if (!detector) {
            continue;
        }
        const required = Boolean(detector.required);
        if (!state.enabled && !required) {
            continue;
        }

        try {
            const result = await detector.score(event, room, profile);
            if (!result) {
                continue;
            }

            const contribution = Math.min(1, Math.max(0, result.riskScore));
            if (contribution <= 0) {
                continue;
            }

            aggregatedScore += contribution;

            if (Array.isArray(result.reasons) && result.reasons.length > 0) {
                for (const reason of result.reasons) {
                    reasons.push(`${detector.id}:${reason}`);
                }
            } else {
                reasons.push(detector.id);
            }

            if (Array.isArray(result.keywords)) {
                for (const keyword of result.keywords) {
                    if (keyword) {
                        keywords.add(keyword);
                    }
                }
            }

            if (!summaryFromDetectors && result.summary) {
                summaryFromDetectors = result.summary;
            }
        } catch (error) {
            const err = error instanceof Error ? error : new Error('Secure Cloud detector failure');
            errors.push({ detectorId: detector.id, error: err });
        }
    }

    const threshold = typeof profile.riskThreshold === 'number' ? profile.riskThreshold : 0.6;
    const cappedScore = Math.min(1, aggregatedScore);

    if (cappedScore < threshold) {
        return { notice: null, errors };
    }

    const summary = summaryFromDetectors ?? summariseMessageBody(body);

    return {
        notice: {
            eventId: event.getId?.() ?? 'unknown',
            roomId: room.roomId,
            roomName: room.name ?? room.roomId,
            sender: event.getSender?.() ?? 'unknown',
            timestamp: event.getTs?.() ?? Date.now(),
            riskScore: Number(cappedScore.toFixed(2)),
            reasons,
            summary,
            keywords: Array.from(keywords),
        },
        errors,
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
    let profile = normaliseSecureCloudProfile(initialProfile);
    const processedEvents = new Set<string>();

    const store = ensureStore(client);

    const handler = async (event: MatrixEvent, room: MatrixRoom | undefined) => {
        profile = normaliseSecureCloudProfile(profile);
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

        const { notice, errors: detectorErrors } = await evaluateEventRisk(event, room, profile);

        for (const detectorError of detectorErrors) {
            const { detectorId, error } = detectorError;
            const message = `Secure Cloud detector ${detectorId} failed: ${error.message}`;
            callbacks.onError?.(new Error(message));
        }

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
            profile = normaliseSecureCloudProfile(nextProfile);
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
