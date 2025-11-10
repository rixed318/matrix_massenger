import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import SecureCloudAnalyticsPanel from '../../src/components/SecureCloudAnalyticsPanel';
import { SECURE_CLOUD_RETENTION_BUCKETS, type SecureCloudAggregatedStats } from '../../src/services/secureCloudService';

describe('SecureCloudAnalyticsPanel', () => {
  it('renders room, reason and retention charts', () => {
    const stats: SecureCloudAggregatedStats = {
      totalFlagged: 4,
      openNotices: 1,
      flags: { 'detector:test': 3, 'detector:spam': 1 },
      actions: { flagged: 4, acknowledged: 1 },
      rooms: [
        { roomId: '!alpha:example.org', roomName: 'Alpha', total: 3, open: 1, lastAlertTimestamp: Date.now() - 5000 },
        { roomId: '!beta:example.org', roomName: 'Beta', total: 1, open: 0, lastAlertTimestamp: Date.now() - 10_000 },
      ],
      retention: {
        count: 4,
        averageMs: 2_400_000,
        minMs: 600_000,
        maxMs: 3_600_000,
        buckets: SECURE_CLOUD_RETENTION_BUCKETS.reduce<Record<string, number>>((acc, bucket, index) => {
          acc[bucket.id] = index;
          return acc;
        }, {}),
        policyDays: 30,
      },
      updatedAt: Date.now(),
    };

    render(<SecureCloudAnalyticsPanel stats={stats} />);

    expect(screen.getByText('Alpha')).toBeInTheDocument();
    expect(screen.getByText('detector:test')).toBeInTheDocument();
    expect(screen.queryByText('Экспорт логов Secure Cloud')).toBeNull();
    SECURE_CLOUD_RETENTION_BUCKETS.forEach(bucket => {
      expect(screen.getByText(bucket.label)).toBeInTheDocument();
    });
  });

  it('renders placeholder when stats are null', () => {
    render(<SecureCloudAnalyticsPanel stats={null} />);
    expect(
      screen.getByText(/данные secure cloud ещё не собраны/i),
    ).toBeInTheDocument();
  });
});
