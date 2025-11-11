const STORAGE_KEY = 'app-lock/config';
const SESSION_FLAG = 'matrix-messenger:app-lock:session';
const BIOMETRIC_KEY = 'app-lock/biometric';
const TEMPORARY_PIN_WINDOW_MS = 10 * 60 * 1000;
const MAX_TEMP_WINDOWS = 10;

interface SecureStorageInvocation {
  command: string;
  args?: Record<string, unknown>;
}

export interface TemporaryPinWindow {
  start: number;
  expiresAt: number;
}

export interface TravelModeRecord {
  enabled: boolean;
  autoDeactivateTimeoutMs?: number | null;
  autoDeactivateAt?: number | null;
  autoLogout?: boolean;
  clearCacheOnEnable?: boolean;
  temporaryPinWindows: TemporaryPinWindow[];
  updatedAt: number;
}

export interface AppLockRecord {
  salt: string;
  pinHash: string;
  secret: string;
  biometricEnabled: boolean;
  updatedAt: number;
  travelMode?: TravelModeRecord;
}

export interface TravelModeSnapshot {
  enabled: boolean;
  autoDeactivateTimeoutMs?: number | null;
  autoDeactivateAt?: number | null;
  autoLogout?: boolean;
  clearCacheOnEnable?: boolean;
  temporaryPinWindows: TemporaryPinWindow[];
  updatedAt?: number;
}

export interface AppLockSnapshot {
  enabled: boolean;
  biometricEnabled: boolean;
  updatedAt?: number;
  travelMode: TravelModeSnapshot;
}

export interface EnableTravelModeOptions {
  autoDeactivateTimeoutMs?: number | null;
  autoLogout?: boolean;
  clearCacheOnEnable?: boolean;
  temporaryPinWindows?: TemporaryPinWindow[];
}

export interface UnlockResult {
  success: boolean;
  error?: string;
}

const isTauriRuntime = (): boolean =>
  typeof window !== 'undefined' && typeof (window as any).__TAURI__?.invoke === 'function';

const callSecureStorage = async <T = unknown>({ command, args = {} }: SecureStorageInvocation): Promise<T> => {
  if (!isTauriRuntime()) {
    throw new Error('Secure storage is only available in Tauri runtime');
  }
  return (window as any).__TAURI__.invoke(`plugin:secure-storage|${command}`, args) as Promise<T>;
};

const toBase64 = (bytes: Uint8Array): string => {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  if (typeof btoa === 'function') {
    return btoa(binary);
  }
  const nodeBuffer = (globalThis as any).Buffer;
  if (nodeBuffer) {
    return nodeBuffer.from(bytes).toString('base64');
  }
  throw new Error('No base64 encoder available');
};

const fromBase64 = (value: string): Uint8Array => {
  if (typeof atob === 'function') {
    const binary = atob(value);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      out[i] = binary.charCodeAt(i);
    }
    return out;
  }
  const nodeBuffer = (globalThis as any).Buffer;
  if (nodeBuffer) {
    return new Uint8Array(nodeBuffer.from(value, 'base64'));
  }
  throw new Error('No base64 decoder available');
};

const bufferToBase64 = (buffer: ArrayBuffer): string => toBase64(new Uint8Array(buffer));

const randomBytes = (length: number): Uint8Array => {
  const buffer = new Uint8Array(length);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(buffer);
    return buffer;
  }
  for (let i = 0; i < length; i += 1) {
    buffer[i] = Math.floor(Math.random() * 256);
  }
  return buffer;
};

const hashPin = async (pin: string, saltBase64: string): Promise<string> => {
  if (typeof crypto === 'undefined' || !crypto.subtle) {
    throw new Error('WebCrypto API недоступен');
  }
  const encoder = new TextEncoder();
  const salt = fromBase64(saltBase64);
  const payload = new Uint8Array(salt.length + pin.length);
  payload.set(salt, 0);
  payload.set(encoder.encode(pin), salt.length);
  const digest = await crypto.subtle.digest('SHA-256', payload);
  return bufferToBase64(digest);
};

