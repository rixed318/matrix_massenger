import { type PluginLogger } from './types';

export interface PluginStorageAdapter {
  get(pluginId: string, key: string): Promise<unknown> | unknown;
  set(pluginId: string, key: string, value: unknown): Promise<void> | void;
  delete(pluginId: string, key: string): Promise<void> | void;
  list(pluginId: string): Promise<string[]> | string[];
  clear?(pluginId: string): Promise<void> | void;
}

export interface PluginStorage {
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<void>;
  keys(): Promise<string[]>;
  clear(): Promise<void>;
}

const toPromise = async <T>(value: Promise<T> | T): Promise<T> => value;

export class MemoryStorageAdapter implements PluginStorageAdapter {
  private readonly store = new Map<string, Map<string, unknown>>();

  private bucket(pluginId: string): Map<string, unknown> {
    let bucket = this.store.get(pluginId);
    if (!bucket) {
      bucket = new Map<string, unknown>();
      this.store.set(pluginId, bucket);
    }
    return bucket;
  }

  async get(pluginId: string, key: string): Promise<unknown | undefined> {
    return this.bucket(pluginId).get(key);
  }

  async set(pluginId: string, key: string, value: unknown): Promise<void> {
    this.bucket(pluginId).set(key, value);
  }

  async delete(pluginId: string, key: string): Promise<void> {
    this.bucket(pluginId).delete(key);
  }

  async list(pluginId: string): Promise<string[]> {
    return Array.from(this.bucket(pluginId).keys());
  }

  async clear(pluginId: string): Promise<void> {
    this.store.delete(pluginId);
  }
}

export const createMemoryStorageAdapter = (): MemoryStorageAdapter => new MemoryStorageAdapter();

const safeParse = (value: string | null): Record<string, unknown> => {
  if (!value) {
    return {};
  }
  try {
    const parsed = JSON.parse(value);
    return typeof parsed === 'object' && parsed ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
};

const safeStringify = (value: unknown): string => {
  try {
    return JSON.stringify(value ?? null);
  } catch {
    return 'null';
  }
};

export const createBrowserStorageAdapter = (
  namespace: string,
  logger?: PluginLogger,
): PluginStorageAdapter => {
  const resolvedNamespace = namespace || 'matrix-messenger';
  const log = logger ?? console;

  const readBucket = (pluginId: string): Record<string, unknown> => {
    try {
      if (typeof window === 'undefined' || !window.localStorage) {
        return {};
      }
      const key = `${resolvedNamespace}:${pluginId}`;
      const raw = window.localStorage.getItem(key);
      return safeParse(raw);
    } catch (err) {
      log.warn?.('[plugin-storage] read failed', err);
      return {};
    }
  };

  const writeBucket = (pluginId: string, bucket: Record<string, unknown>) => {
    try {
      if (typeof window === 'undefined' || !window.localStorage) {
        return;
      }
      const key = `${resolvedNamespace}:${pluginId}`;
      window.localStorage.setItem(key, safeStringify(bucket));
    } catch (err) {
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
      } catch (err) {
        log.warn?.('[plugin-storage] clear failed', err);
      }
    },
  };
};

export const createPluginStorage = (
  adapter: PluginStorageAdapter,
  pluginId: string,
): PluginStorage => ({
  async get<T>(key: string): Promise<T | undefined> {
    const value = await toPromise(adapter.get(pluginId, key));
    return (value === undefined ? undefined : (value as T));
  },
  async set<T>(key: string, value: T): Promise<void> {
    await toPromise(adapter.set(pluginId, key, value));
  },
  async delete(key: string): Promise<void> {
    await toPromise(adapter.delete(pluginId, key));
  },
  async keys(): Promise<string[]> {
    const keys = await toPromise(adapter.list(pluginId));
    return Array.isArray(keys) ? keys : [];
  },
  async clear(): Promise<void> {
    if (adapter.clear) {
      await toPromise(adapter.clear(pluginId));
      return;
    }
    const keys = await toPromise(adapter.list(pluginId));
    await Promise.all((Array.isArray(keys) ? keys : []).map(key => toPromise(adapter.delete(pluginId, key))));
  },
});
