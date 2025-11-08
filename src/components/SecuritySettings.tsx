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

interface SecuritySettingsProps {
  client: MatrixClient;
  isOpen: boolean;
  onClose: () => void;
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

const SecuritySettings: React.FC<SecuritySettingsProps> = ({ client, isOpen, onClose }) => {
  const [devices, setDevices] = useState<DeviceSummary[]>([]);
  const [roomsVersion, setRoomsVersion] = useState(0);
  const [passphrase, setPassphrase] = useState('');
  const [autoBackupStopper, setAutoBackupStopper] = useState<(() => void) | null>(null);
  const [backupStatus, setBackupStatus] = useState(getKeyBackupStatus());
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [qrState, setQrState] = useState<{ request: any | null; dataUrl: string | null; message: string | null }>({
    request: null,
    dataUrl: null,
    message: null,
  });

  const refreshDevices = useCallback(() => {
    const userId = client.getUserId();
    if (!userId) return;
    const rawDevices: any[] = client.getStoredDevicesForUser?.(userId) ?? [];
    const mapped = rawDevices.map((device) => {
      const trust = client.checkDeviceTrust?.(userId, device.deviceId);
      const verified = Boolean(trust?.isLocallyVerified?.() || trust?.isCrossSigningVerified?.());
      return {
        deviceId: device.deviceId,
        displayName: device.getDisplayName?.() || device.deviceId,
        lastSeenIp: device.lastSeenIp,
        lastSeenTs: device.lastSeenTs,
        verified,
        crossSigningVerified: Boolean(trust?.isCrossSigningVerified?.()),
      } satisfies DeviceSummary;
    });
    setDevices(mapped);
  }, [client]);

  useEffect(() => {
    if (!isOpen) return;
    refreshDevices();
    setBackupStatus(getKeyBackupStatus());
    return () => {
      setDevices([]);
    };
  }, [client, isOpen, refreshDevices]);

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
      refreshDevices();
      setFeedback('Устройство помечено как доверенное.');
    } catch (err: any) {
      setError(`Не удалось подтвердить устройство: ${err?.message ?? err}`);
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
                      <td className="px-4 py-2 text-right">
                        {!device.verified && (
                          <button
                            onClick={() => handleMarkDeviceVerified(device.deviceId)}
                            className="px-3 py-1 rounded-md bg-accent text-white hover:bg-accent/90"
                          >
                            Пометить доверенным
                          </button>
                        )}
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
    </div>
  );
};

export default SecuritySettings;
