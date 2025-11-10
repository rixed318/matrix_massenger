declare module 'expo-secure-store' {
    export function getItemAsync(key: string): Promise<string | null>;
    export function setItemAsync(key: string, value: string, options?: { keychainService?: string; accessible?: string }): Promise<void>;
    export function deleteItemAsync(key: string): Promise<void>;
}
