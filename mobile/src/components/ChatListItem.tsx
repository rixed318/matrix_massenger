import React from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { Room } from '@matrix-messenger/core';

interface ChatListItemProps {
  room: Room & { lastMessagePreview?: string | null; lastMessageAt?: number | null };
  onPress: () => void;
}

const formatTimestamp = (timestamp?: number | null) => {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
};

export const ChatListItem: React.FC<ChatListItemProps> = ({ room, onPress }) => {
  return (
    <Pressable onPress={onPress} style={styles.container} accessibilityRole="button">
      {room.avatarUrl ? (
        <Image source={{ uri: room.avatarUrl }} style={styles.avatar} />
      ) : (
        <View style={styles.avatarPlaceholder}>
          <Text style={styles.avatarLetter}>{room.name?.[0]?.toUpperCase() ?? '?'}</Text>
        </View>
      )}
      <View style={styles.content}>
        <View style={styles.header}>
          <Text style={styles.title} numberOfLines={1}>
            {room.isSavedMessages ? 'Saved Messages' : room.name}
          </Text>
          <Text style={styles.time}>{formatTimestamp((room as any).lastMessageAt)}</Text>
        </View>
        <Text style={styles.preview} numberOfLines={1}>
          {(room as any).lastMessagePreview ?? 'Нет сообщений'}
        </Text>
      </View>
      {room.unreadCount > 0 ? (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{room.unreadCount}</Text>
        </View>
      ) : null}
    </Pressable>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    backgroundColor: '#101d35',
    borderRadius: 16,
    marginBottom: 12,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    marginRight: 12,
  },
  avatarPlaceholder: {
    width: 48,
    height: 48,
    borderRadius: 24,
    marginRight: 12,
    backgroundColor: '#1f2a44',
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarLetter: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
  },
  content: {
    flex: 1,
    gap: 4,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
    flex: 1,
    marginRight: 12,
  },
  time: {
    color: '#9ba9c5',
    fontSize: 12,
  },
  preview: {
    color: '#9ba9c5',
    fontSize: 14,
  },
  badge: {
    backgroundColor: '#3A7EFB',
    borderRadius: 16,
    minWidth: 26,
    paddingHorizontal: 8,
    paddingVertical: 4,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 12,
  },
  badgeText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 12,
  },
});
