type ExpoSecureStoreModule = {
    getItemAsync(key: string): Promise<string | null>;
    setItemAsync(key: string, value: string, options?: { keychainService?: string; accessible?: string }): Promise<void>;
    deleteItemAsync(key: string): Promise<void>;
};

const isBrowser = typeof window !== 'undefined';
const isTauriRuntime = isBrowser && typeof (window as any).__TAURI__?.invoke === 'function';
const isReactNative = typeof navigator !== 'undefined' && navigator.product === 'ReactNative';

let expoSecureStorePromise: Promise<ExpoSecureStoreModule | null> | null = null;

const loadExpoSecureStore = async (): Promise<ExpoSecureStoreModule | null> => {
    if (!isReactNative) return null;
    if (!expoSecureStorePromise) {
        expoSecureStorePromise = import('expo-secure-store')
            .then((module: any) => module as ExpoSecureStoreModule)
            .catch(() => null);
    }
    return expoSecureStorePromise;
};

const callTauriSecureStore = async <T = unknown>(command: string, args: Record<string, unknown>): Promise<T> => {
    if (!isTauriRuntime) {
        throw new Error('Secure storage is only available in Tauri runtime');
    }
    return (window as any).__TAURI__.invoke(`plugin:secure-storage|${command}`, args) as Promise<T>;
};

const localFallbackGet = (key: string): string | null => {
    try {
        return localStorage.getItem(key);
    } catch (error) {
        console.warn('Secure secrets fallback read failed', error);
        return null;
    }
};

const localFallbackSet = (key: string, value: string): void => {
    try {
        localStorage.setItem(key, value);
    } catch (error) {
        console.warn('Secure secrets fallback write failed', error);
    }
};

const localFallbackRemove = (key: string): void => {
    try {
        localStorage.removeItem(key);
    } catch (error) {
        console.warn('Secure secrets fallback delete failed', error);
    }
};

export const secureSecretsStore = {
    async get(key: string): Promise<string | null> {
        if (isTauriRuntime) {
            return callTauriSecureStore<string | null>('get', { key });
        }
        const expo = await loadExpoSecureStore();
        if (expo) {
            return expo.getItemAsync(key);
        }
        return localFallbackGet(key);
    },

    async set(key: string, value: string): Promise<void> {
        if (isTauriRuntime) {
            await callTauriSecureStore('set', { key, value });
            return;
        }
        const expo = await loadExpoSecureStore();
        if (expo) {
            await expo.setItemAsync(key, value, { keychainService: 'matrix-messenger-botbridge' });
            return;
        }
        localFallbackSet(key, value);
    },

    async remove(key: string): Promise<void> {
        if (isTauriRuntime) {
            await callTauriSecureStore('delete', { key });
            return;
        }
        const expo = await loadExpoSecureStore();
        if (expo) {
            await expo.deleteItemAsync(key);
            return;
        }
        localFallbackRemove(key);
    },
};

export type SecureSecretsStore = typeof secureSecretsStore;
