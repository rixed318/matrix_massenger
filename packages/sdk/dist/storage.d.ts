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
export declare class MemoryStorageAdapter implements PluginStorageAdapter {
    private readonly store;
    private bucket;
    get(pluginId: string, key: string): Promise<unknown | undefined>;
    set(pluginId: string, key: string, value: unknown): Promise<void>;
    delete(pluginId: string, key: string): Promise<void>;
    list(pluginId: string): Promise<string[]>;
    clear(pluginId: string): Promise<void>;
}
export declare const createMemoryStorageAdapter: () => MemoryStorageAdapter;
export declare const createBrowserStorageAdapter: (namespace: string, logger?: PluginLogger) => PluginStorageAdapter;
export declare const createPluginStorage: (adapter: PluginStorageAdapter, pluginId: string) => PluginStorage;
//# sourceMappingURL=storage.d.ts.map