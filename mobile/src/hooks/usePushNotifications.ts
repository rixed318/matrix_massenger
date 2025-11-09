import { useEffect } from 'react';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { MatrixSessionWithAccount } from '../context/MatrixSessionContext';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: false,
    shouldSetBadge: true,
  }),
});

const resolveProjectId = () =>
  Constants.expoConfig?.extra?.eas?.projectId
    ?? Constants.expoConfig?.extra?.projectId
    ?? Constants.easConfig?.projectId
    ?? Constants.manifest2?.extra?.expoClient?.eas?.projectId
    ?? Constants.expoConfig?.owner;

const registerForPushTokenAsync = async (): Promise<string | null> => {
  if (!Device.isDevice) {
    console.warn('Push notifications require a physical device');
    return null;
  }

  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;
  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }
  if (finalStatus !== 'granted') {
    console.warn('Push notifications permission denied');
    return null;
  }

  const projectId = resolveProjectId();
  if (!projectId) {
    console.warn('EAS project id is not configured, skipping push registration');
    return null;
  }

  const response = await Notifications.getExpoPushTokenAsync({
    projectId,
  });
  return response.data;
};

const registerMatrixPusher = async (client: MatrixSessionWithAccount['client'], token: string) => {
  const locale = typeof Intl !== 'undefined'
    ? Intl.DateTimeFormat().resolvedOptions().locale
    : 'en';
  const language = (locale ?? 'en').split('-')[0];
  const appId = `expo.${Constants.expoConfig?.slug ?? 'matrix-messenger'}`;
  const dataUrl = Constants.expoConfig?.extra?.pushGatewayUrl ?? 'https://matrix-push.nordic.dev/_matrix/push/v1/notify';

  await client.setPusher({
    kind: 'http',
    app_id: appId,
    app_display_name: Constants.expoConfig?.name ?? 'Matrix Messenger',
    device_display_name: Device.modelName ?? 'Expo Device',
    profile_tag: 'mobile',
    lang: language,
    pushkey: token,
    data: {
      url: dataUrl,
      format: 'event_id_only',
    },
  } as any);
};

export const usePushNotifications = (session: MatrixSessionWithAccount | null) => {
  useEffect(() => {
    if (!session) {
      return;
    }

    let cancelled = false;

    const setup = async () => {
      try {
        const token = await registerForPushTokenAsync();
        if (!token || cancelled) {
          return;
        }
        await registerMatrixPusher(session.client, token);
      } catch (error) {
        console.warn('Failed to register push notifications', error);
      }
    };

    setup();

    return () => {
      cancelled = true;
    };
  }, [session]);
};
