/**
 * E2EE helpers: cross-signing bootstrap, secret storage, key backup, device verification,
 * self-destruct timers synced via room account data, and device update notifications.
 *
 * Drop-in usage:
 *   import * as E2EE from './services/e2eeService';
 */
import type { MatrixClient, MatrixEvent } from 'matrix-js-sdk';
import { ClientEvent } from 'matrix-js-sdk';

// Some matrix-js-sdk crypto APIs live under "crypto-api". Avoid hard typings to keep compatibility.
type CryptoApi = any;
type VerificationRequest = any;
type Verifier = any;

const SELF_DESTRUCT_EVENT = 'econix.self_destruct'; // room account data type

export type SelfDestructConfig = {
  ttlSeconds: number | null;        // null disables
  scope?: 'all'|'text'|'media';     // optional granularity
};

const isTauri = () => typeof (window as any).__TAURI__?.invoke === 'function';

// ---------- Rust/Tauri secure store wrappers ----------
export async function saveEncryptedSeed(label: string, plaintextJson: string, passphrase: string): Promise<void> {
  if (!isTauri()) return;
  await (window as any).__TAURI__.invoke('secure_store_save_seed', {
    label,
    payloadJson: plaintextJson,
    passphrase,
  });
}

export async function loadEncryptedSeed(label: string, passphrase: string): Promise<string|null> {
  if (!isTauri()) return null;
  try {
    const res = await (window as any).__TAURI__.invoke('secure_store_load_seed', {
      label,
      passphrase,
    });
    return res as string;
  } catch {
    return null;
  }
}

// ---------- Cross-signing / 4S bootstrap ----------
export async function ensureCryptoReady(client: MatrixClient, opts?: {
  setupNewSecretStorage?: boolean;
  setupNewKeyBackup?: boolean;
}): Promise<void> {
  // Init the Rust crypto if not already
  const anyClient = client as any;
  if (!client.getCrypto?.()) {
    if (typeof anyClient.initRustCrypto === 'function') {
      await anyClient.initRustCrypto();
    }
  }
  const crypto: CryptoApi | undefined = client.getCrypto?.();
  if (!crypto) return;

  // Bootstrap Secret Storage and Cross-Signing
  await crypto.bootstrapSecretStorage?.({
    createSecretStorageKey: opts?.setupNewSecretStorage ?? true,
    setupNewKeyBackup: opts?.setupNewKeyBackup ?? true,
  });

  await crypto.bootstrapCrossSigning?.({
    authUploadDeviceSigningKeys: async (makeRequest: any) => makeRequest(),
  });
}

/** Returns cross-signing master key id, or null */
export async function getCrossSigningKeyId(client: MatrixClient): Promise<string|null> {
  const crypto: CryptoApi | undefined = client.getCrypto?.();
  if (!crypto?.getCrossSigningKeyId) return null;
  try {
    const id = await crypto.getCrossSigningKeyId();
    return id ?? null;
  } catch {
    return null;
  }
}

// ---------- Key export/backup to Tauri secure store ----------
export async function exportRoomKeysAsJson(client: MatrixClient): Promise<string> {
  const crypto: CryptoApi | undefined = client.getCrypto?.();
  if (!crypto?.exportRoomKeysAsJson) {
    // Backcompat path
    if ((client as any).exportRoomKeysAsJson) return await (client as any).exportRoomKeysAsJson();
    throw new Error('exportRoomKeysAsJson not available');
  }
  return await crypto.exportRoomKeysAsJson();
}

export async function importRoomKeysFromJson(client: MatrixClient, json: string): Promise<void> {
  const crypto: CryptoApi | undefined = client.getCrypto?.();
  if (!crypto?.importRoomKeysAsJson) {
    if ((client as any).importRoomKeysAsJson) return await (client as any).importRoomKeysAsJson(json);
    throw new Error('importRoomKeysAsJson not available');
  }
  await crypto.importRoomKeysAsJson(json);
}

