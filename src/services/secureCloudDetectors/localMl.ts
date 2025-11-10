import type {
    SecureCloudDetector,
    SecureCloudDetectorConfig,
    SecureCloudDetectorResult,
    SecureCloudDetectorStatus,
    SecureCloudProfile,
} from '../secureCloudService';

export type LocalMlCategory = 'spam' | 'phishing' | 'nsfw';
export type LocalMlLanguage = 'ru' | 'en';

export interface LocalMlPrediction {
    categories: Record<LocalMlCategory, number>;
    topCategory: LocalMlCategory;
    riskScore: number;
    matchedKeywords: string[];
}

export interface LocalMlModel {
    predict: (input: { body: string; roomId?: string; language?: string }) => Promise<LocalMlPrediction>;
}

export interface LocalMlDetectorOptions {
    id: string;
    label: string;
    description?: string;
    loader?: () => Promise<LocalMlModel>;
    modelUrl?: string;
    threshold?: number;
    cacheTtlMs?: number;
    cacheKey?: (input: { body: string; roomId?: string }) => string | null;
    riskAdjust?: (score: number) => number;
    defaultConfig?: SecureCloudDetectorConfig;
    requireForPremium?: boolean;
}

interface LiteModelData {
    version: number;
    features: string[];
    weights: Record<LocalMlCategory, number[]>;
    biases?: Partial<Record<LocalMlCategory, number>>;
}

interface CachedScore {
    value: number;
    label?: LocalMlCategory;
    keywords?: string[];
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
    defaultConfig?: SecureCloudDetectorConfig;
    requireForPremium?: boolean;
}

const DEFAULT_MODEL_URL = new URL('../../assets/secure-cloud/lite-model.json', import.meta.url).toString();
const MODEL_CACHE_NAME = 'secure-cloud-lite-models';
const DEFAULT_THRESHOLD = 0.6;
const CATEGORIES: LocalMlCategory[] = ['spam', 'phishing', 'nsfw'];

const registry = new Map<string, LocalDetectorRecord>();
const modelDataCache = new Map<string, LiteModelData>();

const KEYWORD_DICTIONARY: Record<LocalMlCategory, Record<'common' | 'ru' | 'en', string[]>> = {
    spam: {
        common: ['free', 'bonus', 'limited', 'приз', 'розыгрыш', 'подарок'],
        ru: ['выигрыш', 'дарим', 'акция', 'скидка'],
        en: ['exclusive', 'act now', 'lottery', 'jackpot'],
    },
    phishing: {
        common: ['verify', 'account', 'login', 'подтвердите', 'доступ', 'банк'],
        ru: ['пароль', 'обновите данные', 'перейдите по ссылке'],
        en: ['security alert', 'reset password', 'click here'],
    },
    nsfw: {
        common: ['nsfw', 'adult', 'xxx', 'эротика', '18+'],
        ru: ['порно', 'интим', 'секс'],
        en: ['nudes', 'camgirl', 'fetish'],
    },
};

const clampScore = (score: number): number => {
    if (!Number.isFinite(score) || Number.isNaN(score)) {
        return 0;
    }
    return Math.min(1, Math.max(0, score));
};

const readMessageBody = (event: any): { body: string } => {
    const content = (event?.getContent?.() as Record<string, unknown>) || {};
    const body = typeof content['body'] === 'string' ? content['body'] : '';
    return { body };
};

const detectLanguageFromBody = (body: string): LocalMlLanguage => {
    const cyrillic = body.match(/[\u0400-\u04FF]/g)?.length ?? 0;
    const latin = body.match(/[A-Za-z]/g)?.length ?? 0;
    if (cyrillic > latin) {
        return 'ru';
    }
    return 'en';
};

const normaliseLanguage = (language: string | undefined, body: string): LocalMlLanguage => {
    if (!language || language === 'auto') {
        return detectLanguageFromBody(body);
    }
    if (language === 'ru' || language === 'en') {
        return language;
    }
    return detectLanguageFromBody(body);
};

const gatherKeywords = (body: string, language: LocalMlLanguage): Record<LocalMlCategory, string[]> => {
    const matches: Record<LocalMlCategory, string[]> = {
        spam: [],
        phishing: [],
        nsfw: [],
    };
    const lower = body.toLowerCase();
    for (const category of CATEGORIES) {
        const sources = [
            KEYWORD_DICTIONARY[category].common,
            KEYWORD_DICTIONARY[category][language],
        ].filter(Boolean) as string[][];
        for (const source of sources) {
            for (const keyword of source) {
                if (!keyword) {
                    continue;
                }
                if (lower.includes(keyword)) {
                    matches[category].push(keyword);
                }
            }
        }
    }
    return matches;
};

