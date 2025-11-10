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

export interface SecureCloudDetectorConfig {
    threshold?: number;
    language?: string;
    [key: string]: unknown;
}

export interface SecureCloudDetector {
    id: string;
    displayName: string;
    description?: string;
    required?: boolean;
    requireForPremium?: boolean;
    defaultConfig?: SecureCloudDetectorConfig;
    warmup?: () => Promise<void> | void;
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
    config?: SecureCloudDetectorConfig;
}

export interface SecureCloudProfile {
    mode: SecureCloudMode;
    apiBaseUrl: string;
    metadataToken?: string;
    analyticsToken?: string;
    enablePremium?: boolean;
    enableAnalytics?: boolean;
    metadataConsent?: boolean;
    retentionPeriodDays?: number;
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

export interface SecureCloudRetentionBucket {
    id: string;
    label: string;
    maxDurationMs: number | null;
}

export interface SecureCloudAggregatedStats {
    totalFlagged: number;
    openNotices: number;
    flags: Record<string, number>;
    actions: Record<string, number>;
    retention: {
        count: number;
        averageMs: number | null;
        minMs: number | null;
        maxMs: number | null;
        buckets: Record<string, number>;
        policyDays: number | null;
    };
    updatedAt: number;
}

export type SecureCloudStatsListener = (stats: SecureCloudAggregatedStats) => void;

export type SecureCloudLogFormat = 'json' | 'csv';

export interface SecureCloudLogExportOptions {
    roomId?: string;
    format?: SecureCloudLogFormat;
    includeHeaders?: boolean;
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

const statsStore = new WeakMap<MatrixClient, AggregatedStatsStore>();
const retentionPolicies = new WeakMap<MatrixClient, number>();

const DAY_MS = 86_400_000;

export const SECURE_CLOUD_RETENTION_BUCKETS: SecureCloudRetentionBucket[] = [
    { id: 'under_1h', label: '≤ 1 часа', maxDurationMs: 60 * 60 * 1000 },
    { id: 'under_24h', label: '≤ 24 часов', maxDurationMs: 24 * 60 * 60 * 1000 },
    { id: 'under_7d', label: '≤ 7 дней', maxDurationMs: 7 * DAY_MS },
    { id: 'under_30d', label: '≤ 30 дней', maxDurationMs: 30 * DAY_MS },
    { id: 'over_30d', label: '> 30 дней', maxDurationMs: null },
];

interface AggregatedRetentionInternal {
    count: number;
    totalDurationMs: number;
    minMs: number | null;
    maxMs: number | null;
    buckets: Map<string, number>;
    policyDays: number | null;
}

interface AggregatedStatsInternal {
    totalFlagged: number;
    openNotices: number;
    flags: Map<string, number>;
    actions: Map<string, number>;
    retention: AggregatedRetentionInternal;
    updatedAt: number;
}

interface AggregatedStatsStore {
    stats: AggregatedStatsInternal;
    listeners: Set<SecureCloudStatsListener>;
    lastSnapshot: SecureCloudAggregatedStats;
}

const createEmptyRetention = (): AggregatedRetentionInternal => ({
    count: 0,
    totalDurationMs: 0,
    minMs: null,
    maxMs: null,
    buckets: new Map<string, number>(),
    policyDays: null,
});

const createEmptyStats = (): AggregatedStatsInternal => ({
    totalFlagged: 0,
    openNotices: 0,
    flags: new Map<string, number>(),
    actions: new Map<string, number>(),
    retention: createEmptyRetention(),
    updatedAt: Date.now(),
});

const mapToRecord = (map: Map<string, number>): Record<string, number> => {
    const record: Record<string, number> = {};
    const entries = Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
    for (const [key, value] of entries) {
        record[key] = value;
    }
    return record;
};

const buildSnapshot = (stats: AggregatedStatsInternal): SecureCloudAggregatedStats => {
    const retentionBuckets: Record<string, number> = {};
    for (const bucket of SECURE_CLOUD_RETENTION_BUCKETS) {
        retentionBuckets[bucket.id] = stats.retention.buckets.get(bucket.id) ?? 0;
    }
    const averageMs = stats.retention.count > 0
        ? Math.round(stats.retention.totalDurationMs / stats.retention.count)
        : null;
    return {
        totalFlagged: stats.totalFlagged,
        openNotices: stats.openNotices,
        flags: mapToRecord(stats.flags),
        actions: mapToRecord(stats.actions),
        retention: {
            count: stats.retention.count,
            averageMs,
            minMs: stats.retention.minMs,
            maxMs: stats.retention.maxMs,
            buckets: retentionBuckets,
            policyDays: stats.retention.policyDays,
        },
        updatedAt: stats.updatedAt,
    } satisfies SecureCloudAggregatedStats;
};

const ensureStatsStore = (client: MatrixClient): AggregatedStatsStore => {
    let store = statsStore.get(client);
    if (!store) {
        const stats = createEmptyStats();
        store = {
            stats,
            listeners: new Set<SecureCloudStatsListener>(),
            lastSnapshot: buildSnapshot(stats),
        } satisfies AggregatedStatsStore;
        statsStore.set(client, store);
    }
    return store;
};

const dispatchStatsUpdate = (client: MatrixClient, store: AggregatedStatsStore): void => {
    store.lastSnapshot = buildSnapshot(store.stats);
    if (store.listeners.size === 0) {
        return;
    }
    for (const listener of Array.from(store.listeners)) {
        try {
            listener(store.lastSnapshot);
        } catch (error) {
            console.warn('Secure Cloud stats listener failed', error);
        }
    }
};

const normaliseReasonKey = (reason: string | null | undefined): string => {
    const value = typeof reason === 'string' && reason.trim().length > 0 ? reason.trim() : 'unspecified';
    return value.toLowerCase();
};

const getRetentionBucketId = (durationMs: number): string => {
    for (const bucket of SECURE_CLOUD_RETENTION_BUCKETS) {
        if (bucket.maxDurationMs === null || durationMs <= bucket.maxDurationMs) {
            return bucket.id;
        }
    }
    return SECURE_CLOUD_RETENTION_BUCKETS[SECURE_CLOUD_RETENTION_BUCKETS.length - 1]?.id ?? 'over_30d';
};

const applyRetentionSample = (stats: AggregatedStatsInternal, durationMs: number): void => {
    const retention = stats.retention;
    const safeDuration = Number.isFinite(durationMs) ? Math.max(0, durationMs) : 0;
    retention.count += 1;
    retention.totalDurationMs += safeDuration;
    retention.minMs = retention.minMs === null ? safeDuration : Math.min(retention.minMs, safeDuration);
    retention.maxMs = retention.maxMs === null ? safeDuration : Math.max(retention.maxMs, safeDuration);
    const bucketId = getRetentionBucketId(safeDuration);
    retention.buckets.set(bucketId, (retention.buckets.get(bucketId) ?? 0) + 1);
};

const recordFlaggedEventStats = (client: MatrixClient, notice: SuspiciousEventNotice): void => {
    const store = ensureStatsStore(client);
    store.stats.totalFlagged += 1;
    store.stats.openNotices += 1;
    store.stats.actions.set('flagged', (store.stats.actions.get('flagged') ?? 0) + 1);
    const reasons = Array.isArray(notice.reasons) && notice.reasons.length > 0 ? notice.reasons : ['unspecified'];
    for (const reason of reasons) {
        const key = normaliseReasonKey(reason);
        store.stats.flags.set(key, (store.stats.flags.get(key) ?? 0) + 1);
    }
    store.stats.updatedAt = Date.now();
    dispatchStatsUpdate(client, store);
};

type NoticeResolutionAction = 'acknowledged' | 'expired';

const recordNoticeResolutionStats = (
    client: MatrixClient,
    notices: SuspiciousEventNotice[],
    action: NoticeResolutionAction,
): void => {
    if (!notices || notices.length === 0) {
        return;
    }
    const store = ensureStatsStore(client);
    store.stats.openNotices = Math.max(0, store.stats.openNotices - notices.length);
    store.stats.actions.set(action, (store.stats.actions.get(action) ?? 0) + notices.length);
    const now = Date.now();
    for (const notice of notices) {
        const duration = now - notice.timestamp;
        applyRetentionSample(store.stats, duration);
    }
    store.stats.updatedAt = now;
    dispatchStatsUpdate(client, store);
};

const recordExportedEventsStats = (client: MatrixClient, exportedCount: number): void => {
    if (!exportedCount || exportedCount <= 0) {
        return;
    }
    const store = ensureStatsStore(client);
    store.stats.actions.set('exported', (store.stats.actions.get('exported') ?? 0) + exportedCount);
    store.stats.updatedAt = Date.now();
    dispatchStatsUpdate(client, store);
};

const updateRetentionPolicyForClient = (client: MatrixClient, days?: number | null): void => {
    const normalised = typeof days === 'number' && Number.isFinite(days) ? Math.max(0, days) : null;
    if (normalised === null) {
        retentionPolicies.delete(client);
    } else {
        retentionPolicies.set(client, normalised);
    }
    const store = ensureStatsStore(client);
    if (store.stats.retention.policyDays !== normalised) {
        store.stats.retention.policyDays = normalised;
        store.stats.updatedAt = Date.now();
        dispatchStatsUpdate(client, store);
    }
};

const applyRetentionPolicy = (
    client: MatrixClient,
    store: Map<string, SuspiciousEventNotice[]>,
): void => {
    const days = retentionPolicies.get(client);
    if (!days || days <= 0) {
        if (days === 0) {
            // Immediate cleanup requested: purge everything.
            const removed: SuspiciousEventNotice[] = [];
            for (const [roomId, events] of store.entries()) {
                removed.push(...events);
                store.delete(roomId);
            }
            if (removed.length > 0) {
                recordNoticeResolutionStats(client, removed, 'expired');
            }
        }
        return;
    }
    const retentionMs = days * DAY_MS;
    if (!Number.isFinite(retentionMs) || retentionMs <= 0) {
        return;
    }
    const now = Date.now();
    const expired: SuspiciousEventNotice[] = [];
    for (const [roomId, events] of store.entries()) {
        const remaining: SuspiciousEventNotice[] = [];
        for (const notice of events) {
            const age = now - notice.timestamp;
            if (age > retentionMs) {
                expired.push(notice);
            } else {
                remaining.push(notice);
            }
        }
        if (remaining.length === 0) {
            store.delete(roomId);
        } else if (remaining.length !== events.length) {
            store.set(roomId, remaining);
        }
    }
    if (expired.length > 0) {
        recordNoticeResolutionStats(client, expired, 'expired');
    }
};

export const getSecureCloudAggregatedStats = (client: MatrixClient): SecureCloudAggregatedStats => {
    const store = ensureStatsStore(client);
    return store.lastSnapshot;
};

export const subscribeSecureCloudAggregatedStats = (
    client: MatrixClient,
    listener: SecureCloudStatsListener,
): (() => void) => {
    const store = ensureStatsStore(client);
    store.listeners.add(listener);
    listener(store.lastSnapshot);
    return () => {
        const current = statsStore.get(client);
        current?.listeners.delete(listener);
    };
};

export const setSecureCloudRetentionPolicy = (client: MatrixClient, days?: number | null): void => {
    updateRetentionPolicyForClient(client, days);
    const store = suspiciousEvents.get(client);
    if (store) {
        applyRetentionPolicy(client, store);
    }
};

const escapeCsvCell = (value: string): string => {
    const safe = value.replace(/"/g, '""');
    return /[",\n]/.test(safe) ? `"${safe}"` : safe;
};

export const exportSuspiciousEventsLog = (
    client: MatrixClient,
    options: SecureCloudLogExportOptions = {},
): string => {
    const { roomId, format = 'json', includeHeaders = true } = options;
    const notices = getSuspiciousEvents(client, roomId);
    const records = notices.map(notice => ({
        event_id: notice.eventId,
        room_id: notice.roomId,
        room_name: notice.roomName ?? '',
        sender: notice.sender,
        timestamp: new Date(notice.timestamp).toISOString(),
        risk_score: notice.riskScore,
        reasons: (notice.reasons ?? []).join(';'),
        keywords: (notice.keywords ?? []).join(';'),
        summary: notice.summary,
        age_ms: Math.max(0, Date.now() - notice.timestamp),
    }));

    let payload: string;
    if (format === 'csv') {
        const headers = [
            'event_id',
            'room_id',
            'room_name',
            'sender',
            'timestamp',
            'risk_score',
            'reasons',
            'keywords',
            'summary',
            'age_ms',
        ];
        const rows: string[] = [];
        if (includeHeaders) {
            rows.push(headers.join(','));
        }
        for (const record of records) {
            const values = headers.map(header => {
                const raw = record[header as keyof typeof record];
                return escapeCsvCell(raw != null ? String(raw) : '');
            });
            rows.push(values.join(','));
        }
        payload = rows.join('\n');
    } else {
        payload = JSON.stringify(records, null, 2);
    }

    recordExportedEventsStats(client, notices.length);
    return payload;
};

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

const mergeDetectorConfig = (
    detector: SecureCloudDetector,
    stateConfig?: SecureCloudDetectorConfig,
): SecureCloudDetectorConfig | undefined => {
    if (!detector.defaultConfig && !stateConfig) {
        return undefined;
    }
    if (detector.defaultConfig && stateConfig) {
        return { ...detector.defaultConfig, ...stateConfig };
    }
    if (detector.defaultConfig) {
        return { ...detector.defaultConfig };
    }
    if (stateConfig) {
        return { ...stateConfig };
    }
    return undefined;
};

const mergeDetectors = (profile: SecureCloudProfile): SecureCloudDetectorState[] => {
    const states = new Map<string, SecureCloudDetectorState>();

    const register = (state: SecureCloudDetectorState): void => {
        const detector = state.detector;
        if (!detector) {
            return;
        }

        const premiumRequired = Boolean(profile.enablePremium && detector.requireForPremium);
        const required = premiumRequired || Boolean(detector.required);
        const effectiveDetector = required && !detector.required ? { ...detector, required: true } : detector;
        const enabled = required ? true : state.enabled !== false;
        const config = mergeDetectorConfig(effectiveDetector, state.config);

        const finalState: SecureCloudDetectorState = {
            ...state,
            detector: effectiveDetector,
            enabled,
            config,
        };
        states.set(detector.id, finalState);

        if ((required || enabled) && typeof effectiveDetector.warmup === 'function') {
            try {
                void effectiveDetector.warmup();
            } catch {
                // warmup errors are reported via detector status
            }
        }
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
            register({ ...existing, detector, enabled: existing.enabled, config: existing.config });
        } else {
            register({ detector, enabled: false, config: detector.defaultConfig });
        }
    }

    return Array.from(states.values());
};

export const resolveSecureCloudDetectors = (profile: SecureCloudProfile): SecureCloudDetectorState[] => {
    return mergeDetectors(profile);
};

export const normaliseSecureCloudProfile = (profile: SecureCloudProfile): SecureCloudProfile => {
    const metadataConsent = profile.metadataConsent !== undefined ? Boolean(profile.metadataConsent) : true;
    const retentionPeriodDays =
        typeof profile.retentionPeriodDays === 'number' && Number.isFinite(profile.retentionPeriodDays)
            ? Math.max(0, profile.retentionPeriodDays)
            : undefined;
    return {
        ...profile,
        metadataConsent,
        retentionPeriodDays,
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
    if (!profile.apiBaseUrl || profile.metadataConsent === false) {
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
    updateRetentionPolicyForClient(client, profile.retentionPeriodDays);
    applyRetentionPolicy(client, store);

    const handler = async (event: MatrixEvent, room: MatrixRoom | undefined) => {
        profile = normaliseSecureCloudProfile(profile);
        updateRetentionPolicyForClient(client, profile.retentionPeriodDays);
        applyRetentionPolicy(client, store);
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
            recordFlaggedEventStats(client, notice);
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
            updateRetentionPolicyForClient(client, profile.retentionPeriodDays);
            applyRetentionPolicy(client, store);
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
    applyRetentionPolicy(client, store);
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
    const existing = store.get(roomId) ?? [];
    if (!eventIds || eventIds.length === 0) {
        store.delete(roomId);
        recordNoticeResolutionStats(client, existing, 'acknowledged');
        return;
    }
    const eventIdSet = new Set(eventIds);
    const retained: SuspiciousEventNotice[] = [];
    const removed: SuspiciousEventNotice[] = [];
    for (const notice of existing) {
        if (eventIdSet.has(notice.eventId)) {
            removed.push(notice);
        } else {
            retained.push(notice);
        }
    }
    if (retained.length === 0) {
        store.delete(roomId);
    } else {
        store.set(roomId, retained);
    }
    if (removed.length > 0) {
        recordNoticeResolutionStats(client, removed, 'acknowledged');
    }
};
