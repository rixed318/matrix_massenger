import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Keyboard,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import type { DraftContent, MatrixUser, Message } from '@matrix-messenger/core';
import { getTheme, controls, radii, spacing, typography } from '@matrix-messenger/ui-tokens';
import { formatFileSize, renderMarkdown } from './helpers';

export interface MessageInputNativeProps {
  roomMembers: MatrixUser[];
  value: string;
  onChangeValue: (value: string) => void;
  onSend: (payload: { body: string; formattedBody?: string }) => Promise<void> | void;
  isSending?: boolean;
  replyingTo?: Message | null;
  onCancelReply?: () => void;
  draftContent?: DraftContent | null;
  onDraftChange?: (content: DraftContent | null) => void;
  onOpenAttachmentPicker?: () => void;
  onToggleVoiceRecording?: () => void;
  isRecording?: boolean;
  onOpenGifPicker?: () => void;
  onSchedule?: (content: DraftContent) => void;
  scheduledFor?: Date | null;
  onClearSchedule?: () => void;
  accessoryContent?: React.ReactNode;
}

const theme = getTheme('dark');

const styles = StyleSheet.create({
  container: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: theme.colors.surface.border,
    backgroundColor: theme.colors.surface.primary,
  },
  replyBanner: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: theme.colors.surface.elevated,
  },
  replyText: {
    color: theme.colors.text.primary,
    flex: 1,
    marginRight: spacing.sm,
    ...typography.caption,
  },
  replyClose: {
    padding: spacing.xs,
  },
  inner: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  input: {
    flex: 1,
    minHeight: controls.lg,
    maxHeight: controls.lg * 3,
    borderRadius: radii.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    backgroundColor: theme.colors.surface.elevated,
    color: theme.colors.text.primary,
    ...typography.body,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    marginLeft: spacing.sm,
  },
  actionButton: {
    width: controls.lg,
    height: controls.lg,
    borderRadius: controls.lg / 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.surface.elevated,
    marginLeft: spacing.xs,
  },
  actionLabel: {
    fontSize: 18,
  },
  sendButton: {
    width: controls.lg,
    height: controls.lg,
    borderRadius: controls.lg / 2,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: spacing.xs,
    backgroundColor: theme.colors.accent.primary,
  },
  sendText: {
    color: theme.colors.text.onAccent,
    fontWeight: '600',
  },
  accessory: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: theme.colors.surface.border,
    backgroundColor: theme.colors.surface.elevated,
  },
  scheduleBanner: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: theme.colors.surface.elevated,
  },
  scheduleText: {
    color: theme.colors.text.secondary,
    ...typography.caption,
  },
  previewModal: {
    flex: 1,
    backgroundColor: '#000000aa',
    justifyContent: 'flex-end',
  },
  previewContent: {
    backgroundColor: theme.colors.surface.primary,
    padding: spacing.md,
    borderTopLeftRadius: radii.xl,
    borderTopRightRadius: radii.xl,
  },
  previewTitle: {
    ...typography.subtitle,
    color: theme.colors.text.primary,
    marginBottom: spacing.sm,
  },
  previewBody: {
    color: theme.colors.text.primary,
  },
  previewClose: {
    alignSelf: 'flex-end',
    marginTop: spacing.md,
  },
  previewCloseText: {
    color: theme.colors.text.accent,
    fontWeight: '600',
  },
});

const formatScheduledDate = (date: Date): string => {
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
};

