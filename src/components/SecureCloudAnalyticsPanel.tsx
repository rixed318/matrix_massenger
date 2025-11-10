import React, { useMemo } from 'react';
import { formatDistanceToNow } from 'date-fns';
import type { SecureCloudAggregatedStats } from '../services/secureCloudService';
import { SECURE_CLOUD_RETENTION_BUCKETS } from '../services/secureCloudService';

interface SecureCloudAnalyticsPanelProps {
  stats: SecureCloudAggregatedStats | null;
}

const SecureCloudAnalyticsPanel: React.FC<SecureCloudAnalyticsPanelProps> = ({ stats }) => {
  const rooms = useMemo(() => {
    if (!stats) {
      return [] as SecureCloudAggregatedStats['rooms'];
    }
    return stats.rooms.slice(0, 8);
  }, [stats]);

  const maxRoomAlerts = useMemo(() => {
    if (!stats || stats.rooms.length === 0) {
      return 1;
    }
    return Math.max(...stats.rooms.map(room => room.total), 1);
  }, [stats]);

  const reasons = useMemo(() => {
    if (!stats) {
      return [] as Array<[string, number]>;
    }
    return Object.entries(stats.flags)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6);
  }, [stats]);

  const maxReasonCount = useMemo(() => {
    if (!stats) {
      return 1;
    }
    const values = Object.values(stats.flags);
    if (values.length === 0) {
      return 1;
    }
    return Math.max(...values, 1);
  }, [stats]);

  const retention = useMemo(() => {
    if (!stats) {
      return SECURE_CLOUD_RETENTION_BUCKETS.map(bucket => ({
        bucketId: bucket.id,
        label: bucket.label,
        count: 0,
      }));
    }
    return SECURE_CLOUD_RETENTION_BUCKETS.map(bucket => ({
      bucketId: bucket.id,
      label: bucket.label,
      count: stats.retention.buckets[bucket.id] ?? 0,
    }));
  }, [stats]);

  const maxRetentionCount = useMemo(() => {
    if (!retention.length) {
      return 1;
    }
    return Math.max(...retention.map(item => item.count), 1);
  }, [retention]);

  if (!stats) {
    return (
      <div className="border border-border-primary rounded-md p-6 text-sm text-text-secondary">
        Данные Secure Cloud ещё не собраны. Панель станет доступна после фиксации первых предупреждений.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h4 className="text-base font-semibold text-text-primary">Аналитика Secure Cloud</h4>
        <span className="text-xs text-text-secondary">
          Обновлено {formatDistanceToNow(stats.updatedAt, { addSuffix: true })}
        </span>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="border border-border-primary rounded-md p-4">
          <h5 className="text-sm font-semibold text-text-primary mb-3">Предупреждения по комнатам</h5>
          {rooms.length > 0 ? (
            <ul className="space-y-2">
              {rooms.map(room => {
                const ratio = Math.max(0, room.total) / maxRoomAlerts;
                const width = `${Math.round(ratio * 100)}%`;
                return (
                  <li key={room.roomId} className="space-y-1">
                    <div className="flex items-center justify-between text-xs text-text-secondary">
                      <span className="truncate" title={room.roomName}>
                        {room.roomName}
                      </span>
                      <span className="font-semibold text-text-primary">{room.total}</span>
                    </div>
                    <div className="h-2 rounded bg-bg-tertiary">
                      <div
                        className="h-2 rounded bg-accent"
                        style={{ width }}
                        aria-hidden
                      />
                    </div>
                    <div className="text-[11px] text-text-secondary flex justify-between">
                      <span>Открыто: {room.open}</span>
                      {room.lastAlertTimestamp && (
                        <span>
                          Последнее: {formatDistanceToNow(room.lastAlertTimestamp, { addSuffix: true })}
                        </span>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-sm text-text-secondary">Нет зафиксированных предупреждений по комнатам.</p>
          )}
        </div>

        <div className="border border-border-primary rounded-md p-4">
          <h5 className="text-sm font-semibold text-text-primary mb-3">Частые причины</h5>
          {reasons.length > 0 ? (
            <ul className="space-y-2">
              {reasons.map(([reason, count]) => {
                const ratio = Math.max(0, count) / maxReasonCount;
                const width = `${Math.round(ratio * 100)}%`;
                return (
                  <li key={reason} className="space-y-1">
                    <div className="flex items-center justify-between text-xs text-text-secondary">
                      <span className="truncate" title={reason}>
                        {reason}
                      </span>
                      <span className="font-semibold text-text-primary">{count}</span>
                    </div>
                    <div className="h-2 rounded bg-bg-tertiary">
                      <div className="h-2 rounded bg-emerald-500/80" style={{ width }} aria-hidden />
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-sm text-text-secondary">Причины флагов пока не собраны.</p>
          )}

          <div className="mt-4">
            <h6 className="text-xs font-semibold uppercase text-text-secondary mb-2">Действия операторов</h6>
            <ul className="grid grid-cols-2 gap-2 text-xs">
              {Object.entries(stats.actions)
                .sort((a, b) => b[1] - a[1])
                .map(([action, count]) => (
                  <li key={action} className="border border-border-primary rounded px-2 py-1 flex items-center justify-between">
                    <span className="truncate" title={action}>
                      {action}
                    </span>
                    <span className="font-semibold text-text-primary">{count}</span>
                  </li>
                ))}
            </ul>
          </div>
        </div>
      </div>

      <div className="border border-border-primary rounded-md p-4">
        <h5 className="text-sm font-semibold text-text-primary mb-3">Распределение хранения</h5>
        <div className="flex items-end gap-3 h-36">
          {retention.map(bucket => {
            const ratio = maxRetentionCount > 0 ? bucket.count / maxRetentionCount : 0;
            const height = `${Math.round(ratio * 100)}%`;
            return (
              <div key={bucket.bucketId} className="flex-1 flex flex-col items-center gap-2">
                <div
                  className="w-full bg-blue-500/70 rounded-t"
                  style={{ height }}
                  aria-hidden
                  title={`${bucket.label}: ${bucket.count}`}
                />
                <span className="text-[11px] text-center text-text-secondary leading-tight">
                  {bucket.label}
                </span>
                <span className="text-xs font-semibold text-text-primary">{bucket.count}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default SecureCloudAnalyticsPanel;
