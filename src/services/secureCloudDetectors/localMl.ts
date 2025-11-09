import type { SecureCloudDetector, SecureCloudDetectorResult, SecureCloudDetectorStatus } from '../secureCloudService';

export interface LocalMlModel {
    predict: (body: string, roomId?: string) => Promise<number> | number;
}

export interface LocalMlDetectorOptions {
    id: string;
    label: string;
    description?: string;
    loader: () => Promise<LocalMlModel>;
    threshold?: number;
    cacheTtlMs?: number;
    cacheKey?: (input: { body: string; roomId?: string }) => string | null;
    riskAdjust?: (score: number) => number;
}

interface CachedScore {
    value: number;
    expiresAt?: number;
}

interface LocalDetectorRecord {
    detector: SecureCloudDetector;
    loader: () => Promise<LocalMlModel>;
    modelPromise: Promise<LocalMlModel> | null;
    status: SecureCloudDetectorStatus;
    cache: Map<string, CachedScore>;
    threshold: number;
    cacheTtlMs?: number;
    cacheKey?: (input: { body: string; roomId?: string }) => string | null;
    riskAdjust?: (score: number) => number;
}

const registry = new Map<string, LocalDetectorRecord>();

const clampScore = (score: number): number => {
    if (Number.isNaN(score)) {
        return 0;
    }
    return Math.min(1, Math.max(0, score));
};

const readMessageBody = (event: any): { body: string } => {
    const content = (event?.getContent?.() as Record<string, unknown>) || {};
    const body = typeof content['body'] === 'string' ? content['body'] : '';
    return { body };
};

const loadModel = async (record: LocalDetectorRecord): Promise<LocalMlModel> => {
    if (record.modelPromise) {
        return record.modelPromise;
    }
    record.status = { state: 'loading' };
    record.modelPromise = record.loader().then(model => {
        record.status = { state: 'ready' };
        return model;
    }).catch(error => {
        record.status = {
            state: 'error',
            detail: error instanceof Error ? error.message : 'Failed to load local model',
        };
        record.modelPromise = null;
        throw error;
    });
    return record.modelPromise;
};

const getCachedScore = (record: LocalDetectorRecord, key: string): number | null => {
    const cached = record.cache.get(key);
    if (!cached) {
        return null;
    }
    if (record.cacheTtlMs) {
        if (cached.expiresAt && cached.expiresAt < Date.now()) {
            record.cache.delete(key);
            return null;
        }
    }
    return cached.value;
};

const rememberScore = (record: LocalDetectorRecord, key: string, value: number): void => {
    const entry: CachedScore = { value };
    if (record.cacheTtlMs) {
        entry.expiresAt = Date.now() + record.cacheTtlMs;
    }
    record.cache.set(key, entry);
};

export const registerLocalMlDetector = (options: LocalMlDetectorOptions): SecureCloudDetector => {
    if (registry.has(options.id)) {
        throw new Error(`Local ML detector with id "${options.id}" already registered.`);
    }

    const record: LocalDetectorRecord = {
        detector: undefined as unknown as SecureCloudDetector,
        loader: options.loader,
        modelPromise: null,
        status: { state: 'idle' },
        cache: new Map(),
        threshold: typeof options.threshold === 'number' ? options.threshold : 0.5,
        cacheTtlMs: options.cacheTtlMs,
        cacheKey: options.cacheKey,
        riskAdjust: options.riskAdjust,
    };

    const detector: SecureCloudDetector = {
        id: options.id,
        displayName: options.label,
        description: options.description,
        required: false,
        score: async (event, room): Promise<SecureCloudDetectorResult | null> => {
            const { body } = readMessageBody(event);
            if (!body.trim()) {
                return null;
            }

            const key = record.cacheKey ? record.cacheKey({ body, roomId: room?.roomId }) : null;
            if (key) {
                const cached = getCachedScore(record, key);
                if (typeof cached === 'number') {
                    if (cached < record.threshold) {
                        return null;
                    }
                    return { riskScore: cached, reasons: ['ml_cache_hit'] };
                }
            }

            const model = await loadModel(record);
            const rawScore = await model.predict(body, room?.roomId);
            const numericScore = clampScore(typeof rawScore === 'number' ? rawScore : Number(rawScore));
            const adjusted = clampScore(record.riskAdjust ? record.riskAdjust(numericScore) : numericScore);

            if (key) {
                rememberScore(record, key, adjusted);
            }

            if (adjusted < record.threshold) {
                return null;
            }

            return {
                riskScore: adjusted,
                reasons: ['ml_signal'],
            } satisfies SecureCloudDetectorResult;
        },
        getStatus: () => record.status,
    };

    record.detector = detector;
    registry.set(options.id, record);
    return detector;
};

export const unregisterLocalMlDetector = (id: string): void => {
    registry.delete(id);
};

export const clearLocalMlDetectors = (): void => {
    registry.clear();
};

export const getLocalMlDetectors = (): SecureCloudDetector[] => {
    return Array.from(registry.values()).map(record => record.detector);
};

