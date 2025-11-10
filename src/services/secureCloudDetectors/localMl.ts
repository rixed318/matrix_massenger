import type {
    SecureCloudDetector,
    SecureCloudDetectorConfig,
    SecureCloudDetectorResult,
    SecureCloudDetectorStatus,
    SecureCloudProfile,
    SecureCloudDetectorModel,
    SecureCloudDetectorLanguageConfig,
    SecureCloudDetectorCapabilities,
} from '../secureCloudService';
import { registerDetector } from './registry';
import { createProcessingQueue, AsyncProcessingQueue } from './asyncQueue';

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

export interface LocalMlAttachment {
    id: string;
    name?: string;
    mimeType?: string;
    size?: number;
    url?: string;
    hashes: Record<string, string>;
    ocrHint?: string;
}

export interface LocalMlAttachmentSupportOptions {
    enableOcr?: boolean;
    ocrLanguages?: LocalMlLanguage[];
    knownBadHashes?: string[];
    hashAlgorithm?: string;
}

export type LocalMlCacheKeyInput = {
    body: string;
    roomId?: string;
    attachments?: LocalMlAttachment[];
};

export interface LocalMlDetectorOptions {
    id: string;
    label: string;
    description?: string;
    loader?: () => Promise<LocalMlModel>;
    modelUrl?: string;
    threshold?: number;
    cacheTtlMs?: number;
    cacheKey?: (input: LocalMlCacheKeyInput) => string | null;
    riskAdjust?: (score: number) => number;
    defaultConfig?: SecureCloudDetectorConfig;
    requireForPremium?: boolean;
    models?: SecureCloudDetectorModel[];
    defaultModelId?: string;
    modelLoaders?: Record<string, () => Promise<LocalMlModel>>;
    attachmentSupport?: LocalMlAttachmentSupportOptions;
    queueConcurrency?: number;
    languageOverrides?: SecureCloudDetectorLanguageConfig[];
    capabilities?: SecureCloudDetectorCapabilities;
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
    modelId?: string;
    attachmentsSignature?: string;
}

