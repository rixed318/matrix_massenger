import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Modal,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import type { Gif, GifFavorite, GifSearchHistoryEntry, Sticker } from '@matrix-messenger/core';
import { getTheme, spacing, radii, typography } from '@matrix-messenger/ui-tokens';
import {
  appendGifHistory,
  getTrendingMobileGifs,
  loadGifFavorites,
  loadGifHistory,
  searchMobileGifs,
  toggleGifFavoriteMobile,
} from '../services/gifPicker';
import { LOCAL_STICKERS } from '../assets/localStickers';

interface GifStickerPickerProps {
  visible: boolean;
  onClose: () => void;
  onSelectGif: (gif: Gif) => void;
  onSelectSticker: (sticker: Sticker) => void;
}

type TabKey = 'stickers' | 'gifs' | 'favorites';

const theme = getTheme('dark');

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: '#000000aa',
    justifyContent: 'flex-end',
  },
  panel: {
    maxHeight: '75%',
    backgroundColor: theme.colors.surface.primary,
    borderTopLeftRadius: radii.xl,
    borderTopRightRadius: radii.xl,
    padding: spacing.md,
  },
  tabs: {
    flexDirection: 'row',
    marginBottom: spacing.sm,
  },
  tab: {
    marginRight: spacing.sm,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    borderRadius: radii.lg,
    backgroundColor: theme.colors.surface.elevated,
  },
  tabActive: {
    backgroundColor: theme.colors.accent.primary,
  },
  tabText: {
    ...typography.caption,
    color: theme.colors.text.primary,
  },
  tabTextActive: {
    color: theme.colors.text.onAccent,
  },
  search: {
    backgroundColor: theme.colors.surface.elevated,
    borderRadius: radii.lg,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    color: theme.colors.text.primary,
    marginBottom: spacing.sm,
  },
  list: {
    flexGrow: 0,
  },
  item: {
    width: 96,
    height: 96,
    borderRadius: radii.md,
    overflow: 'hidden',
    marginRight: spacing.sm,
    marginBottom: spacing.sm,
    backgroundColor: theme.colors.surface.elevated,
    alignItems: 'center',
    justifyContent: 'center',
  },
  gifPreview: {
    width: '100%',
    height: '100%',
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: spacing.lg,
  },
  emptyText: {
    color: theme.colors.text.secondary,
    ...typography.caption,
  },
  history: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: spacing.sm,
  },
  historyChip: {
    backgroundColor: theme.colors.surface.elevated,
    borderRadius: radii.lg,
    paddingVertical: 4,
    paddingHorizontal: spacing.sm,
    marginRight: spacing.xs,
    marginBottom: spacing.xs,
  },
  historyText: {
    color: theme.colors.text.secondary,
    ...typography.caption,
  },
  favoriteBadge: {
    position: 'absolute',
    top: spacing.xs,
    right: spacing.xs,
    backgroundColor: theme.colors.surface.primary,
    borderRadius: radii.sm,
    paddingHorizontal: 4,
    paddingVertical: 2,
  },
  favoriteText: {
    color: theme.colors.text.primary,
    fontSize: 10,
  },
});

