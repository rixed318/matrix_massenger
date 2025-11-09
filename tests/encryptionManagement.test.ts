import { describe, it, expect, beforeEach, afterEach, vi, type MockInstance } from 'vitest';
import {
  ensureRoomEncryption,
  getEncryptionSessionState,
  rotateRoomMegolmSession,
  backupRoomKeysOnce,
  restoreRoomKeysFromBackup,
  startManagedKeyBackup,
  stopManagedKeyBackup,
  getKeyBackupStatus,
} from '../src/services/matrixService';
import * as e2eeService from '../src/services/e2eeService';

vi.mock('../src/services/e2eeService', () => ({
  exportRoomKeysAsJson: vi.fn().mockResolvedValue('{"keys":[]}'),
  importRoomKeysFromJson: vi.fn().mockResolvedValue(undefined),
  saveEncryptedSeed: vi.fn().mockResolvedValue(undefined),
  loadEncryptedSeed: vi.fn().mockResolvedValue('{"keys":[]}'),
}));

type MockClient = Record<string, any>;

describe('encryption session helpers', () => {
  let client: MockClient;
  let encrypted = false;
  let prepareSpy: any;

  beforeEach(() => {
    encrypted = false;
    prepareSpy = vi.fn();
    const mockRoom = {
      roomId: 'room1',
      name: 'Test',
      currentState: {
        getStateEvents: vi.fn().mockReturnValue({
          getContent: () => ({ algorithm: 'm.megolm.v1.aes-sha2' }),
        }),
      },
    };
    client = {
      getRoom: vi.fn().mockReturnValue(mockRoom),
      isRoomEncrypted: vi.fn(() => encrypted),
      setRoomEncryption: vi.fn(async () => {
        encrypted = true;
      }),
      getCrypto: vi.fn(() => ({ prepareToEncrypt: prepareSpy, forceDiscardSession: vi.fn() })),
    };
  });

  it('ensures encryption is enabled for a room', async () => {
    const state = await ensureRoomEncryption(client as any, 'room1');
    expect(client.setRoomEncryption).toHaveBeenCalledWith('room1', expect.objectContaining({ algorithm: 'm.megolm.v1.aes-sha2' }));
    expect(prepareSpy).toHaveBeenCalled();
    expect(state?.isEncrypted).toBe(true);
    const cached = getEncryptionSessionState('room1');
    expect(cached?.isEncrypted).toBe(true);
  });

  it('rotates a megolm session via crypto API', () => {
    const forceSpy = vi.fn();
    client.getCrypto = vi.fn(() => ({ forceDiscardSession: forceSpy }));
    const state = rotateRoomMegolmSession(client as any, 'room1');
    expect(forceSpy).toHaveBeenCalledWith('room1');
    expect(state.lastRotatedAt).toBeTruthy();
  });
});

describe('backup helpers', () => {
  const saveEncryptedSeed = vi.mocked(e2eeService.saveEncryptedSeed);
  const loadEncryptedSeed = vi.mocked(e2eeService.loadEncryptedSeed);
  const exportRoomKeysAsJson = vi.mocked(e2eeService.exportRoomKeysAsJson);
  const importRoomKeysFromJson = vi.mocked(e2eeService.importRoomKeysFromJson);
  const waitForMockCalls = async (mock: MockInstance, count: number) => {
    const maxIterations = 20;
    let iterations = 0;
    while (mock.mock.calls.length < count && iterations < maxIterations) {
      iterations += 1;
      await Promise.resolve();
    }
    if (mock.mock.calls.length < count) {
      throw new Error(`Timed out waiting for mock calls: expected ${count}, got ${mock.mock.calls.length}`);
    }
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (globalThis as any).window = {
      setTimeout: (...args: Parameters<typeof setTimeout>) => setTimeout(...args),
      clearTimeout: (...args: Parameters<typeof clearTimeout>) => clearTimeout(...args),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };
    (globalThis as any).navigator = { onLine: true };
  });

  afterEach(() => {
    stopManagedKeyBackup();
  });

  it('backs up keys once and updates status', async () => {
    const ok = await backupRoomKeysOnce({} as any, 'secret');
    expect(ok).toBe(true);
    expect(exportRoomKeysAsJson).toHaveBeenCalled();
    expect(saveEncryptedSeed).toHaveBeenCalled();
    const status = getKeyBackupStatus();
    expect(status.lastBackupAt).not.toBeNull();
  });

  it('restores keys when backup is available', async () => {
    loadEncryptedSeed.mockResolvedValueOnce('{"keys":[1]}');
    const ok = await restoreRoomKeysFromBackup({} as any, 'secret');
    expect(ok).toBe(true);
    expect(importRoomKeysFromJson).toHaveBeenCalledWith(expect.anything(), '{"keys":[1]}');
  });

  it('starts and stops managed backup loop', async () => {
    vi.useFakeTimers();
    const stopper = startManagedKeyBackup({} as any, async () => 'pw');
    await waitForMockCalls(saveEncryptedSeed, 1);
    expect(saveEncryptedSeed).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
    await waitForMockCalls(saveEncryptedSeed, 2);
    expect(saveEncryptedSeed).toHaveBeenCalledTimes(2);
    stopper();
    vi.useRealTimers();
  });
});