const EMPTY_TRAVEL_MODE: TravelModeRecord = {
  enabled: false,
  autoDeactivateTimeoutMs: null,
  autoDeactivateAt: null,
  autoLogout: false,
  clearCacheOnEnable: false,
  temporaryPinWindows: [],
  updatedAt: 0,
};

const sanitizePinWindows = (windows: TemporaryPinWindow[] = []): TemporaryPinWindow[] => {
  if (!Array.isArray(windows)) return [];
  const now = Date.now();
  return windows
    .filter(window => {
      if (!window || typeof window !== 'object') return false;
      const start = Number(window.start);
      const expiresAt = Number(window.expiresAt);
      if (!Number.isFinite(start) || !Number.isFinite(expiresAt)) return false;
      return expiresAt > now - 5 * 60 * 1000; // drop windows expired long ago
    })
    .map(window => ({
      start: Number(window.start),
      expiresAt: Number(window.expiresAt),
    }))
    .sort((a, b) => a.start - b.start);
};

const normalizeTravelMode = (payload?: TravelModeRecord | null): TravelModeRecord => {
  if (!payload || typeof payload !== 'object') {
    return { ...EMPTY_TRAVEL_MODE };
  }
  const sanitized: TravelModeRecord = {
    enabled: Boolean(payload.enabled),
    autoDeactivateTimeoutMs:
      typeof payload.autoDeactivateTimeoutMs === 'number' && Number.isFinite(payload.autoDeactivateTimeoutMs)
        ? payload.autoDeactivateTimeoutMs
        : null,
    autoDeactivateAt:
      typeof payload.autoDeactivateAt === 'number' && Number.isFinite(payload.autoDeactivateAt)
        ? payload.autoDeactivateAt
        : null,
    autoLogout: Boolean(payload.autoLogout),
    clearCacheOnEnable: Boolean(payload.clearCacheOnEnable),
    temporaryPinWindows: sanitizePinWindows(payload.temporaryPinWindows),
    updatedAt: typeof payload.updatedAt === 'number' && Number.isFinite(payload.updatedAt) ? payload.updatedAt : Date.now(),
  };
  if (!sanitized.enabled) {
    sanitized.autoDeactivateAt = null;
    sanitized.temporaryPinWindows = [];
  }
  return sanitized;
};

const mergeTravelMode = (record: AppLockRecord): TravelModeRecord => normalizeTravelMode(record.travelMode);

const toTravelModeSnapshot = (travel: TravelModeRecord | undefined): TravelModeSnapshot => {
  const normalized = normalizeTravelMode(travel);
  return {
    enabled: normalized.enabled,
    autoDeactivateTimeoutMs: normalized.autoDeactivateTimeoutMs ?? null,
    autoDeactivateAt: normalized.autoDeactivateAt ?? null,
    autoLogout: Boolean(normalized.autoLogout),
    clearCacheOnEnable: Boolean(normalized.clearCacheOnEnable),
    temporaryPinWindows: sanitizePinWindows(normalized.temporaryPinWindows),
    updatedAt: normalized.updatedAt,
  };
};

const appendTemporaryPinWindow = async (
  record: AppLockRecord,
  durationMs: number,
  now: number = Date.now(),
): Promise<void> => {
  if (!record.travelMode) return;
  const travelMode = mergeTravelMode(record);
  if (!travelMode.enabled) return;
  const expiresAt = now + Math.max(0, durationMs);
  const windows = sanitizePinWindows([...travelMode.temporaryPinWindows, { start: now, expiresAt }]);
  const limited = windows.slice(-MAX_TEMP_WINDOWS);
  record.travelMode = {
    ...travelMode,
    temporaryPinWindows: limited,
    updatedAt: now,
  };
  await writeRecord(record);
};

