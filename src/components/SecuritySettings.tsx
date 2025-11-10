import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { MatrixClient } from '../types';
import {
  backupRoomKeysOnce,
  ensureRoomEncryption,
  getEncryptionSessionState,
  getKeyBackupStatus,
  rotateRoomMegolmSession,
  startManagedKeyBackup,
  stopManagedKeyBackup,
  restoreRoomKeysFromBackup,
} from '../services/matrixService';
import { requestSelfVerification } from '../services/e2eeService';
import {
  getAppLockSnapshot,
  enableAppLock,
  disableAppLock,
  AppLockSnapshot,
} from '../services/appLockService';

interface SecuritySettingsProps {
  client: MatrixClient;
  isOpen: boolean;
  onClose: () => void;
  presenceHidden: boolean;
  onSetPresenceHidden: (hidden: boolean) => void;
  presenceRestricted?: boolean;
}

interface DeviceSummary {
  deviceId: string;
  displayName: string;
  lastSeenIp?: string;
  lastSeenTs?: number;
  verified: boolean;
  crossSigningVerified: boolean;
}

const qrScale = 4;

const renderQrRequestToDataUrl = async (request: any): Promise<string | null> => {
  try {
    if (!request?.inner?.generateQrCode) return null;
    if (typeof request.getOtherDevice === 'function') {
      try {
        await request.getOtherDevice();
      } catch (err) {
        console.warn('Failed to resolve verification target device', err);
      }
    }
    const inner = await request.inner.generateQrCode();
    if (!inner) return null;
    const qrObject = inner.toQrCode?.();
    if (!qrObject?.renderIntoBuffer) {
      inner.free?.();
      return null;
    }
    const buffer: Uint8ClampedArray = qrObject.renderIntoBuffer();
    const dimension = Math.round(Math.sqrt(buffer.length));
    if (!dimension || dimension * dimension !== buffer.length) {
      qrObject.free?.();
      inner.free?.();
      return null;
    }
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = dimension * qrScale;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      qrObject.free?.();
      inner.free?.();
      return null;
    }
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#000000';
    for (let y = 0; y < dimension; y += 1) {
      for (let x = 0; x < dimension; x += 1) {
        if (buffer[y * dimension + x]) {
          ctx.fillRect(x * qrScale, y * qrScale, qrScale, qrScale);
        }
      }
    }
    const dataUrl = canvas.toDataURL('image/png');
    qrObject.free?.();
    inner.free?.();
    return dataUrl;
  } catch (err) {
    console.warn('renderQrRequestToDataUrl failed', err);
    return null;
  }
};

