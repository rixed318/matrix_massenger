import React from 'react';
import { Image, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { Message } from '@matrix-messenger/core';

interface MessageBubbleProps {
  message: Message;
  isOwn: boolean;
}

const openLink = async (url: string) => {
  try {
    const supported = await Linking.canOpenURL(url);
    if (supported) {
      await Linking.openURL(url);
    }
  } catch (error) {
    console.warn('Failed to open link', error);
  }
};

const renderAttachment = (message: Message) => {
  const content = message.content;
  if (!content.url) {
    return null;
  }

  const mime = content.info?.mimetype ?? '';
  if (mime.startsWith('image/')) {
    return <Image source={{ uri: content.url }} style={styles.image} />;
  }

  return (
    <Pressable onPress={() => openLink(content.url)} accessibilityRole="button">
      <Text style={styles.link}>Открыть вложение</Text>
    </Pressable>
  );
};

export const MessageBubble: React.FC<MessageBubbleProps> = ({ message, isOwn }) => {
  const renderTranscript = () => {
    const transcript = message.transcript;
    if (!transcript) return null;
    if (message.content.msgtype !== 'm.audio' && message.content.msgtype !== 'm.video') return null;
    const languageLabel = transcript.language ? ` (${transcript.language.toUpperCase()})` : '';
    return (
      <View style={styles.transcriptContainer}>
        <Text style={styles.transcriptTitle}>Транскрипт{languageLabel}</Text>
        {transcript.status === 'pending' && (
          <Text style={styles.transcriptPending}>Обработка аудио...</Text>
        )}
        {transcript.status === 'error' && (
          <Text style={styles.transcriptError}>Ошибка: {transcript.error ?? 'Не удалось получить транскрипт'}</Text>
        )}
        {transcript.status === 'completed' && transcript.text && (
          <Text style={styles.transcriptBody}>{transcript.text}</Text>
        )}
      </View>
    );
  };

  return (
    <View style={[styles.container, isOwn ? styles.ownContainer : styles.otherContainer]}>
      <View style={[styles.bubble, isOwn ? styles.ownBubble : styles.otherBubble]}>
        <Text style={[styles.body, isOwn ? styles.ownText : styles.otherText]}>
          {message.content.body}
        </Text>
        {renderAttachment(message)}
        {renderTranscript()}
        <Text style={[styles.timestamp, isOwn ? styles.ownTimestamp : styles.otherTimestamp]}>
          {new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    marginVertical: 4,
    paddingHorizontal: 16,
  },
  ownContainer: {
    justifyContent: 'flex-end',
  },
  otherContainer: {
    justifyContent: 'flex-start',
  },
  bubble: {
    maxWidth: '80%',
    borderRadius: 18,
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 8,
  },
  ownBubble: {
    backgroundColor: '#3A7EFB',
    borderBottomRightRadius: 4,
  },
  otherBubble: {
    backgroundColor: '#182743',
    borderBottomLeftRadius: 4,
  },
  body: {
    fontSize: 16,
  },
  ownText: {
    color: '#fff',
  },
  otherText: {
    color: '#d0ddf5',
  },
  timestamp: {
    fontSize: 12,
    textAlign: 'right',
  },
  ownTimestamp: {
    color: '#d8e6ff',
  },
  otherTimestamp: {
    color: '#9ba9c5',
  },
  image: {
    width: 180,
    height: 180,
    borderRadius: 12,
  },
  link: {
    color: '#88aaff',
    textDecorationLine: 'underline',
  },
  transcriptContainer: {
    marginTop: 8,
    padding: 8,
    borderRadius: 10,
    backgroundColor: 'rgba(0, 0, 0, 0.1)',
    gap: 4,
  },
  transcriptTitle: {
    fontSize: 12,
    fontWeight: '600',
    color: '#c0c9e6',
  },
  transcriptPending: {
    fontSize: 12,
    fontStyle: 'italic',
    color: '#c0c9e6',
  },
  transcriptError: {
    fontSize: 12,
    color: '#ff8080',
  },
  transcriptBody: {
    fontSize: 13,
    color: '#d0ddf5',
  },
});
