import { useEffect } from 'react';
import { NativeModules, Platform } from 'react-native';

const { CallKitBridge, ConnectionServiceBridge } = NativeModules as Record<string, {
  updateCallState?: (state: string) => void;
  endCall?: () => void;
  startCall?: (roomId: string) => void;
}>;

export const useNativeCallBridge = (roomId: string, state: string) => {
  useEffect(() => {
    const bridge = Platform.OS === 'ios' ? CallKitBridge : ConnectionServiceBridge;
    if (!bridge?.startCall) {
      return;
    }
    if (state === 'connecting') {
      bridge.startCall?.(roomId);
    } else if (state === 'ended') {
      bridge.endCall?.();
    } else {
      bridge.updateCallState?.(state);
    }
  }, [roomId, state]);
};
