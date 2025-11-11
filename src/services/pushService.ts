import { MatrixClient, DraftContent } from '../types';
import { getAccountStore } from './accountManager';
import { generateSmartReplies, getSmartReplySettings } from './aiComposeService';
import type { SmartReplySuggestion } from './aiComposeService';

const isBrowser = typeof window !== 'undefined';

const base64FromArrayBuffer = (buffer: ArrayBuffer | null): string => {
  if (!buffer) {
    return '';
  }
  const globalRef: any = globalThis as any;
  if (typeof globalRef?.Buffer !== 'undefined') {
    return globalRef.Buffer.from(buffer).toString('base64');
  }
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
};

const resolveStringEnv = (key: string, fallback?: string): string | undefined => {
  try {
    const env = (import.meta as any)?.env ?? {};
    const value = env[key];
    if (typeof value === 'string' && value.length > 0) {
      return value;
    }
  } catch {
    /* no-op */
  }
  return fallback;
};

const defaultAppId = resolveStringEnv('VITE_MATRIX_PUSH_APP_ID', 'matrix-messenger-web');
const defaultAppDisplayName = resolveStringEnv('VITE_MATRIX_PUSH_APP_NAME', 'Matrix Messenger');
const defaultDeviceDisplayName = resolveStringEnv('VITE_MATRIX_PUSH_DEVICE_NAME');
const defaultPushGatewayUrl = resolveStringEnv('VITE_MATRIX_PUSH_GATEWAY')
  ?? resolveStringEnv('VITE_MATRIX_PUSH_GATEWAY_URL');
const defaultProfileTag = resolveStringEnv('VITE_MATRIX_PUSH_PROFILE_TAG');

const postToServiceWorker = (type: string, payload: Record<string, unknown>) => {
  if (!isBrowser) {
    return;
  }
  try {
    const controller = navigator.serviceWorker?.controller;
    controller?.postMessage({ type, payload });
  } catch (error) {
    console.warn('Failed to post message to service worker', error);
  }
};

export interface CallTranscriptNotification {
  callId: string;
  roomId: string;
  text: string;
  language?: string;
  targetLanguage?: string;
  timestamp: number;
  sender: string;
}

export const announceCallTranscript = (transcript: CallTranscriptNotification) => {
  postToServiceWorker('CALL_TRANSCRIPT_READY', transcript as unknown as Record<string, unknown>);
};

export interface StoredPushSubscription {
  endpoint: string;
  auth: string;
  p256dh: string;
  push_key: string;
  expiration_time?: number | null;
  updated_at?: number;
}

export interface DailyDigestNotificationPayload {
  title?: string;
  body: string;
  roomId?: string;
  accountKey?: string | null;
  unreadCount?: number;
  url?: string;
}

export const sendDailyDigestNotification = async (
  payload: DailyDigestNotificationPayload,
): Promise<void> => {
  const effectiveTitle = payload.title?.trim() || 'Ежедневный дайджест';
  const effectiveBody = payload.body?.trim() || 'Посмотрите, что произошло в комнатах за день.';
  try {
    await sendNotification(effectiveTitle, effectiveBody, { roomId: payload.roomId });
  } catch (error) {
    console.debug('Failed to deliver daily digest notification via Notification API', error);
  }

  if (typeof navigator !== 'undefined' && navigator.serviceWorker?.controller) {
    try {
      navigator.serviceWorker.controller.postMessage({
        type: 'DAILY_DIGEST_NOTIFICATION',
        payload: {
          title: effectiveTitle,
          body: effectiveBody,
          roomId: payload.roomId ?? null,
          accountKey: payload.accountKey ?? null,
          unreadCount: payload.unreadCount ?? null,
          url: payload.url ?? null,
        },
      });
    } catch (error) {
      console.debug('Failed to forward daily digest notification to service worker', error);
    }
  }
};

const buildDeviceDisplayName = () => {
  if (defaultDeviceDisplayName) {
    return defaultDeviceDisplayName;
  }
  if (!isBrowser) {
    return 'Matrix Messenger';
  }
  const nav: any = navigator;
  if (nav?.userAgentData?.platform) {
    return `Web ${nav.userAgentData.platform}`;
  }
  if (nav?.platform) {
    return `Web ${nav.platform}`;
  }
  return 'Matrix Messenger (Web)';
};

