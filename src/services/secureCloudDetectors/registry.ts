import type {
    SecureCloudDetector,
    SecureCloudDetectorType,
    SecureCloudDetectorModel,
    SecureCloudDetectorLanguageConfig,
    SecureCloudDetectorCapabilities,
} from '../secureCloudService';

interface DetectorRecord {
    detector: SecureCloudDetector;
    type: SecureCloudDetectorType;
    models: SecureCloudDetectorModel[];
    languageSettings: SecureCloudDetectorLanguageConfig[];
    capabilities?: SecureCloudDetectorCapabilities;
}

const registry = new Map<string, DetectorRecord>();

export interface RegisterDetectorOptions {
    detector: SecureCloudDetector;
    type: SecureCloudDetectorType;
    models?: SecureCloudDetectorModel[];
    languageSettings?: SecureCloudDetectorLanguageConfig[];
    capabilities?: SecureCloudDetectorCapabilities;
}

export const registerDetector = (options: RegisterDetectorOptions): SecureCloudDetector => {
    const { detector, type } = options;
    const models = options.models ?? detector.models ?? [];
    const languageSettings = options.languageSettings ?? detector.languageOverrides ?? [];
    const capabilities = options.capabilities ?? detector.capabilities;

    const enriched = Object.assign(detector, {
        type,
        models,
        languageOverrides: languageSettings,
        capabilities: { ...detector.capabilities, ...capabilities },
    });

    registry.set(detector.id, {
        detector: enriched,
        type,
        models,
        languageSettings,
        capabilities: enriched.capabilities,
    });

    return enriched;
};

export const unregisterDetector = (id: string): void => {
    registry.delete(id);
};

export const clearDetectorRegistry = (): void => {
    registry.clear();
};

export const getRegisteredDetectors = (): SecureCloudDetector[] => {
    return Array.from(registry.values()).map(record => record.detector);
};

export const getRegisteredDetectorRecord = (id: string): DetectorRecord | undefined => {
    return registry.get(id);
};
