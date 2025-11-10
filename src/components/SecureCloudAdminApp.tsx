import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { useAccountStore } from '../services/accountManager';
import {
  exportSecureCloudAggregatedStats,
  exportSuspiciousEventsLog,
  getSecureCloudAggregatedStats,
  subscribeSecureCloudAggregatedStats,
  type SecureCloudAggregatedStats,
  type SecureCloudLogFormat,
} from '../services/secureCloudService';
import SecureCloudAnalyticsPanel from './SecureCloudAnalyticsPanel';
import { SECURE_CLOUD_EXPORT_RANGE_PRESETS, type SecureCloudExportRangeId } from '../constants/secureCloud';

const SecureCloudAdminApp: React.FC = () => {
  const accounts = useAccountStore(state => state.accounts);
  const activeKey = useAccountStore(state => state.activeKey);
  const setActiveKey = useAccountStore(state => state.setActiveKey);
  const boot = useAccountStore(state => state.boot);
  const isBooting = useAccountStore(state => state.isBooting);

  const [stats, setStats] = useState<SecureCloudAggregatedStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [exportFormat, setExportFormat] = useState<SecureCloudLogFormat>('json');
  const [analyticsFormat, setAnalyticsFormat] = useState<SecureCloudLogFormat>('json');
  const [exportRoom, setExportRoom] = useState<string>('all');
  const [exportRange, setExportRange] = useState<SecureCloudExportRangeId>('all');

  useEffect(() => {
    void boot();
  }, [boot]);

  const accountEntries = useMemo(() => Object.entries(accounts), [accounts]);

  useEffect(() => {
    if (!activeKey && accountEntries.length > 0) {
      setActiveKey(accountEntries[0][0]);
    }
  }, [activeKey, accountEntries, setActiveKey]);

  const activeRuntime = activeKey ? accounts[activeKey] : accountEntries[0]?.[1] ?? null;
  const activeClient = activeRuntime?.client ?? null;

  useEffect(() => {
    if (!activeClient) {
      setStats(null);
      return;
    }
    const snapshot = getSecureCloudAggregatedStats(activeClient);
    setStats(snapshot);
    const unsubscribe = subscribeSecureCloudAggregatedStats(activeClient, setStats);
    return () => unsubscribe();
  }, [activeClient]);

  const roomOptions = useMemo(() => {
    if (!stats) {
      return [] as Array<{ roomId: string; roomName: string }>;
    }
    const seen = new Set<string>();
    return stats.rooms.filter(room => {
      if (seen.has(room.roomId)) {
        return false;
      }
      seen.add(room.roomId);
      return true;
    }).map(room => ({ roomId: room.roomId, roomName: room.roomName }));
  }, [stats]);

  useEffect(() => {
    if (exportRoom === 'all') {
      return;
    }
    if (!roomOptions.some(option => option.roomId === exportRoom)) {
      setExportRoom('all');
    }
  }, [exportRoom, roomOptions]);

  const handleExportLogs = useCallback(() => {
    if (!activeClient) {
      setError('Нет активного клиента для экспорта.');
      return;
    }
    setError(null);
    setFeedback(null);
    try {
      const now = Date.now();
      const range = SECURE_CLOUD_EXPORT_RANGE_PRESETS.find(item => item.id === exportRange);
      const fromTimestamp = range?.durationMs ? Math.max(0, now - range.durationMs) : undefined;
      const toTimestamp = range?.durationMs ? now : undefined;
      const roomId = exportRoom === 'all' ? undefined : exportRoom;
      const payload = exportSuspiciousEventsLog(activeClient, {
        format: exportFormat,
        roomId,
        fromTimestamp,
        toTimestamp,
      });
      if (typeof window === 'undefined') {
        console.info('Secure Cloud admin export:\n', payload);
        setFeedback('Экспорт логов доступен в консоли.');
        return;
      }
      const extension = exportFormat === 'csv' ? 'csv' : 'json';
      const blob = new Blob([payload], {
        type: exportFormat === 'csv' ? 'text/csv;charset=utf-8' : 'application/json;charset=utf-8',
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      link.download = `secure-cloud-admin-log-${timestamp}.${extension}`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      setFeedback('Экспорт логов завершён.');
    } catch (err: any) {
      console.error('Admin log export failed', err);
      setError(`Не удалось экспортировать логи: ${err?.message ?? err}`);
    }
  }, [activeClient, exportFormat, exportRange, exportRoom]);

  const handleExportAnalytics = useCallback(() => {
    if (!activeClient) {
      setError('Нет активного клиента для экспорта аналитики.');
      return;
    }
    setError(null);
    setFeedback(null);
    try {
      const payload = exportSecureCloudAggregatedStats(activeClient, { format: analyticsFormat });
      if (typeof window === 'undefined') {
        console.info('Secure Cloud analytics export:\n', payload);
        setFeedback('Экспорт аналитики доступен в консоли.');
        return;
      }
      const extension = analyticsFormat === 'csv' ? 'csv' : 'json';
      const blob = new Blob([payload], {
        type: analyticsFormat === 'csv' ? 'text/csv;charset=utf-8' : 'application/json;charset=utf-8',
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      link.download = `secure-cloud-admin-analytics-${timestamp}.${extension}`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      setFeedback('Экспорт аналитики завершён.');
    } catch (err: any) {
      console.error('Admin analytics export failed', err);
      setError(`Не удалось экспортировать аналитику: ${err?.message ?? err}`);
    }
  }, [activeClient, analyticsFormat]);

  if (isBooting) {
    return (
      <div className="min-h-screen bg-bg-secondary text-text-primary flex items-center justify-center">
        <div className="animate-spin rounded-full h-16 w-16 border-t-2 border-b-2 border-accent"></div>
        <span className="ml-4 text-xl">Загрузка клиентов…</span>
      </div>
    );
  }

  if (accountEntries.length === 0 || !activeRuntime || !activeClient) {
    return (
      <div className="min-h-screen bg-bg-primary text-text-primary flex flex-col items-center justify-center gap-4">
        <h1 className="text-2xl font-semibold">Secure Cloud Admin</h1>
        <p className="text-sm text-text-secondary max-w-md text-center">
          Нет активных подключений. Откройте основное приложение и выполните вход, чтобы просматривать аналитику Secure Cloud.
        </p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-bg-primary text-text-primary px-6 py-8 space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Secure Cloud Admin</h1>
          <p className="text-sm text-text-secondary">Мониторинг предупреждений и экспорт аналитики в реальном времени.</p>
        </div>
        {accountEntries.length > 1 && (
          <div className="flex flex-col gap-1 text-sm">
            <label htmlFor="admin-account" className="text-text-secondary">Аккаунт</label>
            <select
              id="admin-account"
              value={activeRuntime.creds.key}
              onChange={(e) => setActiveKey(e.target.value)}
              className="min-w-[240px] rounded-md border border-border-primary bg-bg-secondary px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent/50"
            >
              {accountEntries.map(([key, runtime]) => (
                <option key={key} value={key}>
                  {runtime.creds.user_id} · {runtime.creds.homeserver_url}
                </option>
              ))}
            </select>
          </div>
        )}
      </header>

      {(feedback || error) && (
        <div className={`rounded-md px-4 py-3 text-sm ${error ? 'bg-red-500/10 text-red-300' : 'bg-emerald-500/10 text-emerald-300'}`}>
          {error ?? feedback}
        </div>
      )}

      <section className="space-y-4">
        <div className="grid gap-3 md:grid-cols-3">
          <div className="border border-border-primary rounded-md p-4">
            <div className="text-xs uppercase text-text-secondary tracking-wide">Всего флагов</div>
            <div className="text-2xl font-semibold">{stats?.totalFlagged ?? 0}</div>
            {stats && (
              <div className="text-xs text-text-secondary mt-1">Обновлено {formatDistanceToNow(stats.updatedAt, { addSuffix: true })}</div>
            )}
          </div>
          <div className="border border-border-primary rounded-md p-4">
            <div className="text-xs uppercase text-text-secondary tracking-wide">Открытые инциденты</div>
            <div className="text-2xl font-semibold">{stats?.openNotices ?? 0}</div>
            <div className="text-xs text-text-secondary mt-1">В обработке операторов</div>
          </div>
          <div className="border border-border-primary rounded-md p-4">
            <div className="text-xs uppercase text-text-secondary tracking-wide">Средний срок хранения</div>
            <div className="text-2xl font-semibold">{stats ? `${Math.round((stats.retention.averageMs ?? 0) / (1000 * 60))} мин` : '—'}</div>
            <div className="text-xs text-text-secondary mt-1">
              Политика: {stats?.retention.policyDays != null ? `${stats.retention.policyDays} д` : 'по умолчанию'}
            </div>
          </div>
        </div>

        <SecureCloudAnalyticsPanel stats={stats ?? null} />

        <div className="border border-border-primary rounded-md p-4 space-y-4">
          <h2 className="text-base font-semibold text-text-primary">Экспорт данных</h2>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-3">
              <div>
                <label htmlFor="admin-export-room" className="block text-xs font-medium uppercase text-text-secondary">Комната</label>
                <select
                  id="admin-export-room"
                  value={exportRoom}
                  onChange={(e) => setExportRoom(e.target.value)}
                  className="mt-1 w-full rounded-md border border-border-primary bg-bg-secondary px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/50"
                >
                  <option value="all">Все комнаты</option>
                  {roomOptions.map(room => (
                    <option key={room.roomId} value={room.roomId}>
                      {room.roomName}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="admin-export-range" className="block text-xs font-medium uppercase text-text-secondary">Диапазон времени</label>
                <select
                  id="admin-export-range"
                  value={exportRange}
                  onChange={(e) => setExportRange(e.target.value as SecureCloudExportRangeId)}
                  className="mt-1 w-full rounded-md border border-border-primary bg-bg-secondary px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/50"
                >
                  {SECURE_CLOUD_EXPORT_RANGE_PRESETS.map(range => (
                    <option key={range.id} value={range.id}>
                      {range.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="admin-export-format" className="block text-xs font-medium uppercase text-text-secondary">Формат логов</label>
                <select
                  id="admin-export-format"
                  value={exportFormat}
                  onChange={(e) => setExportFormat(e.target.value as SecureCloudLogFormat)}
                  className="mt-1 w-full rounded-md border border-border-primary bg-bg-secondary px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/50"
                >
                  <option value="json">JSON</option>
                  <option value="csv">CSV</option>
                </select>
              </div>
              <button
                onClick={handleExportLogs}
                className="inline-flex items-center justify-center rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent/90"
              >
                Экспорт логов
              </button>
            </div>
            <div className="space-y-3">
              <div>
                <label htmlFor="admin-analytics-format" className="block text-xs font-medium uppercase text-text-secondary">Формат аналитики</label>
                <select
                  id="admin-analytics-format"
                  value={analyticsFormat}
                  onChange={(e) => setAnalyticsFormat(e.target.value as SecureCloudLogFormat)}
                  className="mt-1 w-full rounded-md border border-border-primary bg-bg-secondary px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/50"
                >
                  <option value="json">JSON</option>
                  <option value="csv">CSV</option>
                </select>
              </div>
              <button
                onClick={handleExportAnalytics}
                className="inline-flex items-center justify-center rounded-md border border-border-primary px-4 py-2 text-sm font-medium text-text-primary hover:bg-bg-tertiary"
              >
                Экспорт аналитики
              </button>
              <div className="text-xs text-text-secondary leading-relaxed">
                Экспорт выполняется локально. Файлы сохраняются через механизм загрузки браузера и доступны сразу после формирования.
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
};

export default SecureCloudAdminApp;
