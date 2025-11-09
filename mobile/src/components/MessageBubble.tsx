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
  return (
    <View style={[styles.container, isOwn ? styles.ownContainer : styles.otherContainer]}>
      <View style={[styles.bubble, isOwn ? styles.ownBubble : styles.otherBubble]}>
        <Text style={[styles.body, isOwn ? styles.ownText : styles.otherText]}>
          {message.content.body}
        </Text>
        {renderAttachment(message)}
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
});