export const serializePushSubscription = (subscription: PushSubscription): StoredPushSubscription => ({
  endpoint: subscription.endpoint,
  auth: base64FromArrayBuffer(subscription.getKey('auth')),
  p256dh: base64FromArrayBuffer(subscription.getKey('p256dh')),
  push_key: subscription.endpoint,
  expiration_time: subscription.expirationTime ?? undefined,
  updated_at: Date.now(),
});

export interface RegisterMatrixPushOptions {
  accountKey?: string | null;
  appId?: string;
  appDisplayName?: string;
  deviceDisplayName?: string;
  pushGatewayUrl?: string;
  profileTag?: string;
}

export const registerMatrixWebPush = async (
  client: MatrixClient,
  registration: ServiceWorkerRegistration,
  subscription: PushSubscription,
  options: RegisterMatrixPushOptions = {},
): Promise<StoredPushSubscription> => {
  const serialized = serializePushSubscription(subscription);
  const store = getAccountStore();
  const accountKey = options.accountKey ?? store.getState().activeKey;

  const appId = options.appId ?? defaultAppId ?? 'matrix-messenger-web';
  const appDisplayName = options.appDisplayName ?? defaultAppDisplayName ?? 'Matrix Messenger';
  const deviceDisplayName = options.deviceDisplayName ?? buildDeviceDisplayName();
  const pushGatewayUrl = options.pushGatewayUrl ?? defaultPushGatewayUrl;
  const profileTag = options.profileTag ?? defaultProfileTag;

  try {
    if (typeof (client as any).setPusher === 'function') {
      await (client as any).setPusher({
        kind: 'http',
        app_id: appId,
        app_display_name: appDisplayName,
        device_display_name: deviceDisplayName,
        profile_tag: profileTag ?? undefined,
        lang: isBrowser ? (navigator.language || 'en') : 'en',
        pushkey: serialized.push_key,
        data: {
          url: pushGatewayUrl,
          format: 'event_id_only',
          endpoint: serialized.endpoint,
          auth: serialized.auth,
          p256dh: serialized.p256dh,
        },
      });
    }
  } catch (error) {
    console.error('Failed to register pusher with homeserver', error);
    throw error;
  }

  try {
    if (typeof (client as any).enablePushNotifications === 'function') {
      await (client as any).enablePushNotifications();
    }
  } catch (error) {
    console.warn('enablePushNotifications failed', error);
  }

  if (registration?.active) {
    try {
      registration.active.postMessage({
        type: 'PUSH_SUBSCRIPTION_UPDATED',
        subscription: serialized,
      });
    } catch (error) {
      console.warn('Failed to notify service worker about push subscription', error);
    }
  }

  try {
    await registration?.sync?.register?.('matrix-outbox-flush');
  } catch (error) {
    console.debug('Background sync registration failed', error);
  }

  if (accountKey) {
    await store.getState().updateAccountCredentials(accountKey, (creds) => ({
      ...creds,
      push_subscription: serialized,
    }));
  } else {
    console.warn('Unable to persist push subscription without account key');
  }

  return serialized;
};

export interface NotificationSmartReplyOptions {
  roomId: string;
  accountKey?: string | null;
  draft?: DraftContent | null;
  limit?: number;
  signal?: AbortSignal;
}

export const generateNotificationSmartReplies = async (
  options: NotificationSmartReplyOptions,
): Promise<SmartReplySuggestion[]> => {
  const store = getAccountStore();
  const targetKey = options.accountKey ?? store.getState().activeKey;
  if (!targetKey) {
    return [];
  }
  const account = store.getState().accounts[targetKey];
  if (!account) {
    return [];
  }
  const settings = getSmartReplySettings(account.client);
  if (!settings.enabled) {
    return [];
  }
  try {
    return await generateSmartReplies(account.client, options.roomId, options.draft, {
      limit: options.limit ?? 3,
      signal: options.signal,
    });
  } catch (error) {
    console.warn('smart-reply: failed to compose notification suggestions', error);
    return [];
  }
};
