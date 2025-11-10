import React, { useEffect, useState } from 'react';
import { ActivityIndicator, SafeAreaView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { RouteProp, useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { mediaDevices, MediaStream, RTCView } from 'react-native-webrtc';
import { MatrixSessionWithAccount } from '../context/MatrixSessionContext';
import { RootStackParamList } from '../types/navigation';
import { useNativeCallBridge } from '../hooks/useNativeCallBridge';

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

  useNativeCallBridge(roomId, callState);

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
        matrixCall.on?.('state', (state: string) => {
          setCallState(state);
          if (state === 'ended') {
            navigation.goBack();
          }
        });
        matrixCall.on?.('error', (callError: Error) => {
          console.warn('Matrix call error', callError);
          setError(callError.message);
        });
        matrixCall.placeVideoCall(stream);
      } catch (err) {
        console.warn('start call failed', err);
        setError(err instanceof Error ? err.message : 'Не удалось начать звонок');
      }
    };

    startCall();

    return () => {
      disposed = true;
      if (matrixCall) {
        try { matrixCall.hangup?.(); } catch (err) { console.warn('hangup failed', err); }
      }
      const stream = activeStream ?? localStream;
      if (stream) {
        stream.getTracks().forEach(track => track.stop());
      }
    };
  }, [session.client, roomId, navigation]);

  const handleEndCall = () => {
    navigation.goBack();
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <Text style={styles.title}>Звонок</Text>
        <Text style={styles.subtitle}>Комната: {roomId}</Text>
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
        <Text style={styles.status}>Статус: {callState}</Text>
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