export const GifStickerPicker: React.FC<GifStickerPickerProps> = ({ visible, onClose, onSelectGif, onSelectSticker }) => {
  const [tab, setTab] = useState<TabKey>('stickers');
  const [gifs, setGifs] = useState<Gif[]>([]);
  const [favorites, setFavorites] = useState<GifFavorite[]>([]);
  const [history, setHistory] = useState<GifSearchHistoryEntry[]>([]);
  const [query, setQuery] = useState('');
  const [isLoading, setLoading] = useState(false);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    const run = async () => {
      try {
        setLoading(true);
        const [fav, hist] = await Promise.all([loadGifFavorites(), loadGifHistory()]);
        if (cancelled) return;
        setFavorites(fav);
        setHistory(hist);
        const result = await getTrendingMobileGifs({ limit: 24 });
        if (cancelled) return;
        setGifs(result.items);
      } catch (error) {
        console.warn('Failed to bootstrap gif picker', error);
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [visible]);

  useEffect(() => {
    if (!visible || tab !== 'gifs') return;
    const handle = setTimeout(async () => {
      try {
        setLoading(true);
        const result = query
          ? await searchMobileGifs(query, { limit: 24 })
          : await getTrendingMobileGifs({ limit: 24 });
        setGifs(result.items);
        if (query && !result.fromCache && !result.error) {
          setHistory(await appendGifHistory(query));
        }
      } catch (error) {
        console.warn('Gif fetch failed', error);
      } finally {
        setLoading(false);
      }
    }, 300);
    return () => clearTimeout(handle);
  }, [query, tab, visible]);

  const favoriteIds = useMemo(() => new Set(favorites.map(item => item.id)), [favorites]);

  const renderItem = ({ item }: { item: Gif | Sticker }) => {
    const isGif = !('packId' in item);
    const isFavorite = isGif && favoriteIds.has((item as Gif).id);
    return (
      <TouchableOpacity
        style={styles.item}
        onPress={() => {
          if (!isGif) {
            onSelectSticker(item as Sticker);
          } else {
            onSelectGif(item as Gif);
          }
          onClose();
        }}
        onLongPress={async () => {
          if (!isGif) return;
          try {
            const next = await toggleGifFavoriteMobile(item as Gif);
            setFavorites(next);
          } catch (error) {
            console.warn('Failed to toggle favorite', error);
          }
        }}
        accessibilityRole="button"
      >
        {isGif ? (
          <Image source={{ uri: (item as Gif).url }} style={styles.gifPreview} resizeMode="cover" />
        ) : (
          <Image source={{ uri: (item as Sticker).url }} style={styles.gifPreview} resizeMode="cover" />
        )}
        {isFavorite ? (
          <View style={styles.favoriteBadge}>
            <Text style={styles.favoriteText}>★</Text>
          </View>
        ) : null}
      </TouchableOpacity>
    );
  };

  const data = useMemo(() => {
    if (tab === 'stickers') return LOCAL_STICKERS;
    if (tab === 'favorites') return favorites;
    return gifs;
  }, [favorites, gifs, tab]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <TouchableOpacity style={{ flex: 1 }} onPress={onClose} accessibilityRole="button" />
        <View style={styles.panel}>
          <View style={styles.tabs}>
            {(
              [
                { key: 'stickers', label: 'Стикеры' },
                { key: 'gifs', label: 'GIF' },
                { key: 'favorites', label: 'Избранное' },
              ] as { key: TabKey; label: string }[]
            ).map(item => (
              <TouchableOpacity
                key={item.key}
                style={[styles.tab, tab === item.key && styles.tabActive]}
                onPress={() => setTab(item.key)}
                accessibilityRole="tab"
              >
                <Text style={[styles.tabText, tab === item.key && styles.tabTextActive]}>{item.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
          {tab === 'gifs' ? (
            <TextInput
              placeholder="Поиск GIF"
              placeholderTextColor={theme.colors.text.placeholder}
              value={query}
              onChangeText={setQuery}
              style={styles.search}
            />
          ) : null}
          {tab === 'gifs' && history.length ? (
            <View style={styles.history}>
              {history.map(entry => (
                <TouchableOpacity key={entry.query} style={styles.historyChip} onPress={() => setQuery(entry.query)}>
                  <Text style={styles.historyText}>{entry.query}</Text>
                </TouchableOpacity>
              ))}
            </View>
          ) : null}
          {isLoading ? (
            <View style={styles.emptyState}>
              <ActivityIndicator color={theme.colors.text.primary} />
            </View>
          ) : data.length ? (
            <FlatList
              data={data}
              numColumns={3}
              keyExtractor={item => ('id' in item ? item.id : String(item.url))}
              renderItem={renderItem}
              contentContainerStyle={styles.list}
            />
          ) : (
            <View style={styles.emptyState}>
              <Text style={styles.emptyText}>Ничего не найдено</Text>
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
};