const computeFeatureVector = (body: string, language: LocalMlLanguage): {
    vector: Float32Array;
    matchedKeywords: string[];
} => {
    const trimmed = body.trim();
    if (!trimmed) {
        return { vector: new Float32Array(6), matchedKeywords: [] };
    }

    const keywordMatches = gatherKeywords(trimmed, language);
    const spamHits = keywordMatches.spam.length;
    const phishingHits = keywordMatches.phishing.length;
    const nsfwHits = keywordMatches.nsfw.length;

    const urlMatches = trimmed.match(/https?:\/\/\S+/gi) ?? [];

    let uppercaseLetters = 0;
    let totalLetters = 0;
    for (const char of trimmed) {
        if (/[A-Za-zА-ЯЁа-яё]/.test(char)) {
            totalLetters += 1;
            if (char === char.toUpperCase() && char !== char.toLowerCase()) {
                uppercaseLetters += 1;
            }
        }
    }

    const uppercaseRatio = totalLetters > 0 ? uppercaseLetters / totalLetters : 0;
    const lengthNormalised = Math.min(1, trimmed.length / 600);

    const vector = new Float32Array([
        Math.min(1, spamHits / 4),
        Math.min(1, phishingHits / 4),
        Math.min(1, nsfwHits / 4),
        Math.min(1, urlMatches.length / 3),
        Math.min(1, uppercaseRatio),
        lengthNormalised,
    ]);

    const keywordSet = new Set<string>();
    for (const category of CATEGORIES) {
        for (const hit of keywordMatches[category]) {
            if (keywordSet.size >= 8) {
                break;
            }
            keywordSet.add(hit);
        }
    }

    return { vector, matchedKeywords: Array.from(keywordSet) };
};

const logistic = (value: number): number => {
    if (!Number.isFinite(value)) {
        return 0.5;
    }
    if (value >= 0) {
        const z = Math.exp(-value);
        return 1 / (1 + z);
    }
    const z = Math.exp(value);
    return z / (1 + z);
};

const parseModelText = (text: string): LiteModelData => {
    let raw: unknown;
    try {
        raw = JSON.parse(text);
    } catch {
        throw new Error('Локальная ML модель повреждена (некорректный JSON)');
    }

    if (!raw || typeof raw !== 'object') {
        throw new Error('Локальная ML модель имеет неверный формат');
    }

    const candidate = raw as Partial<LiteModelData> & Record<string, unknown>;
    const weights = candidate.weights ?? {};
    const biases = candidate.biases ?? {};

    const normalisedWeights: Record<LocalMlCategory, number[]> = {
        spam: [],
        phishing: [],
        nsfw: [],
    };

    for (const category of CATEGORIES) {
        const source = Array.isArray((weights as Record<string, unknown>)[category])
            ? (weights as Record<string, unknown>)[category] as unknown[]
            : null;
        if (!source || source.length === 0) {
            throw new Error(`Локальная ML модель не содержит весов для категории ${category}`);
        }
        normalisedWeights[category] = source.map(value => {
            const numeric = Number(value);
            return Number.isFinite(numeric) ? numeric : 0;
        });
    }

    const normalisedBiases: Partial<Record<LocalMlCategory, number>> = {};
    if (biases && typeof biases === 'object') {
        for (const category of CATEGORIES) {
            const numeric = Number((biases as Record<string, unknown>)[category]);
            if (Number.isFinite(numeric)) {
                normalisedBiases[category] = numeric;
            }
        }
    }

    return {
        version: typeof candidate.version === 'number' ? candidate.version : 1,
        features: Array.isArray(candidate.features)
            ? candidate.features.map(feature => String(feature))
            : [],
        weights: normalisedWeights,
        biases: normalisedBiases,
    } satisfies LiteModelData;
};

const fetchModelData = async (url: string): Promise<LiteModelData> => {
    const existing = modelDataCache.get(url);
    if (existing) {
        return existing;
    }

    if (typeof caches !== 'undefined' && typeof caches.open === 'function') {
        try {
            const cache = await caches.open(MODEL_CACHE_NAME);
            const cachedResponse = await cache.match(url);
            if (cachedResponse) {
                const text = await cachedResponse.text();
                const model = parseModelText(text);
                modelDataCache.set(url, model);
                return model;
            }
        } catch {
            // ignore cache errors in non-browser environments
        }
    }

    const response = await fetch(url, { cache: 'force-cache' });
    if (!response.ok) {
        throw new Error(`Не удалось загрузить ML модель (${response.status})`);
    }
    const text = await response.text();
    const model = parseModelText(text);
    modelDataCache.set(url, model);

    if (typeof caches !== 'undefined' && typeof caches.open === 'function') {
        try {
            const cache = await caches.open(MODEL_CACHE_NAME);
            await cache.put(url, new Response(text, { headers: { 'Content-Type': 'application/json' } }));
        } catch {
            // ignore cache persistence errors
        }
    }

    return model;
};