const readRecord = async (): Promise<AppLockRecord | null> => {
  try {
    const raw = await callSecureStorage<string | null>({ command: 'get', args: { key: STORAGE_KEY } });
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const record = parsed as AppLockRecord;
    record.travelMode = mergeTravelMode(record);
    return record;
  } catch (error) {
    console.warn('Failed to read app lock record', error);
    return null;
  }
};

const writeRecord = async (record: AppLockRecord): Promise<void> => {
  const payload: AppLockRecord = {
    ...record,
    travelMode: mergeTravelMode(record),
  };
  await callSecureStorage({ command: 'set', args: { key: STORAGE_KEY, value: JSON.stringify(payload) } });
};

const clearSessionFlag = () => {
  try {
    sessionStorage.removeItem(SESSION_FLAG);
  } catch (error) {
    console.warn('Failed to clear session flag', error);
  }
};

const setSessionFlag = () => {
  try {
    sessionStorage.setItem(SESSION_FLAG, JSON.stringify({ unlockedAt: Date.now() }));
  } catch (error) {
    console.warn('Failed to persist session flag', error);
  }
};

export const isSessionUnlocked = (): boolean => {
  try {
    const raw = sessionStorage.getItem(SESSION_FLAG);
    if (!raw) return false;
    const parsed = JSON.parse(raw);
    return typeof parsed?.unlockedAt === 'number';
  } catch (error) {
    return false;
  }
};

export const getAppLockSnapshot = async (): Promise<AppLockSnapshot> => {
  const record = await readRecord();
  if (!record) {
    clearSessionFlag();
    return { enabled: false, biometricEnabled: false, travelMode: toTravelModeSnapshot(undefined) };
  }
  let travelMode = mergeTravelMode(record);
  if (travelMode.enabled && travelMode.autoDeactivateAt && travelMode.autoDeactivateAt <= Date.now()) {
    travelMode = { ...travelMode, enabled: false, autoDeactivateAt: null, temporaryPinWindows: [] };
    record.travelMode = travelMode;
    await writeRecord(record);
  }
  return {
    enabled: true,
    biometricEnabled: Boolean(record.biometricEnabled),
    updatedAt: record.updatedAt,
    travelMode: toTravelModeSnapshot(travelMode),
  };
};

export const getTravelModeSnapshot = async (): Promise<TravelModeSnapshot> => {
  const snapshot = await getAppLockSnapshot();
  return snapshot.travelMode;
};

export const enableTravelMode = async (options: EnableTravelModeOptions = {}): Promise<TravelModeSnapshot> => {
  if (!isTauriRuntime()) {
    throw new Error('Travel mode requires Tauri runtime');
  }
  const record = await readRecord();
  if (!record) {
    throw new Error('Включите блокировку приложения перед активацией Travel Mode');
  }

  const now = Date.now();
  const previous = mergeTravelMode(record);
  const autoDeactivateTimeoutMs =
    typeof options.autoDeactivateTimeoutMs === 'number' && Number.isFinite(options.autoDeactivateTimeoutMs)
      ? options.autoDeactivateTimeoutMs
      : previous.autoDeactivateTimeoutMs ?? null;
  const autoDeactivateAt = autoDeactivateTimeoutMs ? now + autoDeactivateTimeoutMs : null;
  const temporaryPinWindows = sanitizePinWindows(
    options.temporaryPinWindows ?? previous.temporaryPinWindows ?? [],
  );

  const travelMode: TravelModeRecord = {
    enabled: true,
    autoDeactivateTimeoutMs,
    autoDeactivateAt,
    autoLogout: typeof options.autoLogout === 'boolean' ? options.autoLogout : previous.autoLogout ?? false,
    clearCacheOnEnable:
      typeof options.clearCacheOnEnable === 'boolean' ? options.clearCacheOnEnable : previous.clearCacheOnEnable ?? false,
    temporaryPinWindows,
    updatedAt: now,
  };

  record.travelMode = travelMode;
  await writeRecord(record);

  clearSessionFlag();
  return toTravelModeSnapshot(travelMode);
};