/** Auto-backup loop. Call once after login. */
export function startAutoBackupLoop(client: MatrixClient, label: string, passphraseProvider: () => Promise<string>): () => void {
  let stopped = false;
  let timer: number | undefined;

  const doBackup = async () => {
    try {
      const pass = await passphraseProvider();
      if (!pass) return;
      const json = await exportRoomKeysAsJson(client);
      await saveEncryptedSeed(label, json, pass);
    } catch (e) {
      console.warn('Auto-backup failed', e);
    }
  };

  const schedule = () => {
    if (stopped) return;
    // 5 min cadence
    timer = window.setTimeout(async () => {
      await doBackup();
      schedule();
    }, 5 * 60 * 1000);
  };

  // also backup on unload
  const beforeUnload = () => {
    // Best-effort fire-and-forget
    doBackup();
  };

  // Kick-off immediately then on cadence
  void doBackup();
  schedule();
  window.addEventListener('beforeunload', beforeUnload);

  // Also respond to device list updates as a signal to re-backup
  const onDevicesUpdated = async () => { await doBackup(); };
  const anyClient = client as any;
  anyClient?.on?.('crypto.devicesUpdated', onDevicesUpdated);

  return () => {
    stopped = true;
    if (timer) window.clearTimeout(timer);
    window.removeEventListener('beforeunload', beforeUnload);
    anyClient?.removeListener?.('crypto.devicesUpdated', onDevicesUpdated);
  };
}

// ---------- Self-destruct timers via room account data ----------
export async function getRoomSelfDestructConfig(client: MatrixClient, roomId: string): Promise<SelfDestructConfig> {
  const room = client.getRoom(roomId);
  const ev = room?.getAccountData(SELF_DESTRUCT_EVENT);
  const content = ev?.getContent() || {};
  return {
    ttlSeconds: content.ttlSeconds ?? null,
    scope: content.scope ?? 'all',
  };
}

export async function setRoomSelfDestructConfig(client: MatrixClient, roomId: string, cfg: SelfDestructConfig): Promise<void> {
  await client.setRoomAccountData(roomId, SELF_DESTRUCT_EVENT, cfg as any);
}

/** Mutates content to include TTL marker. */
export function attachSelfDestructMarker(content: Record<string, any>, ttlSeconds: number|null): Record<string, any> {
  if (!ttlSeconds || ttlSeconds <= 0) return content;
  return {
    ...content,
    'org.econix.ttl': { seconds: ttlSeconds, ts: Date.now() },
  };
}

/** Schedule redact for a sent event based on attached TTL marker. */
export function scheduleSelfDestructRedaction(client: MatrixClient, roomId: string, eventId: string, ttlSeconds: number): void {
  const delay = Math.max(5_000, ttlSeconds * 1000); // minimum 5s safety
  window.setTimeout(() => {
    client.redactEvent(roomId, eventId).catch(() => {});
  }, delay);
}

// ---------- Verification helpers (SAS and QR) ----------
export type SasData = { emojis?: Array<[string,string]>; decimals?: [number,number,number]; };
export type VerificationUIState = {
  phase: 'idle'|'requested'|'ready'|'sas'|'done'|'canceled'|'failed';
  sas?: SasData;
  request?: VerificationRequest|null;
};

export async function requestSelfVerification(client: MatrixClient): Promise<VerificationRequest> {
  const crypto: CryptoApi | undefined = client.getCrypto?.();
  if (!crypto?.requestOwnUserVerification) throw new Error('requestOwnUserVerification not available');
  const req = await crypto.requestOwnUserVerification();
  return req;
}

export function bindVerificationListeners(client: MatrixClient, onRequest: (req: VerificationRequest)=>void): () => void {
  const crypto: CryptoApi | undefined = client.getCrypto?.();
  if (!crypto || !crypto.on) return () => {};

  const handler = (req: VerificationRequest) => {
    onRequest(req);
  };
  crypto.on('verification.request', handler);
  return () => { try { crypto.removeListener?.('verification.request', handler); } catch {} };
}

/** Start SAS and return a live verifier. Caller shows emojis then calls confirm() or cancel(). */
export async function startSas(req: VerificationRequest): Promise<{verifier: Verifier, data: SasData}> {
  await req.accept?.();
  const verifier: Verifier = await req.startVerification?.('m.sas.v1');
  const data: SasData = {};
  if (verifier?.getEmoji) data.emojis = verifier.getEmoji();
  if (verifier?.getDecimals) data.decimals = verifier.getDecimals();
  return { verifier, data };
}

// ---------- Device notifications ----------
export function onDevicesUpdated(client: MatrixClient, cb: (userIds: string[])=>void): () => void {
  const anyClient = client as any;
  const handler = (userIds: string[]) => cb(userIds);
  anyClient?.on?.('crypto.devicesUpdated', handler);
  // Back-compat alias sometimes seen in older apps
  anyClient?.on?.(ClientEvent.DeviceListUpdated as any, handler);
  return () => {
    anyClient?.removeListener?.('crypto.devicesUpdated', handler);
    anyClient?.removeListener?.(ClientEvent.DeviceListUpdated as any, handler);
  };
}
