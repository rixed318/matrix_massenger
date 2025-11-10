import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { RouteProp, useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import * as DocumentPicker from 'expo-document-picker';
import { Audio } from 'expo-av';
import { useRoomTimeline } from '@matrix-messenger/core';
import { getTheme, spacing, controls, radii, typography } from '@matrix-messenger/ui-tokens';
import { MessageBubble } from '../components/MessageBubble';
import { MatrixSessionWithAccount } from '../context/MatrixSessionContext';
import { RootStackParamList } from '../types/navigation';

interface ChatScreenProps {
  session: MatrixSessionWithAccount;
  route: RouteProp<RootStackParamList, 'Chat'>;
}

const fetchArrayBuffer = async (uri: string) => {
  const response = await fetch(uri);
  const blob = await response.blob();
  const buffer = await blob.arrayBuffer();
  return { buffer, size: blob.size, mimeType: blob.type };
};

const chatTheme = getTheme('dark');
const controlRadius = controls.md / 2;
const sendControlRadius = controls.lg / 2;
const inputVerticalPadding = spacing.sm + spacing.xs / 2;
const inputMaxHeight = controls.lg * 2.5;

export const ChatScreen: React.FC<ChatScreenProps> = ({ session, route }) => {
  const { roomId, roomName } = route.params;
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [recording, setRecording] = useState<Audio.Recording | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  const { events, isLoading, sendMessage, sendAttachment, sendVoiceMessage } = useRoomTimeline({
    client: session.client,
    roomId,
  });

  const sortedEvents = useMemo(() => [...events].sort((a, b) => a.timestamp - b.timestamp), [events]);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text) return;
    setSending(true);
    try {
      await sendMessage(text);
      setInput('');
    } catch (error) {
      console.warn('send message failed', error);
    } finally {
      setSending(false);
    }
  }, [input, sendMessage]);

  const handleAttachment = useCallback(async () => {
    try {
      setIsUploading(true);
      const result = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true });
      if ((result as any).canceled || !result.assets?.length) {
        return;
      }
      const asset = result.assets[0];
      const { buffer, size, mimeType } = await fetchArrayBuffer(asset.uri);
      await sendAttachment(buffer, {
        mimeType: asset.mimeType ?? mimeType,
        name: asset.name ?? 'file',
        size: asset.size ?? size,
      });
    } catch (error) {
      console.warn('attachment upload failed', error);
    } finally {
      setIsUploading(false);
    }
  }, [sendAttachment]);

  const startRecording = useCallback(async () => {
    try {
      const permission = await Audio.requestPermissionsAsync();
      if (!permission.granted) {
        console.warn('Microphone permission denied');
        return;
      }
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });
      const newRecording = new Audio.Recording();
      await newRecording.prepareToRecordAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
      await newRecording.startAsync();
      setRecording(newRecording);
    } catch (error) {
      console.warn('start recording failed', error);
    }
  }, []);

  const stopRecording = useCallback(async () => {
    if (!recording) return;
    try {
      await recording.stopAndUnloadAsync();
      const uri = recording.getURI();
      if (!uri) return;
      const duration = recording.getDurationMillis() ?? 0;
      const { buffer, size, mimeType } = await fetchArrayBuffer(uri);
      await sendVoiceMessage(buffer, duration, { mimeType: mimeType || 'audio/m4a', size });
    } catch (error) {
      console.warn('stop recording failed', error);
    } finally {
      setRecording(null);
    }
  }, [recording, sendVoiceMessage]);

  const toggleRecording = useCallback(() => {
    if (recording) {
      stopRecording();
    } else {
      startRecording();
    }
  }, [recording, startRecording, stopRecording]);

  const openCallScreen = useCallback(() => {
    navigation.navigate('Call', { roomId });
  }, [navigation, roomId]);

  const placeholderColor = chatTheme.colors.text.placeholder;

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        style={styles.inner}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={80}
      >
        <View style={styles.header}>
          <View>
            <Text style={styles.title}>{roomName}</Text>
            <Text style={styles.subtitle}>{session.displayName ?? session.account.user_id}</Text>
          </View>
          <TouchableOpacity style={styles.callButton} onPress={openCallScreen} accessibilityRole="button">
            <Text style={styles.callText}>📞</Text>
          </TouchableOpacity>
        </View>
        {isLoading ? (
          <View style={styles.loading}> 
            <ActivityIndicator color={chatTheme.colors.text.primary} />
          </View>
        ) : (
          <FlatList
            data={sortedEvents}
            keyExtractor={item => item.id}
            renderItem={({ item }) => (
              <MessageBubble message={item} isOwn={item.isOwn} />
            )}
            contentContainerStyle={styles.messages}
          />
        )}
        <View style={styles.inputRow}>
          <TouchableOpacity
            style={[styles.actionButton, isUploading && styles.disabledActionButton]}
            onPress={handleAttachment}
            disabled={isUploading}
          >
            <Text style={styles.actionText}>➕</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionButton, recording && styles.recordingButton]}
            onPress={toggleRecording}
          >
            <Text style={styles.actionText}>{recording ? '⏹' : '🎙️'}</Text>
          </TouchableOpacity>
          <TextInput
            style={styles.input}
            placeholder="Сообщение"
            placeholderTextColor={placeholderColor}
            value={input}
            onChangeText={setInput}
            multiline
          />
          <TouchableOpacity
            style={[styles.sendButton, sending && styles.disabledSendButton]}
            onPress={handleSend}
            accessibilityRole="button"
            disabled={sending}
          >
            <Text style={styles.sendText}>➤</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: chatTheme.colors.background.primary,
  },
  inner: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.md,
  },
  title: {
    color: chatTheme.colors.text.primary,
    fontSize: typography.fontSize.lg,
    fontWeight: typography.fontWeight.semibold,
  },
  subtitle: {
    color: chatTheme.colors.text.secondary,
    fontSize: typography.fontSize.xs,
    lineHeight: typography.lineHeight.snug,
  },
  callButton: {
    backgroundColor: chatTheme.colors.controls.surface,
    borderRadius: controlRadius,
    width: controls.md,
    height: controls.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  callText: {
    fontSize: typography.fontSize.lg,
  },
  loading: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  messages: {
    paddingBottom: spacing.lg,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    gap: spacing.sm,
  },
  actionButton: {
    backgroundColor: chatTheme.colors.controls.surface,
    width: controls.md,
    height: controls.md,
    borderRadius: controlRadius,
    alignItems: 'center',
    justifyContent: 'center',
  },
  disabledActionButton: {
    opacity: 0.5,
  },
  actionText: {
    color: chatTheme.colors.text.primary,
    fontSize: typography.fontSize.md,
  },
  recordingButton: {
    backgroundColor: chatTheme.colors.controls.recording,
  },
  input: {
    flex: 1,
    minHeight: controls.md,
    maxHeight: inputMaxHeight,
    backgroundColor: chatTheme.colors.background.tertiary,
    borderRadius: radii.lg,
    color: chatTheme.colors.text.primary,
    paddingHorizontal: spacing.lg,
    paddingVertical: inputVerticalPadding,
  },
  sendButton: {
    backgroundColor: chatTheme.colors.accent.primary,
    width: controls.lg,
    height: controls.lg,
    borderRadius: sendControlRadius,
    alignItems: 'center',
    justifyContent: 'center',
  },
  disabledSendButton: {
    opacity: 0.6,
  },
  sendText: {
    color: chatTheme.colors.text.inverted,
    fontSize: typography.fontSize.md,
  },
});