export const disableTravelMode = async (): Promise<void> => {
  if (!isTauriRuntime()) {
    return;
  }
  const record = await readRecord();
  if (!record) return;
  const travelMode = mergeTravelMode(record);
  if (!travelMode.enabled) return;
  record.travelMode = {
    ...travelMode,
    enabled: false,
    autoDeactivateAt: null,
    temporaryPinWindows: [],
    updatedAt: Date.now(),
  };
  await writeRecord(record);
};

export const hasActiveTravelModeWindow = (snapshot: TravelModeSnapshot): boolean => {
  if (!snapshot.enabled) return false;
  const now = Date.now();
  return snapshot.temporaryPinWindows.some(window => window.expiresAt > now);
};

export const enableAppLock = async (pin: string, biometric: boolean): Promise<void> => {
  if (!isTauriRuntime()) {
    throw new Error('App lock requires Tauri runtime');
  }
  if (!pin || pin.length < 4) {
    throw new Error('PIN must contain at least 4 digits');
  }
  const salt = bufferToBase64(randomBytes(16).buffer);
  const secret = bufferToBase64(randomBytes(32).buffer);
  const pinHash = await hashPin(pin, salt);
  const record: AppLockRecord = {
    salt,
    pinHash,
    secret,
    biometricEnabled: biometric,
    updatedAt: Date.now(),
    travelMode: { ...EMPTY_TRAVEL_MODE, updatedAt: Date.now() },
  };
  await writeRecord(record);

  if (biometric) {
    try {
      await callSecureStorage({
        command: 'set',
        args: {
          key: BIOMETRIC_KEY,
          value: secret,
          options: { scope: 'biometric', prompt: 'Подтвердите личность для разблокировки скрытых чатов' },
        },
      });
    } catch (error) {
      console.warn('Biometric storage unavailable', error);
      record.biometricEnabled = false;
      await writeRecord(record);
    }
  } else {
    try {
      await callSecureStorage({ command: 'delete', args: { key: BIOMETRIC_KEY } });
    } catch (error) {
      // ignore
    }
  }

  clearSessionFlag();
};

export const disableAppLock = async (): Promise<void> => {
  if (!isTauriRuntime()) return;
  await callSecureStorage({ command: 'delete', args: { key: STORAGE_KEY } });
  try {
    await callSecureStorage({ command: 'delete', args: { key: BIOMETRIC_KEY } });
  } catch (error) {
    // ignore
  }
  clearSessionFlag();
};

export const unlockWithPin = async (pin: string): Promise<UnlockResult> => {
  if (!pin) {
    return { success: false, error: 'Введите PIN-код' };
  }
  const record = await readRecord();
  if (!record) {
    return { success: false, error: 'Блокировка не настроена' };
  }
  try {
    const digest = await hashPin(pin, record.salt);
    if (digest !== record.pinHash) {
      return { success: false, error: 'Неверный PIN-код' };
    }
    setSessionFlag();
    await appendTemporaryPinWindow(record, TEMPORARY_PIN_WINDOW_MS);
    return { success: true };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
};

export const unlockWithBiometric = async (): Promise<UnlockResult> => {
  const record = await readRecord();
  if (!record?.biometricEnabled) {
    return { success: false, error: 'Биометрическая разблокировка не включена' };
  }
  try {
    const secret = await callSecureStorage<string>({
      command: 'get',
      args: {
        key: BIOMETRIC_KEY,
        options: { scope: 'biometric', prompt: 'Подтвердите личность для разблокировки' },
      },
    });
    if (secret && secret === record.secret) {
      setSessionFlag();
      await appendTemporaryPinWindow(record, TEMPORARY_PIN_WINDOW_MS);
      return { success: true };
    }
    return { success: false, error: 'Не удалось подтвердить личность' };
  } catch (error) {
    console.warn('Biometric unlock failed', error);
    return { success: false, error: 'Биометрический датчик недоступен' };
  }
};

export const ensureAppLockConsistency = async (): Promise<void> => {
  const record = await readRecord();
  if (!record) {
    clearSessionFlag();
  }
};