interface LocalDetectorRecord {
    detector: SecureCloudDetector;
    loaders: Map<string, () => Promise<LocalMlModel>>;
    modelPromises: Map<string, Promise<LocalMlModel>>;
    status: SecureCloudDetectorStatus;
    cache: Map<string, CachedScore>;
    threshold: number;
    cacheTtlMs?: number;
    cacheKey?: (input: LocalMlCacheKeyInput) => string | null;
    riskAdjust?: (score: number) => number;
    defaultConfig?: SecureCloudDetectorConfig;
    requireForPremium?: boolean;
    defaultModelId: string;
    modelsMetadata: SecureCloudDetectorModel[];
    languageOverrides?: SecureCloudDetectorLanguageConfig[];
    attachmentSupport?: LocalMlAttachmentSupportOptions;
    queue: AsyncProcessingQueue;
    capabilities: SecureCloudDetectorCapabilities;
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

const normaliseHashes = (input: unknown): Record<string, string> => {
    if (!input || typeof input !== 'object') {
        return {};
    }
    const result: Record<string, string> = {};
    for (const [algo, value] of Object.entries(input as Record<string, unknown>)) {
        if (typeof value === 'string' && value) {
            result[algo.toLowerCase()] = value.toLowerCase();
        }
    }
    return result;
};

const toAttachment = (raw: any, fallbackId: string): LocalMlAttachment => {
    const data = (typeof raw === 'object' && raw) ? raw : {};
    const info = (typeof data.info === 'object' && data.info) ? data.info : {};
    const id = typeof data.id === 'string' && data.id
        ? data.id
        : typeof data.url === 'string' && data.url
            ? data.url
            : fallbackId;
    const name = typeof data.name === 'string'
        ? data.name
        : typeof data.body === 'string'
            ? data.body
            : typeof info.body === 'string'
                ? info.body
                : undefined;
    const mimeType = typeof data.mimeType === 'string'
        ? data.mimeType
        : typeof data.mimetype === 'string'
            ? data.mimetype
            : typeof info.mimetype === 'string'
                ? info.mimetype
                : undefined;
    const size = typeof data.size === 'number'
        ? data.size
        : typeof data.filesize === 'number'
            ? data.filesize
            : typeof info.size === 'number'
                ? info.size
                : undefined;
    const url = typeof data.url === 'string'
        ? data.url
        : typeof data.uri === 'string'
            ? data.uri
            : typeof info.url === 'string'
                ? info.url
                : undefined;
    const ocrHint = typeof data.ocrHint === 'string'
        ? data.ocrHint
        : typeof data.ocr === 'string'
            ? data.ocr
            : typeof info.ocr === 'string'
                ? info.ocr
                : undefined;
    const hashes = {
        ...normaliseHashes(data.hashes),
        ...normaliseHashes(info.hashes),
        ...normaliseHashes(data.digest),
        ...normaliseHashes(data.hash),
    };
    return {
        id,
        name,
        mimeType,
        size,
        url,
        hashes,
        ocrHint: typeof ocrHint === 'string' ? ocrHint : undefined,
    } satisfies LocalMlAttachment;
};

const extractAttachments = (content: Record<string, unknown>): LocalMlAttachment[] => {
    const attachments: LocalMlAttachment[] = [];
    const pushAttachment = (raw: any, fallback: string) => {
        const attachment = toAttachment(raw, fallback);
        if (!attachment.hashes || Object.keys(attachment.hashes).length === 0) {
            attachment.hashes = {};
        }
        attachments.push(attachment);
    };

    const info = (typeof content['info'] === 'object' && content['info']) ? content['info'] as Record<string, unknown> : {};

    if (content['file'] || content['url']) {
        pushAttachment(
            {
                ...(content['file'] as Record<string, unknown> | undefined),
                url: content['url'],
                body: content['body'],
                info,
            },
            'event-file',
        );
    }

    const attachmentsField = content['attachments'];
    if (Array.isArray(attachmentsField)) {
        attachmentsField.forEach((raw, index) => pushAttachment(raw, `event-attachment-${index}`));
    }

    const secureCloudMeta = content['org.matrix.secure_cloud'];
    if (secureCloudMeta && typeof secureCloudMeta === 'object') {
        const meta = secureCloudMeta as Record<string, unknown>;
        if (Array.isArray(meta['attachments'])) {
            meta['attachments'].forEach((raw, index) => pushAttachment(raw, `secure-cloud-meta-${index}`));
        }
    }

    return attachments;
};

const buildAttachmentSignature = (attachments: LocalMlAttachment[]): string => {
    if (!attachments || attachments.length === 0) {
        return '';
    }
    return attachments
        .map(attachment => {
            const sortedHashes = Object.entries(attachment.hashes || {})
                .map(([algo, value]) => `${algo}:${value}`)
                .sort()
                .join(',');
            return `${attachment.id}:${sortedHashes}`;
        })
        .sort()
        .join('|');
};

const readMessageBody = (event: any): { body: string; attachments: LocalMlAttachment[] } => {
    const content = (event?.getContent?.() as Record<string, unknown>) || {};
    const body = typeof content['body'] === 'string' ? content['body'] : '';
    const attachments = extractAttachments(content);
    return { body, attachments };
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

const loadModel = async (record: LocalDetectorRecord, modelId: string): Promise<LocalMlModel> => {
    const targetId = record.loaders.has(modelId) ? modelId : record.defaultModelId;
    const loader = record.loaders.get(targetId);
    if (!loader) {
        throw new Error(`Не удалось найти модель ${modelId} для детектора ${record.detector.id}`);
    }
    const existing = record.modelPromises.get(targetId);
    if (existing) {
        return existing;
    }
    record.status = { state: 'loading', detail: `Загружаем модель ${targetId}` };
    const promise = loader().then(model => {
        record.status = { state: 'ready', detail: `Модель ${targetId} готова` };
        return model;
    }).catch(error => {
        record.status = {
            state: 'error',
            detail: error instanceof Error
                ? error.message
                : `Не удалось инициализировать модель ${targetId}`,
        };
        record.modelPromises.delete(targetId);
        throw error;
    });
    record.modelPromises.set(targetId, promise);
    return promise;
};

const getCachedScore = (record: LocalDetectorRecord, key: string, modelId: string): CachedScore | null => {
    const cached = record.cache.get(key);
    if (!cached) {
        return null;
    }
    if (cached.modelId && cached.modelId !== modelId) {
        return null;
    }
    if (record.cacheTtlMs && cached.expiresAt && cached.expiresAt < Date.now()) {
        record.cache.delete(key);
        return null;
    }
    return cached;
};

const rememberScore = (
    record: LocalDetectorRecord,
    key: string,
    modelId: string,
    prediction: LocalMlPrediction,
    attachmentSignature: string,
): void => {
    const entry: CachedScore = {
        value: prediction.riskScore,
        label: prediction.topCategory,
        keywords: prediction.matchedKeywords.slice(0, 8),
        modelId,
        attachmentsSignature: attachmentSignature,
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
    const baseThreshold = typeof configThreshold === 'number'
        ? clampScore(configThreshold)
        : typeof defaultThreshold === 'number'
            ? clampScore(defaultThreshold)
            : record.threshold;
    const sensitivity = resolveSensitivity(record, profile);
    return applySensitivityToThreshold(baseThreshold, sensitivity);
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

const normaliseSensitivityInput = (value: unknown): number | undefined => {
    if (value == null) {
        return undefined;
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
        return Math.min(1, Math.max(0, value));
    }
    if (typeof value === 'string') {
        const key = value.toLowerCase();
        if (key === 'low') {
            return 0.2;
        }
        if (key === 'medium') {
            return 0.5;
        }
        if (key === 'high') {
            return 0.85;
        }
        const parsed = Number.parseFloat(key);
        if (Number.isFinite(parsed)) {
            return Math.min(1, Math.max(0, parsed));
        }
    }
    return undefined;
};

const resolveSensitivity = (record: LocalDetectorRecord, profile: SecureCloudProfile): number | undefined => {
    const detectorState = profile.detectors?.find(state => state.detector.id === record.detector.id);
    const config = detectorState?.config ?? {};
    const user = normaliseSensitivityInput((config as any).userSensitivity ?? profile.userSensitivity);
    const org = normaliseSensitivityInput((config as any).organizationSensitivity ?? profile.organizationSensitivity);
    if (user == null && org == null) {
        const combined = normaliseSensitivityInput((config as any).sensitivity);
        if (combined != null) {
            return combined;
        }
        return undefined;
    }
    return Math.min(1, Math.max(0, ((user ?? 0.5) + (org ?? user ?? 0.5)) / 2));
};

const applySensitivityToThreshold = (threshold: number, sensitivity?: number): number => {
    if (sensitivity == null) {
        return threshold;
    }
    const adjustment = (0.5 - sensitivity) * 0.25;
    return clampScore(threshold + adjustment);
};

const resolveModelSelection = (
    record: LocalDetectorRecord,
    profile: SecureCloudProfile,
): { modelId: string; override?: string; unsupported?: string } => {
    const detectorState = profile.detectors?.find(state => state.detector.id === record.detector.id);
    const config = detectorState?.config ?? {};
    const configModel = typeof (config as any).modelId === 'string' ? (config as any).modelId : undefined;
    const profileModel = profile.detectorModels?.[record.detector.id];
    const candidate = configModel ?? profileModel;
    if (candidate && record.loaders.has(candidate)) {
        return { modelId: candidate, override: candidate };
    }
    if (candidate && !record.loaders.has(candidate)) {
        return { modelId: record.defaultModelId, unsupported: candidate };
    }
    return { modelId: record.defaultModelId };
};

const extractAttachmentSignals = async (
    record: LocalDetectorRecord,
    attachments: LocalMlAttachment[],
    language: LocalMlLanguage,
): Promise<{ texts: string[]; hashHits: string[] }> => {
    if (!record.attachmentSupport || attachments.length === 0) {
        return { texts: [], hashHits: [] };
    }

    const support = record.attachmentSupport;
    const texts: string[] = [];
    const hashHits: string[] = [];

    if (support.knownBadHashes?.length) {
        const knownHashes = new Set(support.knownBadHashes.map(hash => hash.toLowerCase()));
        for (const attachment of attachments) {
            const hashes = Object.values(attachment.hashes ?? {});
            if (hashes.some(hash => knownHashes.has(hash.toLowerCase()))) {
                hashHits.push(attachment.id);
            }
        }
    }

    if (support.enableOcr) {
        const languagePreference = support.ocrLanguages?.includes(language)
            ? language
            : support.ocrLanguages?.[0] ?? language;
        for (const attachment of attachments) {
            if (attachment.ocrHint && attachment.ocrHint.trim()) {
                const hint = attachment.ocrHint.trim();
                texts.push(`[${languagePreference}] ${hint}`);
            }
        }
    }

    return { texts, hashHits };
};

const defaultCacheKey = ({ body, roomId, attachments }: LocalMlCacheKeyInput): string | null => {
    const trimmed = body.trim();
    if (!trimmed) {
        return null;
    }
    const normalised = trimmed.toLowerCase().replace(/\s+/g, ' ').slice(0, 256);
    const attachmentSignature = buildAttachmentSignature(attachments ?? []);
    return `${roomId ?? 'global'}:${normalised}:${attachmentSignature}`;
};

export const registerLocalMlDetector = (options: LocalMlDetectorOptions): SecureCloudDetector => {
    if (registry.has(options.id)) {
        throw new Error(`Local ML detector with id "${options.id}" already registered.`);
    }

    const baseLoader = options.loader ?? (options.modelUrl
        ? createModelLoader({ modelUrl: options.modelUrl })
        : null);

    const metadata: SecureCloudDetectorModel[] = Array.isArray(options.models) && options.models.length > 0
        ? options.models
        : [{
            id: options.defaultModelId ?? `${options.id}-default`,
            provider: options.modelUrl ? 'onnx' : 'transformer',
            label: options.label,
            description: options.description,
            path: options.modelUrl,
            languages: ['ru', 'en'],
        }];

    const loaders = new Map<string, () => Promise<LocalMlModel>>();
    for (const variant of metadata) {
        const explicitLoader = options.modelLoaders?.[variant.id];
        if (explicitLoader) {
            loaders.set(variant.id, explicitLoader);
            continue;
        }
        if (!loaders.size && baseLoader) {
            loaders.set(variant.id, baseLoader);
        }
    }

    if (loaders.size === 0 && baseLoader) {
        loaders.set(metadata[0].id, baseLoader);
    }

    if (loaders.size === 0) {
        throw new Error(`Local ML detector ${options.id} must provide at least one model loader.`);
    }

    const defaultModelId = (options.defaultModelId && loaders.has(options.defaultModelId))
        ? options.defaultModelId
        : loaders.keys().next().value as string;

    const threshold = typeof options.threshold === 'number' ? clampScore(options.threshold) : DEFAULT_THRESHOLD;
    const defaultConfig: SecureCloudDetectorConfig | undefined = options.defaultConfig
        ? { ...options.defaultConfig }
        : { threshold, language: 'auto' };

    const concurrency = options.queueConcurrency
        ?? (typeof navigator !== 'undefined' && typeof navigator.hardwareConcurrency === 'number'
            ? Math.max(1, Math.min(4, Math.floor(navigator.hardwareConcurrency / 2)))
            : 1);

    const capabilities: SecureCloudDetectorCapabilities = {
        handlesAttachments: Boolean(options.attachmentSupport),
        offlineSupport: loaders.size > 0,
        requiresPremium: Boolean(options.requireForPremium),
        ...options.capabilities,
    };

    const record: LocalDetectorRecord = {
        detector: undefined as unknown as SecureCloudDetector,
        loaders,
        modelPromises: new Map(),
        status: { state: 'idle', detail: 'Ожидает запуска' },
        cache: new Map(),
        threshold,
        cacheTtlMs: options.cacheTtlMs ?? 10 * 60 * 1000,
        cacheKey: options.cacheKey ?? defaultCacheKey,
        riskAdjust: options.riskAdjust,
        defaultConfig,
        requireForPremium: Boolean(options.requireForPremium),
        defaultModelId,
        modelsMetadata: metadata,
        languageOverrides: options.languageOverrides,
        attachmentSupport: options.attachmentSupport,
        queue: createProcessingQueue(concurrency),
        capabilities,
    };

    const detector: SecureCloudDetector = {
        id: options.id,
        displayName: options.label,
        description: options.description,
        required: false,
        defaultConfig,
        requireForPremium: record.requireForPremium,
        type: 'ml',
        models: metadata,
        languageOverrides: options.languageOverrides,
        capabilities,
        warmup: () => loadModel(record, record.defaultModelId).then(() => undefined).catch(() => undefined),
        score: async (event, room, profile): Promise<SecureCloudDetectorResult | null> => {
            const { body, attachments } = readMessageBody(event);
            if (!body.trim() && attachments.length === 0) {
                return null;
            }

            const selection = resolveModelSelection(record, profile);
            const cacheKeyInput: LocalMlCacheKeyInput = { body, roomId: room?.roomId, attachments };
            const key = record.cacheKey ? record.cacheKey(cacheKeyInput) : null;
            const thresholdValue = resolveThreshold(record, profile);

            if (key) {
                const cached = getCachedScore(record, key, selection.modelId);
                if (cached) {
                    if (cached.value < thresholdValue) {
                        return null;
                    }
                    const cacheReason = cached.label ? `ml_cache_hit:${cached.label}` : 'ml_cache_hit';
                    const reasons = [cacheReason];
                    if (cached.modelId && cached.modelId !== record.defaultModelId) {
                        reasons.push(`ml_model:${cached.modelId}`);
                    }
                    return {
                        riskScore: cached.value,
                        reasons,
                        keywords: cached.keywords ?? [],
                    } satisfies SecureCloudDetectorResult;
                }
            }

            const languagePreference = resolveLanguagePreference(record, profile);
            const resolvedLanguage = normaliseLanguage(languagePreference ?? 'auto', body);

            const queueResult = await record.queue.enqueue(async () => {
                const model = await loadModel(record, selection.modelId);
                const signals = await extractAttachmentSignals(record, attachments, resolvedLanguage);
                const enrichedBody = [body, ...signals.texts].filter(Boolean).join('\n\n').trim() || body;
                const prediction = await model.predict({
                    body: enrichedBody,
                    roomId: room?.roomId,
                    language: languagePreference,
                });
                return { prediction, signals, enrichedBody };
            }, {
                cacheKey: key ? `${selection.modelId}:${key}` : undefined,
                cacheTtlMs: record.cacheTtlMs,
            });

            let adjustedScore = queueResult.prediction.riskScore;
            if (queueResult.signals.hashHits.length > 0) {
                adjustedScore = clampScore(adjustedScore + 0.25);
            }
            if (queueResult.signals.texts.length > 0) {
                adjustedScore = clampScore(adjustedScore + 0.05);
            }
            if (record.riskAdjust) {
                adjustedScore = clampScore(record.riskAdjust(adjustedScore));
            }

            const sensitivity = resolveSensitivity(record, profile);
            if (sensitivity != null) {
                adjustedScore = clampScore(adjustedScore + (sensitivity - 0.5) * 0.1);
            }

            const attachmentSignature = buildAttachmentSignature(attachments);
            if (key) {
                rememberScore(record, key, selection.modelId, { ...queueResult.prediction, riskScore: adjustedScore }, attachmentSignature);
            }

            if (adjustedScore < thresholdValue) {
                return null;
            }

            const reasons = [`ml_${queueResult.prediction.topCategory}`];
            if (adjustedScore >= 0.85) {
                reasons.push('ml_high_confidence');
            }
            if (queueResult.signals.hashHits.length > 0) {
                reasons.push('ml_attachment_hash');
            }
            if (queueResult.signals.texts.length > 0) {
                reasons.push('ml_attachment_ocr');
            }
            if (selection.override) {
                reasons.push(`ml_model_override:${selection.override}`);
            }
            if (selection.unsupported) {
                reasons.push(`ml_model_fallback:${selection.unsupported}`);
            }
            reasons.push(`ml_model:${selection.modelId}`);

            const keywords = queueResult.prediction.matchedKeywords.slice(0, 16);
            for (const hashHit of queueResult.signals.hashHits) {
                keywords.push(`attachment#${hashHit}`);
            }

            return {
                riskScore: adjustedScore,
                reasons,
                keywords,
            } satisfies SecureCloudDetectorResult;
        },
        getStatus: () => record.status,
    };

    const enrichedDetector = registerDetector({
        detector,
        type: 'ml',
        models: metadata,
        languageSettings: options.languageOverrides,
        capabilities,
    });

    record.detector = enrichedDetector;
    registry.set(options.id, record);
    return enrichedDetector;
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

export const prefetchLocalMlDetector = async (id: string, modelId?: string): Promise<void> => {
    const record = registry.get(id);
    if (!record) {
        return;
    }
    try {
        await loadModel(record, modelId ?? record.defaultModelId);
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
        defaultModelId: 'lite-json',
        models: [
            {
                id: 'lite-json',
                provider: 'onnx',
                label: 'Lite JSON (встроенная)',
                description: 'Лёгкая логистическая модель с признаками по ключевым словам.',
                path: DEFAULT_MODEL_URL,
                languages: ['ru', 'en'],
                metadata: { sizeKb: 48 },
            },
            {
                id: 'transformer-small',
                provider: 'transformer',
                label: 'Secure Cloud Transformer (локально)',
                description: 'Малый трансформер для офлайн-анализа (устанавливается отдельно).',
                path: 'local://secure-cloud/transformer-small',
                languages: ['en'],
                metadata: { memoryMb: 512 },
            },
            {
                id: 'securecloud-api',
                provider: 'external',
                label: 'Secure Cloud API (внешний)',
                description: 'Облачная модель высокой точности через HTTPS API.',
                endpoint: 'https://secure-cloud.api/v1/detect',
                parameters: { version: '2024-05' },
                languages: ['ru', 'en'],
            },
        ],
        attachmentSupport: {
            enableOcr: true,
            ocrLanguages: ['ru', 'en'],
            knownBadHashes: [],
        },
        languageOverrides: [
            { language: 'ru', threshold: 0.55, modelId: 'lite-json' },
            { language: 'en', threshold: 0.6, modelId: 'lite-json' },
        ],
        capabilities: { handlesAttachments: true, offlineSupport: true, requiresPremium: true },
    });
} catch (error) {
    if (process.env.NODE_ENV !== 'production') {
        console.warn('Не удалось зарегистрировать локальный ML-детектор повторно:', error);
    }
}
