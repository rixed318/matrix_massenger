import React from 'react';
import { Image, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { Message, MAP_ZOOM_DEFAULT, buildStaticMapUrl, buildExternalNavigationUrl, formatCoordinate, sanitizeZoom } from '@matrix-messenger/core';

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

const renderLocationAttachment = (message: Message) => {
  const location = message.location;
  if (!location) {
    return null;
  }
  const latitude = location.latitude ?? 0;
  const longitude = location.longitude ?? 0;
  const zoom = sanitizeZoom(location.zoom ?? MAP_ZOOM_DEFAULT);
  const mapUrl = location.thumbnailUrl ?? buildStaticMapUrl(latitude, longitude, zoom, 640, 360);
  const navigationUrl = location.externalUrl ?? buildExternalNavigationUrl(latitude, longitude, zoom);
  const accuracy = location.accuracy;
  const description = location.description || message.content.body || 'Поделился локацией';

  const handleOpen = () => {
    void openLink(navigationUrl);
  };

  return (
    <View style={styles.locationContainer}>
      <Text style={styles.locationTitle}>{description}</Text>
      <Pressable onPress={handleOpen} accessibilityRole="imagebutton" style={styles.mapPreview}>
        <Image source={{ uri: mapUrl }} style={styles.mapImage} />
      </Pressable>
      <View style={styles.locationMetaRow}>
        <Text style={styles.metaText}>Широта: {formatCoordinate(latitude)}</Text>
        <Text style={styles.metaText}>Долгота: {formatCoordinate(longitude)}</Text>
      </View>
      {typeof accuracy === 'number' && Number.isFinite(accuracy) && (
        <Text style={styles.metaText}>Точность: ±{Math.round(accuracy)} м</Text>
      )}
      <Pressable onPress={handleOpen} accessibilityRole="button" style={styles.locationButton}>
        <Text style={styles.locationButtonText}>Открыть в навигаторе</Text>
      </Pressable>
    </View>
  );
};

const renderAttachment = (message: Message) => {
  if (message.content.msgtype === 'm.location' && message.location) {
    return renderLocationAttachment(message);
  }

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
  locationContainer: {
    gap: 8,
  },
  locationTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#d0ddf5',
  },
  mapPreview: {
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  mapImage: {
    width: '100%',
    height: 160,
  },
  locationMetaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  metaText: {
    fontSize: 12,
    color: '#9ba9c5',
  },
  locationButton: {
    marginTop: 4,
    alignSelf: 'flex-start',
    backgroundColor: '#3A7EFB',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  locationButtonText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
  },
});
