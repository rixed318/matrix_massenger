const toPromise = async (value) => value;
export class MemoryStorageAdapter {
    constructor() {
        this.store = new Map();
    }
    bucket(pluginId) {
        let bucket = this.store.get(pluginId);
        if (!bucket) {
            bucket = new Map();
            this.store.set(pluginId, bucket);
        }
        return bucket;
    }
    async get(pluginId, key) {
        return this.bucket(pluginId).get(key);
    }
    async set(pluginId, key, value) {
        this.bucket(pluginId).set(key, value);
    }
    async delete(pluginId, key) {
        this.bucket(pluginId).delete(key);
    }
    async list(pluginId) {
        return Array.from(this.bucket(pluginId).keys());
    }
    async clear(pluginId) {
        this.store.delete(pluginId);
    }
}
export const createMemoryStorageAdapter = () => new MemoryStorageAdapter();
const safeParse = (value) => {
    if (!value) {
        return {};
    }
    try {
        const parsed = JSON.parse(value);
        return typeof parsed === 'object' && parsed ? parsed : {};
    }
    catch {
        return {};
    }
};
const safeStringify = (value) => {
    try {
        return JSON.stringify(value ?? null);
    }
    catch {
        return 'null';
    }
};
export const createBrowserStorageAdapter = (namespace, logger) => {
    const resolvedNamespace = namespace || 'matrix-messenger';
    const log = logger ?? console;
    const readBucket = (pluginId) => {
        try {
            if (typeof window === 'undefined' || !window.localStorage) {
                return {};
            }
            const key = `${resolvedNamespace}:${pluginId}`;
            const raw = window.localStorage.getItem(key);
            return safeParse(raw);
        }
        catch (err) {
            log.warn?.('[plugin-storage] read failed', err);
            return {};
        }
    };
    const writeBucket = (pluginId, bucket) => {
        try {
            if (typeof window === 'undefined' || !window.localStorage) {
                return;
            }
            const key = `${resolvedNamespace}:${pluginId}`;
            window.localStorage.setItem(key, safeStringify(bucket));
        }
        catch (err) {
            log.warn?.('[plugin-storage] write failed', err);
        }
    };
    return {
        async get(pluginId, key) {
            const bucket = readBucket(pluginId);
            return bucket[key];
        },
        async set(pluginId, key, value) {
            const bucket = readBucket(pluginId);
            bucket[key] = value;
            writeBucket(pluginId, bucket);
        },
        async delete(pluginId, key) {
            const bucket = readBucket(pluginId);
            delete bucket[key];
            writeBucket(pluginId, bucket);
        },
        async list(pluginId) {
            const bucket = readBucket(pluginId);
            return Object.keys(bucket);
        },
        async clear(pluginId) {
            try {
                if (typeof window === 'undefined' || !window.localStorage) {
                    return;
                }
                const key = `${resolvedNamespace}:${pluginId}`;
                window.localStorage.removeItem(key);
            }
            catch (err) {
                log.warn?.('[plugin-storage] clear failed', err);
            }
        },
    };
};
export const createPluginStorage = (adapter, pluginId) => ({
    async get(key) {
        const value = await toPromise(adapter.get(pluginId, key));
        return (value === undefined ? undefined : value);
    },
    async set(key, value) {
        await toPromise(adapter.set(pluginId, key, value));
    },
    async delete(key) {
        await toPromise(adapter.delete(pluginId, key));
    },
    async keys() {
        const keys = await toPromise(adapter.list(pluginId));
        return Array.isArray(keys) ? keys : [];
    },
    async clear() {
        if (adapter.clear) {
            await toPromise(adapter.clear(pluginId));
            return;
        }
        const keys = await toPromise(adapter.list(pluginId));
        await Promise.all((Array.isArray(keys) ? keys : []).map(key => toPromise(adapter.delete(pluginId, key))));
    },
});
//# sourceMappingURL=storage.js.map