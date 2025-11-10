export const SECURE_CLOUD_EXPORT_RANGE_PRESETS = [
  { id: 'all', label: 'Всё время', durationMs: null },
  { id: '24h', label: 'Последние 24 часа', durationMs: 24 * 60 * 60 * 1000 },
  { id: '7d', label: 'Последние 7 дней', durationMs: 7 * 24 * 60 * 60 * 1000 },
  { id: '30d', label: 'Последние 30 дней', durationMs: 30 * 24 * 60 * 60 * 1000 },
  { id: '90d', label: 'Последние 90 дней', durationMs: 90 * 24 * 60 * 60 * 1000 },
] as const;

export type SecureCloudExportRangeId = (typeof SECURE_CLOUD_EXPORT_RANGE_PRESETS)[number]['id'];