const createModelLoader = (options: Required<Pick<LocalMlDetectorOptions, 'modelUrl'>>): (() => Promise<LocalMlModel>) => {
    return async () => {
        const modelData = await fetchModelData(options.modelUrl);
        const featureCount = modelData.weights[CATEGORIES[0]]?.length ?? 0;
        if (featureCount === 0) {
            throw new Error('Локальная ML модель не содержит параметров');
        }
        return {
            predict: async ({ body, language }) => {
                const resolvedLanguage = normaliseLanguage(language, body);
                const { vector, matchedKeywords } = computeFeatureVector(body, resolvedLanguage);
                if (vector.length !== featureCount) {
                    throw new Error('Размерность признаков не совпадает с параметрами модели');
                }
                const categories: Record<LocalMlCategory, number> = {
                    spam: 0,
                    phishing: 0,
                    nsfw: 0,
                };
                let topCategory: LocalMlCategory = 'spam';
                let topScore = 0;
                for (const category of CATEGORIES) {
                    const weights = modelData.weights[category];
                    let score = modelData.biases?.[category] ?? 0;
                    for (let i = 0; i < vector.length; i += 1) {
                        score += weights[i] * vector[i];
                    }
                    const probability = clampScore(logistic(score));
                    categories[category] = probability;
                    if (probability >= topScore) {
                        topScore = probability;
                        topCategory = category;
                    }
                }

                return {
                    categories,
                    topCategory,
                    riskScore: clampScore(topScore),
                    matchedKeywords,
                } satisfies LocalMlPrediction;
            },
        } satisfies LocalMlModel;
    };
};

const loadModel = async (record: LocalDetectorRecord): Promise<LocalMlModel> => {
    if (record.modelPromise) {
        return record.modelPromise;
    }
    record.status = { state: 'loading', detail: 'Загружаем локальную ML модель' };
    record.modelPromise = record.loader().then(model => {
        record.status = { state: 'ready', detail: 'Модель готова' };
        return model;
    }).catch(error => {
        record.status = {
            state: 'error',
            detail: error instanceof Error ? error.message : 'Не удалось инициализировать локальную модель',
        };
        record.modelPromise = null;
        throw error;
    });
    return record.modelPromise;
};

const getCachedScore = (record: LocalDetectorRecord, key: string): CachedScore | null => {
    const cached = record.cache.get(key);
    if (!cached) {
        return null;
    }
    if (record.cacheTtlMs && cached.expiresAt && cached.expiresAt < Date.now()) {
        record.cache.delete(key);
        return null;
    }
    return cached;
};

const rememberScore = (record: LocalDetectorRecord, key: string, prediction: LocalMlPrediction): void => {
    const entry: CachedScore = {
        value: prediction.riskScore,
        label: prediction.topCategory,
        keywords: prediction.matchedKeywords.slice(0, 8),
    };
    if (record.cacheTtlMs) {
        entry.expiresAt = Date.now() + record.cacheTtlMs;
    }
    record.cache.set(key, entry);
};

const resolveThreshold = (
    record: LocalDetectorRecord,
    profile: SecureCloudProfile,
): number => {
    const config = profile.detectors?.find(state => state.detector.id === record.detector.id)?.config;
    const configThreshold = typeof config?.threshold === 'number' ? config.threshold : undefined;
    const defaultThreshold = typeof record.defaultConfig?.threshold === 'number'
        ? record.defaultConfig.threshold
        : undefined;
    return typeof configThreshold === 'number'
        ? clampScore(configThreshold)
        : typeof defaultThreshold === 'number'
            ? clampScore(defaultThreshold)
            : record.threshold;
};

const resolveLanguagePreference = (
    record: LocalDetectorRecord,
    profile: SecureCloudProfile,
): string | undefined => {
    const config = profile.detectors?.find(state => state.detector.id === record.detector.id)?.config;
    if (typeof config?.language === 'string') {
        return config.language;
    }
    if (typeof record.defaultConfig?.language === 'string') {
        return record.defaultConfig.language;
    }
    return 'auto';
};

