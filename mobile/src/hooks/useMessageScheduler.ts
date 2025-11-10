import { useCallback, useEffect, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { DraftContent } from '@matrix-messenger/core';

const STORAGE_KEY = '@matrix-messenger/scheduled-messages';

type ScheduleRecord = {
  id: string;
  roomId: string;
  content: DraftContent;
};

type ScheduleMap = Record<string, ScheduleRecord>;

const randomId = () => Math.random().toString(36).slice(2, 10);

const parseRecords = (raw: string | null): ScheduleMap => {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as ScheduleMap;
    if (parsed && typeof parsed === 'object') {
      return parsed;
    }
  } catch (error) {
    console.warn('Failed to parse schedule store', error);
  }
  return {};
};

export const useMessageScheduler = (roomId: string | null) => {
  const [records, setRecords] = useState<ScheduleMap>({});
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then(raw => {
        setRecords(parseRecords(raw));
        setHydrated(true);
      })
      .catch(error => {
        console.warn('schedule hydration failed', error);
        setHydrated(true);
      });
  }, []);

  const persist = useCallback(async (next: ScheduleMap) => {
    setRecords(next);
    try {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch (error) {
      console.warn('schedule persistence failed', error);
    }
  }, []);

  const upcoming = useMemo(() => {
    if (!roomId) return [];
    return Object.values(records)
      .filter(item => item.roomId === roomId)
      .sort((a, b) => {
        const aDate = Date.parse(a.content.scheduledFor ?? '');
        const bDate = Date.parse(b.content.scheduledFor ?? '');
        return aDate - bDate;
      });
  }, [records, roomId]);

  const scheduleMessage = useCallback(
    (content: DraftContent) => {
      if (!roomId) return;
      const id = randomId();
      void persist({ ...records, [id]: { id, roomId, content } });
    },
    [persist, records, roomId],
  );

  const cancelSchedule = useCallback(
    (id: string) => {
      const { [id]: _removed, ...rest } = records;
      void persist(rest);
    },
    [persist, records],
  );

  const clearRoomSchedules = useCallback(() => {
    if (!roomId) return;
    const next: ScheduleMap = {};
    Object.values(records).forEach(record => {
      if (record.roomId !== roomId) {
        next[record.id] = record;
      }
    });
    void persist(next);
  }, [persist, records, roomId]);

  return {
    hydrated,
    upcoming,
    scheduleMessage,
    cancelSchedule,
    clearRoomSchedules,
  } as const;
};
