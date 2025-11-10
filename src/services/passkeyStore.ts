import { invoke } from '@tauri-apps/api/core';

export type StoredPasskeyDeviceType = 'passkey' | 'security-key' | 'webauthn';

export interface StoredPasskeyDevice {
  credentialId: string;
  userId: string;
  label: string;
  addedAt: number;
  lastUsedAt?: number;
  transports?: string[];
  deviceType: StoredPasskeyDeviceType;
}

const inMemoryStore = new Map<string, StoredPasskeyDevice[]>();

const isTauri = () => typeof window !== 'undefined' && typeof (window as any).__TAURI__?.invoke === 'function';

const normaliseKey = (key: string): string => key.trim();

const cloneDevices = (devices: StoredPasskeyDevice[]): StoredPasskeyDevice[] =>
  devices.map(device => ({
    ...device,
    transports: device.transports ? [...device.transports] : undefined,
  }));

const normaliseDevice = (device: any): StoredPasskeyDevice | null => {
  const credentialId: string | undefined = device?.credentialId ?? device?.credential_id;
  const userId: string | undefined = device?.userId ?? device?.user_id;
  if (!credentialId || !userId) {
    return null;
  }
  const addedAtRaw = device?.addedAt ?? device?.added_at ?? Date.now();
  const addedAt = typeof addedAtRaw === 'number' ? addedAtRaw : Date.now();
  const lastUsedRaw = device?.lastUsedAt ?? device?.last_used_at ?? null;
  const transports = Array.isArray(device?.transports)
    ? [...device.transports]
    : Array.isArray(device?.transport)
      ? [...device.transport]
      : undefined;
  const deviceType = (device?.deviceType ?? device?.device_type ?? 'passkey') as StoredPasskeyDeviceType;

  return {
    credentialId,
    userId,
    label: typeof device?.label === 'string' && device.label.trim() ? device.label : `Passkey ${credentialId.slice(0, 6)}`,
    addedAt,
    lastUsedAt: typeof lastUsedRaw === 'number' ? lastUsedRaw : undefined,
    transports,
    deviceType,
  };
};

const NONE_OPTION: null = null;

const serialiseDevice = (device: StoredPasskeyDevice) => ({
  credential_id: device.credentialId,
  user_id: device.userId,
  label: device.label,
  added_at: device.addedAt,
  last_used_at: device.lastUsedAt ?? NONE_OPTION,
  transports: device.transports ?? NONE_OPTION,
  device_type: device.deviceType,
});

export const listPasskeyDevices = async (accountKey: string): Promise<StoredPasskeyDevice[]> => {
  const key = normaliseKey(accountKey);
  if (!key) return [];
  if (isTauri()) {
    try {
      const raw = await invoke<any[]>('list_passkey_devices', { account_key: key });
      if (!Array.isArray(raw)) return [];
      return raw
        .map(normaliseDevice)
        .filter((device): device is StoredPasskeyDevice => Boolean(device));
    } catch (error) {
      console.warn('Failed to load passkey devices', error);
      return [];
    }
  }
  return cloneDevices(inMemoryStore.get(key) ?? []);
};

export const savePasskeyDevice = async (accountKey: string, device: StoredPasskeyDevice): Promise<void> => {
  const key = normaliseKey(accountKey);
  if (!key) return;
  if (isTauri()) {
    try {
      await invoke('save_passkey_device', { account_key: key, device: serialiseDevice(device) });
      return;
    } catch (error) {
      console.warn('Failed to persist passkey device', error);
    }
  }
  const existing = inMemoryStore.get(key) ?? [];
  const filtered = existing.filter(item => item.credentialId !== device.credentialId);
  filtered.push({ ...device, transports: device.transports ? [...device.transports] : undefined });
  inMemoryStore.set(key, filtered);
};

export const touchPasskeyDevice = async (accountKey: string, credentialId: string): Promise<void> => {
  const key = normaliseKey(accountKey);
  if (!key || !credentialId) return;
  if (isTauri()) {
    try {
      await invoke('touch_passkey_device', { account_key: key, credential_id: credentialId });
      return;
    } catch (error) {
      console.warn('Failed to update passkey usage timestamp', error);
    }
  }
  const existing = inMemoryStore.get(key);
  if (!existing) return;
  const now = Date.now();
  inMemoryStore.set(
    key,
    existing.map(device =>
      device.credentialId === credentialId
        ? { ...device, lastUsedAt: now }
        : device,
    ),
  );
};

export const removePasskeyDevice = async (accountKey: string, credentialId: string): Promise<void> => {
  const key = normaliseKey(accountKey);
  if (!key || !credentialId) return;
  if (isTauri()) {
    try {
      await invoke('remove_passkey_device', { account_key: key, credential_id: credentialId });
      return;
    } catch (error) {
      console.warn('Failed to remove passkey device', error);
    }
  }
  const existing = inMemoryStore.get(key);
  if (!existing) return;
  inMemoryStore.set(
    key,
    existing.filter(device => device.credentialId !== credentialId),
  );
};