const defaultCacheKey = ({ body, roomId }: { body: string; roomId?: string }): string | null => {
    const trimmed = body.trim();
    if (!trimmed) {
        return null;
    }
    const normalised = trimmed.toLowerCase().replace(/\s+/g, ' ').slice(0, 256);
    return `${roomId ?? 'global'}:${normalised}`;
};

export const registerLocalMlDetector = (options: LocalMlDetectorOptions): SecureCloudDetector => {
    if (registry.has(options.id)) {
        throw new Error(`Local ML detector with id "${options.id}" already registered.`);
    }

    const loader = options.loader ?? (options.modelUrl
        ? createModelLoader({ modelUrl: options.modelUrl })
        : null);
    if (!loader) {
        throw new Error(`Local ML detector ${options.id} must provide loader or modelUrl.`);
    }

    const threshold = typeof options.threshold === 'number' ? clampScore(options.threshold) : DEFAULT_THRESHOLD;
    const defaultConfig: SecureCloudDetectorConfig | undefined = options.defaultConfig
        ? { ...options.defaultConfig }
        : { threshold, language: 'auto' };

    const record: LocalDetectorRecord = {
        detector: undefined as unknown as SecureCloudDetector,
        loader,
        modelPromise: null,
        status: { state: 'idle', detail: 'Ожидает запуска' },
        cache: new Map(),
        threshold,
        cacheTtlMs: options.cacheTtlMs ?? 10 * 60 * 1000,
        cacheKey: options.cacheKey ?? defaultCacheKey,
        riskAdjust: options.riskAdjust,
        defaultConfig,
        requireForPremium: Boolean(options.requireForPremium),
    };

    const detector: SecureCloudDetector = {
        id: options.id,
        displayName: options.label,
        description: options.description,
        required: false,
        defaultConfig,
        requireForPremium: record.requireForPremium,
        warmup: () => loadModel(record).then(() => undefined).catch(() => undefined),
        score: async (event, room, profile): Promise<SecureCloudDetectorResult | null> => {
            const { body } = readMessageBody(event);
            if (!body.trim()) {
                return null;
            }

            const key = record.cacheKey ? record.cacheKey({ body, roomId: room?.roomId }) : null;
            const thresholdValue = resolveThreshold(record, profile);
            if (key) {
                const cached = getCachedScore(record, key);
                if (cached) {
                    if (cached.value < thresholdValue) {
                        return null;
                    }
                    const cacheReason = cached.label ? `ml_cache_hit:${cached.label}` : 'ml_cache_hit';
                    return {
                        riskScore: cached.value,
                        reasons: [cacheReason],
                        keywords: cached.keywords ?? [],
                    } satisfies SecureCloudDetectorResult;
                }
            }

            const model = await loadModel(record);
            const languagePreference = resolveLanguagePreference(record, profile);
            const prediction = await model.predict({ body, roomId: room?.roomId, language: languagePreference });
            let adjustedScore = prediction.riskScore;
            if (record.riskAdjust) {
                adjustedScore = clampScore(record.riskAdjust(prediction.riskScore));
            }

            if (key) {
                rememberScore(record, key, { ...prediction, riskScore: adjustedScore });
            }

            if (adjustedScore < thresholdValue) {
                return null;
            }

            const reasons = [`ml_${prediction.topCategory}`];
            if (adjustedScore >= 0.85) {
                reasons.push('ml_high_confidence');
            }

            return {
                riskScore: adjustedScore,
                reasons,
                keywords: prediction.matchedKeywords,
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
    modelDataCache.clear();
};

export const getLocalMlDetectors = (): SecureCloudDetector[] => {
    return Array.from(registry.values()).map(record => record.detector);
};

export const prefetchLocalMlDetector = async (id: string): Promise<void> => {
    const record = registry.get(id);
    if (!record) {
        return;
    }
    try {
        await loadModel(record);
    } catch {
        // swallow preload errors, status will contain details
    }
};

try {
    registerLocalMlDetector({
        id: 'secure-cloud-lite-ml',
        label: 'Локальная ML модель (lite)',
        description: 'Лёгкая линейная модель в JSON для оценки спама, фишинга и NSFW контента.',
        modelUrl: DEFAULT_MODEL_URL,
        threshold: 0.58,
        defaultConfig: { threshold: 0.6, language: 'auto' },
        cacheTtlMs: 15 * 60 * 1000,
        requireForPremium: true,
    });
} catch (error) {
    if (process.env.NODE_ENV !== 'production') {
        console.warn('Не удалось зарегистрировать локальный ML-детектор повторно:', error);
    }
}