const MessageInputNative: React.FC<MessageInputNativeProps> = ({
  roomMembers,
  value,
  onChangeValue,
  onSend,
  isSending,
  replyingTo,
  onCancelReply,
  draftContent,
  onDraftChange,
  onOpenAttachmentPicker,
  onToggleVoiceRecording,
  isRecording,
  onOpenGifPicker,
  onSchedule,
  scheduledFor,
  onClearSchedule,
  accessoryContent,
}) => {
  const [showPreview, setShowPreview] = useState(false);

  const formattedPreview = useMemo(() => renderMarkdown(value, roomMembers), [value, roomMembers]);

  const handleSend = async () => {
    const trimmed = value.trim();
    if (!trimmed || isSending) {
      return;
    }
    const payload = { body: trimmed, formattedBody: formattedPreview };
    if (scheduledFor && onSchedule) {
      const content: DraftContent = {
        plain: trimmed,
        html: formattedPreview,
        scheduledFor: scheduledFor.toISOString(),
      };
      onSchedule(content);
      onDraftChange?.(content);
      onClearSchedule?.();
      onChangeValue('');
      Keyboard.dismiss();
      return;
    }
    await onSend(payload);
    onDraftChange?.(null);
    onChangeValue('');
    Keyboard.dismiss();
  };

  const handleOpenPreview = () => {
    if (!value.trim()) return;
    setShowPreview(true);
  };

  return (
    <View style={styles.container}>
      {replyingTo ? (
        <View style={styles.replyBanner}>
          <Text style={styles.replyText} numberOfLines={1}>
            Ответ на: {replyingTo.body ?? replyingTo.id}
          </Text>
          {onCancelReply ? (
            <TouchableOpacity onPress={onCancelReply} style={styles.replyClose} accessibilityRole="button">
              <Text style={styles.actionLabel}>✕</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      ) : null}
      {scheduledFor ? (
        <Pressable style={styles.scheduleBanner} onPress={onClearSchedule} accessibilityRole="button">
          <Text style={styles.scheduleText}>
            Сообщение будет отправлено {formatScheduledDate(scheduledFor)}. Нажмите, чтобы отменить.
          </Text>
        </Pressable>
      ) : null}
      <View style={styles.inner}>
        <TextInput
          style={styles.input}
          placeholder="Сообщение"
          placeholderTextColor={theme.colors.text.placeholder}
          value={value}
          onChangeText={next => {
            onChangeValue(next);
            if (onDraftChange) {
              const nextDraft: DraftContent = {
                ...(draftContent ?? {}),
                plain: next,
                html: renderMarkdown(next, roomMembers),
              };
              onDraftChange(next.trim() ? nextDraft : null);
            }
          }}
          multiline
          onFocus={() => setShowPreview(false)}
        />
        <View style={styles.actions}>
          {onOpenAttachmentPicker ? (
            <TouchableOpacity style={styles.actionButton} onPress={onOpenAttachmentPicker} accessibilityRole="button">
              <Text style={styles.actionLabel}>➕</Text>
            </TouchableOpacity>
          ) : null}
          {onToggleVoiceRecording ? (
            <TouchableOpacity
              style={[styles.actionButton, isRecording ? { backgroundColor: theme.colors.status.error } : null]}
              onPress={onToggleVoiceRecording}
              accessibilityRole="button"
            >
              <Text style={styles.actionLabel}>{isRecording ? '⏹' : '🎙️'}</Text>
            </TouchableOpacity>
          ) : null}
          {onOpenGifPicker || onSendSticker ? (
            <TouchableOpacity
              style={styles.actionButton}
              onPress={() => {
                if (onOpenGifPicker) {
                  onOpenGifPicker();
                }
              }}
              accessibilityRole="button"
            >
              <Text style={styles.actionLabel}>😊</Text>
            </TouchableOpacity>
          ) : null}
          {onSchedule ? (
            <TouchableOpacity style={styles.actionButton} onPress={handleOpenPreview} accessibilityRole="button">
              <Text style={styles.actionLabel}>🕒</Text>
            </TouchableOpacity>
          ) : null}
          <TouchableOpacity
            style={styles.sendButton}
            onPress={handleSend}
            disabled={isSending}
            accessibilityRole="button"
          >
            {isSending ? <ActivityIndicator color={theme.colors.text.onAccent} /> : <Text style={styles.sendText}>➤</Text>}
          </TouchableOpacity>
        </View>
      </View>
      {accessoryContent ? <View style={styles.accessory}>{accessoryContent}</View> : null}
      <Modal
        visible={showPreview}
        animationType="slide"
        transparent
        onRequestClose={() => setShowPreview(false)}
      >
        <Pressable style={styles.previewModal} onPress={() => setShowPreview(false)}>
          <Pressable style={styles.previewContent}>
            <Text style={styles.previewTitle}>Запланировать сообщение</Text>
            <Text style={styles.previewBody}>
              Размер:{' '}
              {formatFileSize(
                (typeof TextEncoder !== 'undefined'
                  ? new TextEncoder().encode(value).length
                  : new Blob([value]).size) ?? 0,
              )}
            </Text>
            <TouchableOpacity
              style={styles.previewClose}
              onPress={() => {
                setShowPreview(false);
                if (onSchedule) {
                  const scheduled: DraftContent = {
                    plain: value,
                    html: formattedPreview,
                    scheduledFor: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
                  };
                  onSchedule(scheduled);
                }
              }}
            >
              <Text style={styles.previewCloseText}>Запланировать через 5 минут</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.previewClose} onPress={() => setShowPreview(false)}>
              <Text style={styles.previewCloseText}>Отмена</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
};

export default MessageInputNative;