const SecuritySettings: React.FC<SecuritySettingsProps> = ({ client, isOpen, onClose, presenceHidden, onSetPresenceHidden, presenceRestricted = false }) => {
  const [devices, setDevices] = useState<DeviceSummary[]>([]);
  const [roomsVersion, setRoomsVersion] = useState(0);
  const [passphrase, setPassphrase] = useState('');
  const [autoBackupStopper, setAutoBackupStopper] = useState<(() => void) | null>(null);
  const [backupStatus, setBackupStatus] = useState(getKeyBackupStatus());
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [devicesStatus, setDevicesStatus] = useState<string | null>(null);
  const [devicesLoading, setDevicesLoading] = useState(false);
  const [deviceToDelete, setDeviceToDelete] = useState<DeviceSummary | null>(null);
  const [deletePassword, setDeletePassword] = useState('');
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deviceToRename, setDeviceToRename] = useState<DeviceSummary | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [renameLoading, setRenameLoading] = useState(false);
  const [qrState, setQrState] = useState<{ request: any | null; dataUrl: string | null; message: string | null }>({
    request: null,
    dataUrl: null,
    message: null,
  });
  const [appLockSnapshot, setAppLockSnapshot] = useState<AppLockSnapshot>({ enabled: false, biometricEnabled: false });
  const [pinValue, setPinValue] = useState('');
  const [pinConfirm, setPinConfirm] = useState('');
  const [appLockBiometric, setAppLockBiometric] = useState(false);
  const [appLockLoading, setAppLockLoading] = useState(false);
  const isTauriRuntime = typeof window !== 'undefined' && Boolean((window as any).__TAURI__);

  const refreshAppLock = useCallback(async () => {
    try {
      const snapshot = await getAppLockSnapshot();
      setAppLockSnapshot(snapshot);
      setAppLockBiometric(snapshot.biometricEnabled);
      setPinValue('');
      setPinConfirm('');
    } catch (err) {
      console.warn('Failed to load app lock snapshot', err);
    }
  }, []);

  const refreshDevices = useCallback(async () => {
    const userId = client.getUserId();
    if (!userId) return;
    setDevicesLoading(true);
    setDevicesStatus('Обновление списка устройств...');
    try {
      const storedDevices: any[] = client.getStoredDevicesForUser?.(userId) ?? [];
      const storedMap = new Map<string, any>();
      storedDevices.forEach((device: any) => {
        const id = device.deviceId ?? device.device_id;
        if (id) storedMap.set(id, device);
      });

      let remoteDevices: any[] = [];
      if (client.getDevices) {
        try {
          const response = await client.getDevices();
          remoteDevices = response?.devices ?? [];
        } catch (err) {
          console.warn('Не удалось получить удалённые устройства', err);
        }
      }

      const seenIds = new Set<string>();
      const buildDeviceSummary = (raw: any): DeviceSummary | null => {
        const deviceId = raw?.deviceId ?? raw?.device_id;
        if (!deviceId) return null;
        const stored = storedMap.get(deviceId) ?? raw;
        const trust = client.checkDeviceTrust?.(userId, deviceId);
        const verified = Boolean(trust?.isLocallyVerified?.() || trust?.isCrossSigningVerified?.());
        return {
          deviceId,
          displayName:
            stored?.getDisplayName?.() ??
            stored?.display_name ??
            raw?.display_name ??
            raw?.displayName ??
            deviceId,
          lastSeenIp: raw?.last_seen_ip ?? raw?.lastSeenIp ?? stored?.lastSeenIp,
          lastSeenTs: raw?.last_seen_ts ?? raw?.lastSeenTs ?? stored?.lastSeenTs,
          verified,
          crossSigningVerified: Boolean(trust?.isCrossSigningVerified?.()),
        } satisfies DeviceSummary;
      };

      const mapped: DeviceSummary[] = [];
      remoteDevices.forEach((device: any) => {
        const summary = buildDeviceSummary(device);
        if (summary) {
          mapped.push(summary);
          seenIds.add(summary.deviceId);
        }
      });

      storedDevices.forEach((device: any) => {
        const deviceId = device.deviceId ?? device.device_id;
        if (!deviceId || seenIds.has(deviceId)) return;
        const summary = buildDeviceSummary(device);
        if (summary) mapped.push(summary);
      });

      mapped.sort((a, b) => a.displayName.localeCompare(b.displayName));
      setDevices(mapped);
      setDevicesStatus('Список устройств обновлён.');
    } catch (err: any) {
      setDevicesStatus('Не удалось обновить устройства.');
      setError(`Ошибка обновления устройств: ${err?.message ?? err}`);
    } finally {
      setDevicesLoading(false);
    }
  }, [client]);

  useEffect(() => {
    if (!isOpen) return;
    void refreshDevices();
    setBackupStatus(getKeyBackupStatus());
    return () => {
      setDevices([]);
    };
  }, [client, isOpen, refreshDevices]);

  useEffect(() => {
    if (!isOpen) return;
    void refreshAppLock();
  }, [isOpen, refreshAppLock]);

  useEffect(() => () => {
    autoBackupStopper?.();
    stopManagedKeyBackup();
  }, [autoBackupStopper]);

  const rooms = useMemo(() => {
    const allRooms = client.getRooms?.() ?? [];
    return allRooms
      .map((room) => {
        const state = getEncryptionSessionState(room.roomId);
        return {
          roomId: room.roomId,
          name: room.name || room.getDisplayName?.() || room.roomId,
          isEncrypted: client.isRoomEncrypted?.(room.roomId) ?? false,
          session: state ?? null,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [client, roomsVersion]);

  const handleEnsureRoomEncryption = async (roomId: string) => {
    setError(null);
    setFeedback(null);
    try {
      await ensureRoomEncryption(client, roomId, { rotationPeriodMs: 604_800_000 });
      setRoomsVersion((v) => v + 1);
      setFeedback('Шифрование комнаты обновлено.');
    } catch (err: any) {
      setError(`Не удалось включить шифрование: ${err?.message ?? err}`);
    }
  };

  const handleRotateSession = (roomId: string) => {
    setError(null);
    setFeedback(null);
    try {
      rotateRoomMegolmSession(client, roomId);
      setRoomsVersion((v) => v + 1);
      setFeedback('Сеанс шифрования будет перезапущен.');
    } catch (err: any) {
      setError(`Не удалось сбросить сеанс: ${err?.message ?? err}`);
    }
  };

  const handleMarkDeviceVerified = async (deviceId: string) => {
    setError(null);
    setFeedback(null);
    try {
      const userId = client.getUserId();
      if (!userId) throw new Error('Неизвестный пользователь.');
      await client.setDeviceVerified?.(userId, deviceId, true);
      await refreshDevices();
      setFeedback('Устройство помечено как доверенное.');
    } catch (err: any) {
      setError(`Не удалось подтвердить устройство: ${err?.message ?? err}`);
    }
  };

  const handleOpenDelete = (device: DeviceSummary) => {
    setDeviceToDelete(device);
    setDeletePassword('');
    setError(null);
    setFeedback(null);
  };

  const handleConfirmDelete = async () => {
    if (!deviceToDelete) return;
    setError(null);
    setFeedback(null);
    const userId = client.getUserId();
    if (!userId) {
      setError('Неизвестный пользователь.');
      return;
    }
    setDeleteLoading(true);
    try {
      if (client.deleteDevice) {
        if (!deletePassword) {
          throw new Error('Введите пароль для подтверждения.');
        }
        await client.deleteDevice(deviceToDelete.deviceId, {
          auth: {
            type: 'm.login.password',
            identifier: { type: 'm.id.user', user: userId },
            password: deletePassword,
          },
        } as any);
      } else if (client.setDeviceBlocked) {
        await client.setDeviceBlocked(userId, deviceToDelete.deviceId, true);
      } else {
        throw new Error('Клиент не поддерживает завершение сеансов.');
      }
      setDeviceToDelete(null);
      setDeletePassword('');
      await refreshDevices();
      setFeedback('Сеанс завершён.');
    } catch (err: any) {
      setError(`Не удалось завершить сеанс: ${err?.message ?? err}`);
    } finally {
      setDeleteLoading(false);
    }
  };

  const handleOpenRename = (device: DeviceSummary) => {
    setDeviceToRename(device);
    setRenameValue(device.displayName);
    setError(null);
    setFeedback(null);
  };

  const handleConfirmRename = async () => {
    if (!deviceToRename) return;
    setError(null);
    setFeedback(null);
    const newName = renameValue.trim();
    if (!newName) {
      setError('Введите новое имя устройства.');
      return;
    }
    if (!client.setDeviceDetails) {
      setError('Клиент не поддерживает переименование устройств.');
      return;
    }
    setRenameLoading(true);
    try {
      await client.setDeviceDetails(deviceToRename.deviceId, { display_name: newName });
      setDeviceToRename(null);
      setRenameValue('');
      await refreshDevices();
      setFeedback('Имя устройства обновлено.');
    } catch (err: any) {
      setError(`Не удалось переименовать устройство: ${err?.message ?? err}`);
    } finally {
      setRenameLoading(false);
    }
  };

  const handleBackupNow = async () => {
    setError(null);
    setFeedback(null);
    if (!passphrase) {
      setError('Введите пароль для резервного копирования ключей.');
      return;
    }
    try {
      await backupRoomKeysOnce(client, passphrase);
      setBackupStatus(getKeyBackupStatus());
      setFeedback('Ключи успешно сохранены в защищённое хранилище.');
    } catch (err: any) {
      setError(`Не удалось выполнить резервное копирование: ${err?.message ?? err}`);
    }
  };

  const handleRestore = async () => {
    setError(null);
    setFeedback(null);
    if (!passphrase) {
      setError('Введите пароль, используемый при резервном копировании.');
      return;
    }
    try {
      const restored = await restoreRoomKeysFromBackup(client, passphrase);
      if (restored) {
        setFeedback('Ключи расшифрованы и импортированы.');
      } else {
        setError('Не найдено резервных копий или пароль неверный.');
      }
    } catch (err: any) {
      setError(`Ошибка восстановления ключей: ${err?.message ?? err}`);
    }
  };

  const handleToggleAutoBackup = () => {
    setError(null);
    setFeedback(null);
    if (autoBackupStopper) {
      autoBackupStopper();
      setAutoBackupStopper(null);
      stopManagedKeyBackup();
      setBackupStatus(getKeyBackupStatus());
      setFeedback('Фоновое резервное копирование остановлено.');
      return;
    }
    if (!passphrase) {
      setError('Укажите пароль для автоматического резервного копирования.');
      return;
    }
    const stopper = startManagedKeyBackup(client, async () => passphrase);
    setAutoBackupStopper(() => stopper);
    setBackupStatus(getKeyBackupStatus());
    setFeedback('Фоновое резервное копирование включено.');
  };

  const handleEnableAppLock = async () => {
    if (!isTauriRuntime) {
      setError('Блокировка приложения доступна только в настольном приложении.');
      return;
    }
    if (pinValue.length < 4) {
      setError('PIN должен содержать минимум 4 цифры.');
      return;
    }
    if (pinValue !== pinConfirm) {
      setError('PIN и подтверждение не совпадают.');
      return;
    }
    setAppLockLoading(true);
    setError(null);
    setFeedback(null);
    try {
      await enableAppLock(pinValue, appLockBiometric);
      setFeedback('Блокировка приложения включена. Скрытые чаты будут доступны только после разблокировки.');
      await refreshAppLock();
    } catch (err: any) {
      setError(`Не удалось включить блокировку: ${err?.message ?? err}`);
    } finally {
      setAppLockLoading(false);
    }
  };

  const handleDisableAppLock = async () => {
    if (!isTauriRuntime) return;
    setAppLockLoading(true);
    setError(null);
    setFeedback(null);
    try {
      await disableAppLock();
      setFeedback('Блокировка приложения выключена.');
      await refreshAppLock();
    } catch (err: any) {
      setError(`Не удалось отключить блокировку: ${err?.message ?? err}`);
    } finally {
      setAppLockLoading(false);
    }
  };

  const handleStartQrVerification = async () => {
    setError(null);
    setFeedback(null);
    try {
      const req = await requestSelfVerification(client);
      const dataUrl = await renderQrRequestToDataUrl(req);
      if (!dataUrl) {
        setError('Не удалось построить QR-код.');
        return;
      }
      setQrState({ request: req, dataUrl, message: 'Отсканируйте QR-код доверенным устройством.' });
    } catch (err: any) {
      setError(`Ошибка запуска проверки: ${err?.message ?? err}`);
    }
  };

  const handleCancelQr = async () => {
    try {
      await qrState.request?.cancel?.();
    } catch (err) {
      console.warn('cancel verification failed', err);
    }
    setQrState({ request: null, dataUrl: null, message: null });
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-bg-secondary/60 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-bg-primary rounded-lg shadow-xl w-full max-w-4xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="p-6 border-b border-border-primary flex items-center justify-between">
          <h2 className="text-xl font-bold">Безопасность</h2>
          <button className="text-text-secondary hover:text-text-primary" onClick={onClose}>Закрыть</button>
        </div>
        <div className="p-6 space-y-8">
          {(feedback || error) && (
            <div className={`p-3 rounded-md ${error ? 'bg-red-500/10 text-red-400' : 'bg-emerald-500/10 text-emerald-400'}`}>
              {error ?? feedback}
            </div>
          )}

          <section className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-semibold text-text-primary">Блокировка приложения</h3>
                <p className="text-sm text-text-secondary">
                  Защитите скрытые чаты PIN-кодом и, при поддержке системы, биометрией. Настройка хранится в защищённом хранилище Tauri.
                </p>
                {appLockSnapshot.updatedAt && (
                  <p className="text-xs text-text-secondary mt-1">
                    Обновлено {formatDistanceToNow(appLockSnapshot.updatedAt, { addSuffix: true })}
                  </p>
                )}
                {!isTauriRuntime && (
                  <p className="text-xs text-amber-400 mt-1">
                    Доступно только в настольном приложении.
                  </p>
                )}
              </div>
              <div className="flex flex-col items-end gap-2">
                <span className={`px-3 py-1 rounded-full text-xs font-semibold ${appLockSnapshot.enabled ? 'bg-emerald-500/10 text-emerald-300' : 'bg-bg-tertiary text-text-secondary'}`}>
                  {appLockSnapshot.enabled ? 'Включена' : 'Выключена'}
                </span>
                {appLockSnapshot.enabled && (
                  <button
                    onClick={handleDisableAppLock}
                    className="text-xs text-red-400 hover:text-red-300"
                    disabled={appLockLoading || !isTauriRuntime}
                  >
                    Отключить
                  </button>
                )}
              </div>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <label className="block">
                <span className="block text-sm font-medium text-text-secondary mb-1">Новый PIN</span>
                <input
                  type="password"
                  value={pinValue}
                  onChange={e => setPinValue(e.target.value.replace(/\D+/g, ''))}
                  maxLength={12}
                  className="w-full bg-bg-secondary text-text-primary px-3 py-2 rounded-md border border-border-primary focus:outline-none focus:ring-1 focus:ring-ring-focus"
                  placeholder="Введите 4-12 цифр"
                  inputMode="numeric"
                  disabled={!isTauriRuntime || appLockLoading}
                />
              </label>
              <label className="block">
                <span className="block text-sm font-medium text-text-secondary mb-1">Подтверждение PIN</span>
                <input
                  type="password"
                  value={pinConfirm}
                  onChange={e => setPinConfirm(e.target.value.replace(/\D+/g, ''))}
                  maxLength={12}
                  className="w-full bg-bg-secondary text-text-primary px-3 py-2 rounded-md border border-border-primary focus:outline-none focus:ring-1 focus:ring-ring-focus"
                  placeholder="Повторите PIN"
                  inputMode="numeric"
                  disabled={!isTauriRuntime || appLockLoading}
                />
              </label>
            </div>
            <div className="flex items-center gap-3">
              <input
                id="app-lock-biometric"
                type="checkbox"
                className="h-4 w-4"
                checked={appLockBiometric}
                onChange={e => setAppLockBiometric(e.target.checked)}
                disabled={!isTauriRuntime || appLockLoading}
              />
              <label htmlFor="app-lock-biometric" className="text-sm text-text-secondary">
                Разрешить разблокировку через биометрию (если поддерживается ОС)
              </label>
            </div>
            <div className="flex flex-wrap gap-3">
              <button
                onClick={handleEnableAppLock}
                className="px-4 py-2 bg-accent text-text-inverted rounded-md hover:bg-accent/90 disabled:opacity-50"
                disabled={!isTauriRuntime || appLockLoading}
              >
                Сохранить PIN
              </button>
              {appLockSnapshot.enabled && (
                <span className="text-xs text-text-secondary self-center">
                  При смене PIN скрытые чаты потребуют повторной разблокировки.
                </span>
              )}
            </div>
          </section>

          <section className="space-y-4">
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-1">
                <h3 className="text-lg font-semibold text-text-primary">Присутствие</h3>
                <p className="text-sm text-text-secondary">
                  Управляйте видимостью вашего статуса онлайн. При скрытии вы будете отображаться офлайн для остальных пользователей.
                </p>
                {presenceRestricted && (
                  <p className="text-xs text-amber-400">
                    В некоторых комнатах требуются повышенные права для отправки событий <code>m.presence</code>. Это может ограничить передачу статуса.
                  </p>
                )}
              </div>
              <label className="flex items-center gap-3">
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  checked={presenceHidden}
                  onChange={e => onSetPresenceHidden(e.target.checked)}
                />
                <span className="text-sm text-text-secondary">Скрыть мой онлайн-статус</span>
              </label>
            </div>
          </section>

          <section>
            <h3 className="text-lg font-semibold text-text-primary mb-4">Устройства</h3>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-border-primary text-sm">
                <thead className="bg-bg-tertiary">
                  <tr>
                    <th className="px-4 py-2 text-left font-semibold">Устройство</th>
                    <th className="px-4 py-2 text-left font-semibold">Последняя активность</th>
                    <th className="px-4 py-2 text-left font-semibold">Статус</th>
                    <th className="px-4 py-2"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border-primary">
                  {devices.map((device) => (
                    <tr key={device.deviceId}>
                      <td className="px-4 py-2">
                        <div className="font-medium text-text-primary">{device.displayName}</div>
                        <div className="text-xs text-text-secondary">ID: {device.deviceId}</div>
                      </td>
                      <td className="px-4 py-2 text-text-secondary">
                        {device.lastSeenTs
                          ? `${formatDistanceToNow(device.lastSeenTs, { addSuffix: true })}${device.lastSeenIp ? ` · ${device.lastSeenIp}` : ''}`
                          : '—'}
                      </td>
                      <td className="px-4 py-2">
                        {device.verified ? (
                          <span className="inline-flex items-center gap-1 px-2 py-1 rounded bg-emerald-500/10 text-emerald-400">
                            <span className="w-2 h-2 bg-emerald-400 rounded-full" /> Подтверждено
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-1 rounded bg-amber-500/10 text-amber-400">
                            <span className="w-2 h-2 bg-amber-400 rounded-full" /> Не подтверждено
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2">
                        <div className="flex flex-col sm:flex-row sm:justify-end gap-2">
                          {!device.verified && (
                            <button
                              onClick={() => handleMarkDeviceVerified(device.deviceId)}
                              className="px-3 py-1 rounded-md bg-accent text-white hover:bg-accent/90 disabled:opacity-50"
                              disabled={devicesLoading}
                            >
                              Пометить доверенным
                            </button>
                          )}
                          <button
                            onClick={() => handleOpenRename(device)}
                            className="px-3 py-1 rounded-md border border-border-primary hover:bg-bg-tertiary disabled:opacity-50"
                            disabled={devicesLoading}
                          >
                            Переименовать
                          </button>
                          <button
                            onClick={() => handleOpenDelete(device)}
                            className="px-3 py-1 rounded-md border border-red-500 text-red-400 hover:bg-red-500/10 disabled:opacity-50"
                            disabled={devicesLoading}
                          >
                            Завершить сеанс
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {devices.length === 0 && (
                    <tr>
                      <td className="px-4 py-6 text-center text-text-secondary" colSpan={4}>
                        Нет сохранённых устройств. Они появятся после первой синхронизации.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
              {devicesStatus && (
                <div className="px-4 py-2 text-xs text-text-secondary">{devicesStatus}</div>
              )}
            </div>
          </section>

          <section>
            <h3 className="text-lg font-semibold text-text-primary mb-4">Шифрование комнат</h3>
            <div className="space-y-3">
              {rooms.map((room) => (
                <div key={room.roomId} className="border border-border-primary rounded-md p-4 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                  <div>
                    <div className="font-medium text-text-primary">{room.name}</div>
                    <div className="text-xs text-text-secondary">{room.roomId}</div>
                    <div className="text-xs text-text-secondary mt-1">
                      {room.isEncrypted ? 'E2EE включено' : 'Комната не зашифрована'}
                      {room.session?.lastPreparedAt && (
                        <span className="ml-2">· подготовлено {formatDistanceToNow(room.session.lastPreparedAt, { addSuffix: true })}</span>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleEnsureRoomEncryption(room.roomId)}
                      className="px-3 py-1 rounded-md border border-border-primary hover:bg-bg-tertiary"
                    >
                      Обновить ключ
                    </button>
                    <button
                      onClick={() => handleRotateSession(room.roomId)}
                      className="px-3 py-1 rounded-md border border-border-primary hover:bg-bg-terтиary"
                    >
                      Сбросить сеанс
                    </button>
                  </div>
                </div>
              ))}
              {rooms.length === 0 && (
                <div className="text-text-secondary">Комнаты ещё не загружены.</div>
              )}
            </div>
          </section>

          <section>
            <h3 className="text-lg font-semibold text-text-primary mb-4">Резервное копирование ключей</h3>
            <div className="space-y-3">
              <input
                type="password"
                value={passphrase}
                onChange={(e) => setPassphrase(e.target.value)}
                placeholder="Пароль для шифрования резервной копии"
                className="w-full px-3 py-2 rounded-md border border-border-primary bg-bg-secondary text-text-primary focus:outline-none focus:ring-2 focus:ring-accent/50"
              />
              <div className="flex flex-wrap gap-2">
                <button onClick={handleBackupNow} className="px-4 py-2 rounded-md bg-accent text-white hover:bg-accent/90">
                  Сохранить сейчас
                </button>
                <button onClick={handleRestore} className="px-4 py-2 rounded-md border border-border-primary hover:bg-bg-tertiary">
                  Восстановить
                </button>
                <button onClick={handleToggleAutoBackup} className="px-4 py-2 rounded-md border border-border-primary hover:bg-bg-terтиary">
                  {autoBackupStopper ? 'Остановить авто-резервное копирование' : 'Включить авто-резервное копирование'}
                </button>
              </div>
              <div className="text-sm text-text-secondary">
                {backupStatus.lastBackupAt
                  ? `Последняя копия: ${formatDistanceToNow(backupStatus.lastBackupAt, { addSuffix: true })}`
                  : 'Резервные копии ещё не создавались.'}
              </div>
            </div>
          </section>

          <section>
            <h3 className="text-lg font-semibold text-text-primary mb-4">QR-подтверждение</h3>
            <div className="space-y-3">
              {qrState.dataUrl ? (
                <div className="flex flex-col items-center gap-3">
                  <img src={qrState.dataUrl} alt="QR для подтверждения" className="w-64 h-64 border border-border-primary rounded" />
                  <p className="text-sm text-text-secondary text-center max-w-md">
                    {qrState.message ?? 'Отсканируйте код доверенным устройством, чтобы подтвердить это устройство.'}
                  </p>
                  <button onClick={handleCancelQr} className="px-4 py-2 rounded-md border border-border-primary hover:bg-bg-tertiary">
                    Отменить
                  </button>
                </div>
              ) : (
                <button onClick={handleStartQrVerification} className="px-4 py-2 rounded-md bg-accent text-white hover:bg-accent/90">
                  Показать QR для подтверждения
                </button>
              )}
            </div>
          </section>
        </div>
      </div>
      {deviceToDelete && (
        <div className="fixed inset-0 bg-bg-secondary/70 flex items-center justify-center z-[60]" onClick={() => {
          if (!deleteLoading) {
            setDeviceToDelete(null);
            setDeletePassword('');
          }
        }}>
          <div
            className="bg-bg-primary rounded-lg shadow-xl w-full max-w-md p-6 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h4 className="text-lg font-semibold text-text-primary">Завершить сеанс</h4>
            <p className="text-sm text-text-secondary">
              Подтвердите завершение сеанса для устройства «{deviceToDelete.displayName}». Для удаления потребуется пароль от аккаунта.
            </p>
            {client.deleteDevice && (
              <input
                type="password"
                placeholder="Введите пароль для подтверждения"
                value={deletePassword}
                onChange={(e) => setDeletePassword(e.target.value)}
                className="w-full px-3 py-2 rounded-md border border-border-primary bg-bg-secondary text-text-primary focus:outline-none focus:ring-2 focus:ring-accent/50"
                disabled={deleteLoading}
              />
            )}
            <div className="flex justify-end gap-2">
              <button
                onClick={() => {
                  if (!deleteLoading) {
                    setDeviceToDelete(null);
                    setDeletePassword('');
                  }
                }}
                className="px-3 py-1 rounded-md border border-border-primary hover:bg-bg-tertiary disabled:opacity-50"
                disabled={deleteLoading}
              >
                Отмена
              </button>
              <button
                onClick={handleConfirmDelete}
                className="px-3 py-1 rounded-md bg-red-500 text-white hover:bg-red-500/90 disabled:opacity-50"
                disabled={deleteLoading}
              >
                Подтвердить завершение
              </button>
            </div>
          </div>
        </div>
      )}
      {deviceToRename && (
        <div className="fixed inset-0 bg-bg-secondary/70 flex items-center justify-center z-[60]" onClick={() => {
          if (!renameLoading) {
            setDeviceToRename(null);
            setRenameValue('');
          }
        }}>
          <div
            className="bg-bg-primary rounded-lg shadow-xl w-full max-w-md p-6 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h4 className="text-lg font-semibold text-text-primary">Переименовать устройство</h4>
            <input
              type="text"
              placeholder="Новое имя устройства"
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              className="w-full px-3 py-2 rounded-md border border-border-primary bg-bg-secondary text-text-primary focus:outline-none focus:ring-2 focus:ring-accent/50"
              disabled={renameLoading}
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => {
                  if (!renameLoading) {
                    setDeviceToRename(null);
                    setRenameValue('');
                  }
                }}
                className="px-3 py-1 rounded-md border border-border-primary hover:bg-bg-tertiary disabled:opacity-50"
                disabled={renameLoading}
              >
                Отмена
              </button>
              <button
                onClick={handleConfirmRename}
                className="px-3 py-1 rounded-md bg-accent text-white hover:bg-accent/90 disabled:opacity-50"
                disabled={renameLoading}
              >
                Сохранить имя
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SecuritySettings;
