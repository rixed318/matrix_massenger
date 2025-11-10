import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { getTheme, spacing, radii, typography } from '@matrix-messenger/ui-tokens';
import type { InboxEntry } from '../hooks/useUniversalInbox';

type InboxCategory = InboxEntry['key'];

interface UniversalInboxProps {
  entries: InboxEntry[];
  active: InboxCategory | 'all';
  onSelect: (key: InboxCategory | 'all') => void;
}

const theme = getTheme('dark');

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: spacing.sm,
  },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radii.lg,
    backgroundColor: theme.colors.surface.elevated,
  },
  chipActive: {
    backgroundColor: theme.colors.accent.primary,
  },
  chipText: {
    ...typography.caption,
    color: theme.colors.text.primary,
  },
  chipTextActive: {
    color: theme.colors.text.onAccent,
  },
});

export const UniversalInbox: React.FC<UniversalInboxProps> = ({ entries, active, onSelect }) => {
  return (
    <View style={styles.container}>
      <TouchableOpacity
        style={[styles.chip, active === 'all' && styles.chipActive]}
        onPress={() => onSelect('all')}
        accessibilityRole="button"
      >
        <Text style={[styles.chipText, active === 'all' && styles.chipTextActive]}>Все</Text>
      </TouchableOpacity>
      {entries.map(entry => (
        <TouchableOpacity
          key={entry.key}
          style={[styles.chip, active === entry.key && styles.chipActive]}
          onPress={() => onSelect(entry.key)}
          accessibilityRole="button"
        >
          <Text style={[styles.chipText, active === entry.key && styles.chipTextActive]}>
            {entry.key === 'unread' ? 'Непрочитанные' : entry.key === 'mentions' ? 'Упоминания' : 'Secure Cloud'} · {entry.count}
          </Text>
        </TouchableOpacity>
      ))}
    </View>
  );
};
