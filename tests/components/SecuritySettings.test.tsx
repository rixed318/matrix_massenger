import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import SecuritySettings from '../../src/components/SecuritySettings';
import type { MatrixClient } from '../../src/types';

vi.mock('../../src/services/matrixService', () => ({
  backupRoomKeysOnce: vi.fn(),
  ensureRoomEncryption: vi.fn(),
  getEncryptionSessionState: vi.fn(() => null),
  getKeyBackupStatus: vi.fn(() => ({ lastBackupAt: null })),
  rotateRoomMegolmSession: vi.fn(),
  startManagedKeyBackup: vi.fn(() => () => {}),
  stopManagedKeyBackup: vi.fn(),
  restoreRoomKeysFromBackup: vi.fn(),
}));

vi.mock('../../src/services/e2eeService', () => ({
  requestSelfVerification: vi.fn(),
}));

const createMockClient = (overrides: Partial<MatrixClient> = {}): MatrixClient => {
  const trust = {
    isLocallyVerified: vi.fn(() => false),
    isCrossSigningVerified: vi.fn(() => false),
  };

  const base = {
    getUserId: () => '@user:test',
    getDevices: vi.fn().mockResolvedValue({
      devices: [
        {
          device_id: 'DEVICE-1',
          display_name: 'Мой ноутбук',
          last_seen_ip: '127.0.0.1',
          last_seen_ts: 1_700_000_000_000,
        },
      ],
    }),
    getStoredDevicesForUser: vi.fn(() => [
      {
        deviceId: 'DEVICE-1',
        getDisplayName: () => 'Мой ноутбук',
        lastSeenIp: '127.0.0.1',
        lastSeenTs: 1_700_000_000_000,
      },
    ]),
    checkDeviceTrust: vi.fn(() => trust),
    getRooms: vi.fn(() => []),
    isRoomEncrypted: vi.fn(() => false),
    deleteDevice: vi.fn().mockResolvedValue(undefined),
    setDeviceBlocked: vi.fn().mockResolvedValue(undefined),
    setDeviceDetails: vi.fn().mockResolvedValue(undefined),
    setDeviceVerified: vi.fn().mockResolvedValue(undefined),
  } as Partial<MatrixClient>;

  return { ...base, ...overrides } as MatrixClient;
};

describe('SecuritySettings device management', () => {
  it('terminates a session after confirmation', async () => {
    const getDevices = vi
      .fn()
      .mockResolvedValueOnce({
        devices: [
          {
            device_id: 'DEVICE-1',
            display_name: 'Мой ноутбук',
            last_seen_ip: '127.0.0.1',
            last_seen_ts: 1_700_000_000_000,
          },
        ],
      })
      .mockResolvedValueOnce({ devices: [] })
      .mockResolvedValue({ devices: [] });

    const deleteDevice = vi.fn().mockResolvedValue(undefined);
    const client = createMockClient({ getDevices, deleteDevice });

    render(<SecuritySettings client={client} isOpen onClose={vi.fn()} />);

    await waitFor(() => expect(screen.getByText('Мой ноутбук')).toBeInTheDocument());

    fireEvent.click(screen.getByText('Завершить сеанс'));
    const passwordInput = screen.getByPlaceholderText('Введите пароль для подтверждения');
    fireEvent.change(passwordInput, { target: { value: 'secret123' } });
    fireEvent.click(screen.getByText('Подтвердить завершение'));

    await waitFor(() => expect(deleteDevice).toHaveBeenCalledWith('DEVICE-1', expect.anything()));
    await waitFor(() => expect(getDevices).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByText('Сеанс завершён.')).toBeInTheDocument());
  });

  it('renames a device and refreshes list', async () => {
    const getDevices = vi
      .fn()
      .mockResolvedValueOnce({
        devices: [
          {
            device_id: 'DEVICE-1',
            display_name: 'Мой ноутбук',
            last_seen_ip: '127.0.0.1',
            last_seen_ts: 1_700_000_000_000,
          },
        ],
      })
      .mockResolvedValueOnce({
        devices: [
          {
            device_id: 'DEVICE-1',
            display_name: 'Новый ноутбук',
            last_seen_ip: '127.0.0.1',
            last_seen_ts: 1_700_000_000_000,
          },
        ],
      })
      .mockResolvedValue({
        devices: [
          {
            device_id: 'DEVICE-1',
            display_name: 'Новый ноутбук',
            last_seen_ip: '127.0.0.1',
            last_seen_ts: 1_700_000_000_000,
          },
        ],
      });

    const setDeviceDetails = vi.fn().mockResolvedValue(undefined);
    const client = createMockClient({ getDevices, setDeviceDetails });

    render(<SecuritySettings client={client} isOpen onClose={vi.fn()} />);

    await waitFor(() => expect(screen.getByText('Мой ноутбук')).toBeInTheDocument());

    fireEvent.click(screen.getByText('Переименовать'));
    const nameInput = screen.getByPlaceholderText('Новое имя устройства');
    fireEvent.change(nameInput, { target: { value: 'Новый ноутбук' } });
    fireEvent.click(screen.getByText('Сохранить имя'));

    await waitFor(() => expect(setDeviceDetails).toHaveBeenCalledWith('DEVICE-1', { display_name: 'Новый ноутбук' }));
    await waitFor(() => expect(getDevices).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByText('Имя устройства обновлено.')).toBeInTheDocument());
  });
});
