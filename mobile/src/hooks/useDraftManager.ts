import { useCallback, useEffect, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { DraftContent } from '@matrix-messenger/core';

const STORAGE_KEY = '@matrix-messenger/drafts';

type DraftMap = Record<string, DraftContent>;

const parseDraftMap = (raw: string | null): DraftMap => {
  if (!raw) return {};
  try {
    const value = JSON.parse(raw) as DraftMap;
    if (value && typeof value === 'object') {
      return value;
    }
  } catch (error) {
    console.warn('Failed to parse draft map', error);
  }
  return {};
};

const serialize = (value: DraftMap) => JSON.stringify(value);

export const useDraftManager = (roomId: string | null) => {
  const [drafts, setDrafts] = useState<DraftMap>({});
  const [isHydrated, setHydrated] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then(raw => {
        setDrafts(parseDraftMap(raw));
        setHydrated(true);
      })
      .catch(error => {
        console.warn('Draft hydration failed', error);
        setHydrated(true);
      });
  }, []);

  const persist = useCallback(async (next: DraftMap) => {
    setDrafts(next);
    try {
      await AsyncStorage.setItem(STORAGE_KEY, serialize(next));
    } catch (error) {
      console.warn('Draft persistence failed', error);
    }
  }, []);

  const currentDraft = useMemo(() => {
    if (!roomId) return null;
    return drafts[roomId] ?? null;
  }, [drafts, roomId]);

  const updateDraft = useCallback(
    (value: DraftContent | null) => {
      if (!roomId) return;
      if (!value) {
        const { [roomId]: _removed, ...rest } = drafts;
        void persist(rest);
        return;
      }
      void persist({ ...drafts, [roomId]: value });
    },
    [drafts, persist, roomId],
  );

  return {
    isHydrated,
    currentDraft,
    updateDraft,
    clearDraft: () => updateDraft(null),
  } as const;
};
