import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, SafeAreaView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { RouteProp, useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { mediaDevices, MediaStream, RTCView } from 'react-native-webrtc';
import { MatrixSessionWithAccount } from '../context/MatrixSessionContext';
import { RootStackParamList } from '../types/navigation';
import {
  buildCallSessionSnapshot,
  CallSessionState,
  handoverCallToCurrentDevice,
  setCallSessionForClient,
  subscribeCallState,
  updateLocalCallDeviceState,
} from '@matrix-messenger/core';

interface CallScreenProps {
  session: MatrixSessionWithAccount;
  route: RouteProp<RootStackParamList, 'Call'>;
}

export const CallScreen: React.FC<CallScreenProps> = ({ session, route }) => {
  const { roomId } = route.params;
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [callState, setCallState] = useState<string>('connecting');
  const [error, setError] = useState<string | null>(null);
  const [callSession, setCallSession] = useState<CallSessionState | null>(null);
  const [handoverInFlight, setHandoverInFlight] = useState(false);
  const deviceId = useMemo(() => session.client.getDeviceId?.() ?? null, [session.client]);
  const accountKey = useMemo(
    () => `${session.account.homeserver_url.replace(/\/+$/, '')}/${session.account.user_id}`,
    [session.account.homeserver_url, session.account.user_id],
  );
  const matrixCallRef = useRef<any>(null);

  useEffect(() => {
    const unsubscribe = subscribeCallState(accountKey, setCallSession);
    return () => {
      try { unsubscribe?.(); } catch (err) { console.warn('call session unsubscribe failed', err); }
    };
  }, [accountKey]);

  useEffect(() => {
    let disposed = false;
    let matrixCall: any = null;
    let activeStream: MediaStream | null = null;

    const startCall = async () => {
      try {
        const stream = await mediaDevices.getUserMedia({
          audio: true,
          video: true,
        });
        if (disposed) {
          stream.getTracks().forEach(track => track.stop());
          return;
        }
        activeStream = stream;
        setLocalStream(stream);
        const createCall = (session.client as any).createCall?.bind(session.client);
        if (!createCall) {
          setError('У клиента отсутствует поддержка звонков');
          return;
        }
        matrixCall = createCall(roomId);
        if (!matrixCall) {
          setError('Не удалось создать звонок');
          return;
        }
        matrixCallRef.current = matrixCall;
        matrixCall.on?.('state', (state: string) => {
          setCallState(state);
          if (state === 'connected') {
            setCallSessionForClient(session.client, buildCallSessionSnapshot(session.client, matrixCall, 'connected'));
          } else if (state === 'ended') {
            navigation.goBack();
            setCallSessionForClient(session.client, null);
          }
        });
        matrixCall.on?.('error', (callError: Error) => {
          console.warn('Matrix call error', callError);
          setError(callError.message);
        });
        matrixCall.placeVideoCall(stream);
        setCallSessionForClient(session.client, buildCallSessionSnapshot(session.client, matrixCall, 'connecting'));
      } catch (err) {
        console.warn('start call failed', err);
        setError(err instanceof Error ? err.message : 'Не удалось начать звонок');
        setCallSessionForClient(session.client, null);
      }
    };

    startCall();

    return () => {
      disposed = true;
      if (matrixCall) {
        try { matrixCall.hangup?.(); } catch (err) { console.warn('hangup failed', err); }
      }
      matrixCallRef.current = null;
      setCallSessionForClient(session.client, null);
      const stream = activeStream ?? localStream;
      if (stream) {
        stream.getTracks().forEach(track => track.stop());
      }
    };
  }, [session.client, roomId, navigation]);

  const handleEndCall = () => {
    navigation.goBack();
  };

  useEffect(() => {
    const matrixCall = matrixCallRef.current;
    if (!matrixCall || !callSession || !deviceId) {
      return;
    }
    const localDevice = callSession.devices.find(device => device.deviceId === deviceId);
    if (!localDevice) {
      return;
    }
    const shouldBeActive = callSession.activeDeviceId === deviceId;
    const isMuted = typeof matrixCall.isMicrophoneMuted === 'function'
      ? Boolean(matrixCall.isMicrophoneMuted())
      : false;

    if (!shouldBeActive) {
      if (!isMuted) {
        try {
          if (typeof matrixCall.setMicrophoneMuted === 'function') {
            matrixCall.setMicrophoneMuted(true);
          }
        } catch (err) {
          console.warn('Failed to mute local mobile call after remote handover', err);
        }
      }
      updateLocalCallDeviceState(session.client, { muted: true, connected: false });
    } else {
      if (localDevice.muted && isMuted) {
        try {
          if (typeof matrixCall.setMicrophoneMuted === 'function') {
            matrixCall.setMicrophoneMuted(false);
          }
        } catch (err) {
          console.warn('Failed to unmute local mobile call during handover', err);
        }
      }
      updateLocalCallDeviceState(session.client, { muted: false, connected: true });
    }
  }, [callSession, deviceId, session.client]);

  useEffect(() => {
    if (callSession?.status === 'ended') {
      navigation.goBack();
    }
  }, [callSession?.status, navigation]);

  const handoverEnabled = useMemo(() => {
    if (!callSession || !deviceId) {
      return false;
    }
    return Boolean(callSession.activeDeviceId && callSession.activeDeviceId !== deviceId);
  }, [callSession, deviceId]);

  const secondaryDevices = useMemo(() => {
    if (!callSession) {
      return [] as CallSessionState['devices'];
    }
    return callSession.devices.filter(device => device.deviceId !== callSession.activeDeviceId && device.deviceId !== deviceId);
  }, [callSession, deviceId]);

  const localDeviceEntry = useMemo(() => {
    if (!callSession || !deviceId) {
      return null;
    }
    return callSession.devices.find(device => device.deviceId === deviceId) ?? null;
  }, [callSession, deviceId]);

  const handleHandover = useCallback(() => {
    if (!callSession) {
      return;
    }
    setHandoverInFlight(true);
    handoverCallToCurrentDevice(session.client, callSession)
      .catch(err => {
        console.warn('Failed to hand over mobile call to current device', err);
      })
      .finally(() => setHandoverInFlight(false));
  }, [callSession, session.client]);

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <Text style={styles.title}>Звонок</Text>
        <Text style={styles.subtitle}>Комната: {roomId}</Text>
        {callSession ? (
          <View style={styles.banner}>
            <Text style={styles.bannerText}>
              {callSession.activeDeviceId && callSession.activeDeviceId === deviceId
                ? 'Звонок активен на этом устройстве'
                : 'Звонок активен на другом устройстве'}
            </Text>
            {secondaryDevices.length > 0 ? (
              <Text style={styles.bannerSecondary} numberOfLines={2}>
                Вторичные устройства: {secondaryDevices
                  .map(device => device.label || device.userId || device.deviceId)
                  .filter(Boolean)
                  .join(', ')}
              </Text>
            ) : null}
            {localDeviceEntry && localDeviceEntry.muted && callSession.activeDeviceId !== deviceId ? (
              <Text style={styles.bannerMuted}>Микрофон этого устройства отключён</Text>
            ) : null}
            {handoverEnabled ? (
              <TouchableOpacity
                style={[styles.handoverButton, handoverInFlight && styles.handoverButtonDisabled]}
                accessibilityRole="button"
                onPress={handleHandover}
                disabled={handoverInFlight}
              >
                <Text style={styles.handoverButtonText}>
                  {handoverInFlight ? 'Подключение…' : 'Подхватить на этом устройстве'}
                </Text>
              </TouchableOpacity>
            ) : null}
          </View>
        ) : null}
        {error ? (
          <Text style={styles.error}>{error}</Text>
        ) : null}
        {!error && !localStream ? (
          <ActivityIndicator color="#fff" />
        ) : null}
        {localStream ? (
          <RTCView
            streamURL={localStream.toURL()}
            style={styles.video}
            objectFit="cover"
            mirror
          />
        ) : null}
        <Text style={styles.status}>
          Статус: {callState}
          {callSession?.status && callSession.status !== callState ? ` (${callSession.status})` : ''}
        </Text>
      </View>
      <TouchableOpacity style={styles.hangupButton} onPress={handleEndCall} accessibilityRole="button">
        <Text style={styles.hangupText}>Завершить</Text>
      </TouchableOpacity>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0B1526',
    padding: 16,
    justifyContent: 'space-between',
  },
  content: {
    alignItems: 'center',
    gap: 16,
  },
  title: {
    color: '#fff',
    fontSize: 24,
    fontWeight: '700',
  },
  subtitle: {
    color: '#9ba9c5',
  },
  error: {
    color: '#ff6b6b',
    textAlign: 'center',
  },
  banner: {
    width: '100%',
    backgroundColor: 'rgba(15, 27, 46, 0.85)',
    borderRadius: 16,
    padding: 12,
    gap: 6,
  },
  bannerText: {
    color: '#e2e8f0',
    fontWeight: '600',
  },
  bannerSecondary: {
    color: '#cbd5f5',
  },
  bannerMuted: {
    color: '#f7c948',
  },
  handoverButton: {
    marginTop: 4,
    backgroundColor: '#34d399',
    paddingVertical: 10,
    borderRadius: 12,
    alignItems: 'center',
  },
  handoverButtonDisabled: {
    opacity: 0.7,
  },
  handoverButtonText: {
    color: '#0b1526',
    fontWeight: '700',
  },
  video: {
    width: '100%',
    aspectRatio: 3 / 4,
    borderRadius: 16,
    backgroundColor: '#1f2a44',
  },
  status: {
    color: '#9ba9c5',
  },
  hangupButton: {
    backgroundColor: '#d1485f',
    borderRadius: 24,
    paddingVertical: 16,
    alignItems: 'center',
  },
  hangupText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});
