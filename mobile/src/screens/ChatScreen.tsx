import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  SafeAreaView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { RouteProp, useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import * as DocumentPicker from 'expo-document-picker';
import { Audio } from 'expo-av';
import { MatrixUser, useRoomTimeline } from '@matrix-messenger/core';
import { getTheme, spacing, controls, radii, typography } from '@matrix-messenger/ui-tokens';
import { MessageInputNative } from '@matrix-messenger/ui/message-input';
import { MessageBubble } from '../components/MessageBubble';
import { GifStickerPicker } from '../components/GifStickerPicker';
import { MatrixSessionWithAccount } from '../context/MatrixSessionContext';
import { RootStackParamList } from '../types/navigation';
import { useDraftManager } from '../hooks/useDraftManager';
import { useMessageScheduler } from '../hooks/useMessageScheduler';

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
export const ChatScreen: React.FC<ChatScreenProps> = ({ session, route }) => {
  const { roomId, roomName } = route.params;
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [recording, setRecording] = useState<Audio.Recording | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [pickerVisible, setPickerVisible] = useState(false);
  const [scheduledFor, setScheduledFor] = useState<Date | null>(null);

  const { events, isLoading, sendMessage, sendAttachment, sendVoiceMessage } = useRoomTimeline({
    client: session.client,
    roomId,
  });

  const members = useMemo<MatrixUser[]>(() => {
    const room = session.client.getRoom(roomId);
    if (!room) return [];
    return room.getMembersWithMembership('join').map(member => ({
      userId: member.userId,
      displayName: member.name,
      avatarUrl: member.getAvatarUrl(session.client.baseUrl, 64, 64, 'scale') ?? undefined,
    }));
  }, [roomId, session.client]);

  const { currentDraft, updateDraft } = useDraftManager(roomId);
  const { upcoming, scheduleMessage, clearRoomSchedules } = useMessageScheduler(roomId);

  const activeSchedule = useMemo(() => {
    if (!upcoming.length) return null;
    const first = upcoming[0];
    const ts = Date.parse(first.content.scheduledFor ?? '');
    if (Number.isNaN(ts)) return null;
    return new Date(ts);
  }, [upcoming]);

  useEffect(() => {
    if (!input && currentDraft?.plain) {
      setInput(currentDraft.plain);
    }
  }, [currentDraft, input]);

  const sortedEvents = useMemo(() => [...events].sort((a, b) => a.timestamp - b.timestamp), [events]);

  const handleSend = useCallback(async ({ body }: { body: string }) => {
    const text = body.trim();
    if (!text) return;
    setSending(true);
    try {
      await sendMessage(text);
      setInput('');
      updateDraft(null);
    } catch (error) {
      console.warn('send message failed', error);
    } finally {
      setSending(false);
    }
  }, [sendMessage, updateDraft]);

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
        <MessageInputNative
          roomMembers={members}
          value={input || currentDraft?.plain || ''}
          onChangeValue={setInput}
          onSend={handleSend}
          isSending={sending}
          onDraftChange={draft => updateDraft(draft)}
          draftContent={currentDraft}
          onOpenAttachmentPicker={handleAttachment}
          onToggleVoiceRecording={toggleRecording}
          isRecording={Boolean(recording)}
          onOpenGifPicker={() => setPickerVisible(true)}
          onSchedule={content => {
            scheduleMessage(content);
            setScheduledFor(new Date(content.scheduledFor ?? Date.now()));
          }}
          scheduledFor={scheduledFor ?? activeSchedule}
          onClearSchedule={() => {
            clearRoomSchedules();
            setScheduledFor(null);
          }}
          accessoryContent={
            isUploading ? (
              <View style={styles.uploadBanner}>
                <ActivityIndicator color={chatTheme.colors.text.primary} size="small" />
                <Text style={styles.uploadText}>Загрузка вложения…</Text>
              </View>
            ) : null
          }
        />
      </KeyboardAvoidingView>
      <GifStickerPicker
        visible={pickerVisible}
        onClose={() => setPickerVisible(false)}
        onSelectGif={async gif => {
          try {
            await sendMessage(gif.url);
          } catch (error) {
            console.warn('send gif failed', error);
          }
        }}
        onSelectSticker={async sticker => {
          try {
            await sendMessage(sticker.url);
          } catch (error) {
            console.warn('send sticker failed', error);
          }
        }}
      />
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
  uploadBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    gap: spacing.xs,
  },
  uploadText: {
    color: chatTheme.colors.text.secondary,
    ...typography.caption,
  },
});
