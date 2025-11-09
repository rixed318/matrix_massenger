import { isPermissionGranted, requestPermission, sendNotification as tauriSendNotification } from '@tauri-apps/plugin-notification';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { listen } from '@tauri-apps/api/event';
import { RoomNotificationMode } from '../types';

const isTauriEnvironment = () =>
    typeof window !== 'undefined' && typeof (window as any).__TAURI_INTERNALS__ !== 'undefined';

let permissionGranted: boolean | null = null;
let listenersInitialized = false;
let roomNotificationPreferences: Record<string, RoomNotificationMode> = {};

const base64ToUint8Array = (base64: string): Uint8Array => {
    const padding = '='.repeat((4 - (base64.length % 4)) % 4);
    const safe = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
    if (typeof window !== 'undefined' && typeof window.atob === 'function') {
        const raw = window.atob(safe);
        const output = new Uint8Array(raw.length);
        for (let i = 0; i < raw.length; i += 1) {
            output[i] = raw.charCodeAt(i);
        }
        return output;
    }
    const buffer = (globalThis as any).Buffer?.from(safe, 'base64');
    if (buffer) {
        return new Uint8Array(buffer);
    }
    const raw = globalThis.atob(safe);
    const output = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i += 1) {
        output[i] = raw.charCodeAt(i);
    }
    return output;
};

const resolveVapidKey = (explicit?: string): Uint8Array | undefined => {
    const key = explicit || (import.meta as any)?.env?.VITE_WEB_PUSH_VAPID_PUBLIC_KEY;
    if (!key) {
        return undefined;
    }
    try {
        return base64ToUint8Array(key);
    } catch (error) {
        console.error('Failed to decode VAPID public key', error);
        return undefined;
    }
};

const postPreferencesToServiceWorker = async (preferences: Record<string, RoomNotificationMode>) => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
        return;
    }
    try {
        const registration = await navigator.serviceWorker.ready;
        registration.active?.postMessage({
            type: 'ROOM_NOTIFICATION_PREFERENCES',
            preferences,
        });
        navigator.serviceWorker.controller?.postMessage?.({
            type: 'ROOM_NOTIFICATION_PREFERENCES',
            preferences,
        });
    } catch (error) {
        console.warn('Failed to sync notification preferences with service worker', error);
    }
};

const shouldSuppressNotification = (options: SendNotificationOptions): boolean => {
    if (!options.roomId) {
        return false;
    }
    const preference = roomNotificationPreferences[options.roomId];
    if (!preference || preference === 'all') {
        return false;
    }
    if (preference === 'mute') {
        return true;
    }
    return !options.isMention;
};

export interface SendNotificationOptions {
    roomId?: string;
    isMention?: boolean;
}

export const setRoomNotificationPreferences = (preferences: Record<string, RoomNotificationMode>): void => {
    roomNotificationPreferences = { ...preferences };
    void postPreferencesToServiceWorker(roomNotificationPreferences);
};

export const setRoomNotificationPreference = (roomId: string, mode: RoomNotificationMode): void => {
    if (!roomId) {
        return;
    }
    roomNotificationPreferences = {
        ...roomNotificationPreferences,
        [roomId]: mode,
    };
    void postPreferencesToServiceWorker(roomNotificationPreferences);
};

export const getRoomNotificationPreference = (roomId: string): RoomNotificationMode | undefined =>
    roomNotificationPreferences[roomId];

export const getRoomNotificationPreferences = (): Record<string, RoomNotificationMode> => ({
    ...roomNotificationPreferences,
});

export const isWebPushSupported = (): boolean =>
    typeof window !== 'undefined'
    && 'serviceWorker' in navigator
    && 'PushManager' in window;

export const checkPermission = async (): Promise<boolean> => {
    if (isTauriEnvironment()) {
        if (permissionGranted === null) {
            permissionGranted = await isPermissionGranted();
        }
        if (!permissionGranted) {
            const permission = await requestPermission();
            permissionGranted = permission === 'granted';
        }
        return permissionGranted;
    }

    if (typeof window === 'undefined' || typeof Notification === 'undefined') {
        return false;
    }
    if (Notification.permission === 'granted') {
        return true;
    }
    if (Notification.permission === 'denied') {
        return false;
    }
    const result = await Notification.requestPermission();
    return result === 'granted';
};

export const sendNotification = async (title: string, body: string, options: SendNotificationOptions = {}): Promise<void> => {
    try {
        if (shouldSuppressNotification(options)) {
            return;
        }
        const hasPermission = await checkPermission();
        if (!hasPermission) {
            return;
        }
        if (isTauriEnvironment()) {
            tauriSendNotification({ title, body });
        } else if (typeof Notification !== 'undefined') {
            new Notification(title, { body });
        }
    } catch (error) {
        console.error('Failed to send notification:', error);
    }
};

export const setupNotificationListeners = async (): Promise<void> => {
    if (!isTauriEnvironment()) {
        return;
    }
    if (listenersInitialized) {
        return;
    }
    try {
        const webview = getCurrentWebviewWindow();
        await listen('tauri://notification-action', async () => {
            await webview.unminimize();
            await webview.setFocus();
        });
        listenersInitialized = true;
    } catch (error) {
        console.error('Failed to set up notification listeners:', error);
    }
};

export interface WebPushSubscriptionResult {
    registration: ServiceWorkerRegistration;
    subscription: PushSubscription;
}

export interface SubscribeToWebPushOptions {
    vapidPublicKey?: string;
    forceResubscribe?: boolean;
}

export const subscribeToWebPush = async (
    options: SubscribeToWebPushOptions = {},
): Promise<WebPushSubscriptionResult | null> => {
    if (!isWebPushSupported()) {
        return null;
    }
    try {
        const registration = await navigator.serviceWorker.ready;
        if (!registration.pushManager) {
            return null;
        }
        let subscription = await registration.pushManager.getSubscription();
        const shouldResubscribe = options.forceResubscribe || !subscription;
        if (shouldResubscribe) {
            const applicationServerKey = resolveVapidKey(options.vapidPublicKey);
            const subscribeOptions: PushSubscriptionOptionsInit = { userVisibleOnly: true };
            if (applicationServerKey) {
                subscribeOptions.applicationServerKey = applicationServerKey;
            }
            subscription = await registration.pushManager.subscribe(subscribeOptions);
        }
        if (!subscription) {
            return null;
        }
        return { registration, subscription };
    } catch (error) {
        console.error('Failed to subscribe to web push', error);
        throw error;
    }
};
