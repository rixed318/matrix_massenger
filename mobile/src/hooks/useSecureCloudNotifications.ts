import { useEffect } from 'react';
import * as Notifications from 'expo-notifications';
import type { MatrixSessionWithAccount } from '../context/MatrixSessionContext';
import {
  startSecureCloudSession,
  type SecureCloudProfile,
  type SuspiciousEventNotice,
} from '@matrix-messenger/core';

const DEFAULT_PROFILE: SecureCloudProfile = {
  mode: 'managed',
  apiBaseUrl: 'https://secure-cloud.matrix-messenger.io',
  enableAnalytics: false,
  enablePremium: false,
  retentionPeriodDays: 30,
  allowedEventTypes: ['m.room.message', 'm.sticker'],
};

const ensureNotificationReady = async () => {
  const settings = await Notifications.getPermissionsAsync();
  if (!settings.granted) {
    await Notifications.requestPermissionsAsync();
  }
};

const presentNotice = async (notice: SuspiciousEventNotice) => {
  await Notifications.scheduleNotificationAsync({
    content: {
      title: `Secure Cloud: ${notice.roomName ?? notice.roomId}`,
      body: notice.summary,
      data: { roomId: notice.roomId, eventId: notice.eventId },
    },
    trigger: null,
  });
};

export const useSecureCloudNotifications = (session: MatrixSessionWithAccount | null) => {
  useEffect(() => {
    if (!session) return;
    let disposed = false;
    let secureSession: ReturnType<typeof startSecureCloudSession> | null = null;

    ensureNotificationReady().catch(error => console.warn('Notification permission failed', error));

    try {
      secureSession = startSecureCloudSession(session.client, DEFAULT_PROFILE, {
        onSuspiciousEvent: notice => {
          if (!disposed) {
            presentNotice(notice).catch(error => console.warn('Secure Cloud notification failed', error));
          }
        },
        onError: error => console.warn('Secure Cloud session error', error),
      });
    } catch (error) {
      console.warn('Failed to start Secure Cloud session', error);
    }

    return () => {
      disposed = true;
      secureSession?.stop();
    };
  }, [session]);
};
