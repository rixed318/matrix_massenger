import { isPermissionGranted, requestPermission, sendNotification as tauriSendNotification } from '@tauri-apps/plugin-notification';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { listen } from '@tauri-apps/api/event';

let permissionGranted: boolean | null = null;
let listenersInitialized = false;

export const checkPermission = async (): Promise<boolean> => {
    if (permissionGranted === null) {
        permissionGranted = await isPermissionGranted();
    }
    if (!permissionGranted) {
        const permission = await requestPermission();
        permissionGranted = permission === 'granted';
    }
    return permissionGranted;
};

export const sendNotification = async (title: string, body: string): Promise<void> => {
    try {
        const hasPermission = await checkPermission();
        if (hasPermission) {
            tauriSendNotification({ title, body });
        }
    } catch (error) {
        console.error("Failed to send notification:", error);
    }
};

export const setupNotificationListeners = async (): Promise<void> => {
    if (listenersInitialized) {
        return;
    }
    try {
        const webview = getCurrentWebviewWindow();
        // Listen for the notification action event, which is triggered when a user clicks on a notification.
        await listen('tauri://notification-action', async () => {
            await webview.unminimize();
            await webview.setFocus();
        });
        listenersInitialized = true;
    } catch (error) {
        console.error("Failed to set up notification listeners:", error);
    }
};
