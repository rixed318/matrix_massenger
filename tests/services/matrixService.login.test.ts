/// <reference types="vitest" />

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { MatrixClient } from '../../src/services/matrixService';
import * as matrixService from '../../src/services/matrixService';
import { login, TotpRequiredError } from '../../src/services/matrixService';

const createFakeClient = () => {
  const listeners: Record<string, ((state: string) => void)[]> = {};
  const client = {
    login: vi.fn(),
    startClient: vi.fn().mockResolvedValue(undefined),
    store: { startup: vi.fn().mockResolvedValue(undefined) },
    getRooms: vi.fn(() => []),
    once: vi.fn((event: string, handler: (state: string) => void) => {
      listeners[event] = listeners[event] || [];
      listeners[event].push(handler);
      handler('PREPARED');
    }),
    removeListener: vi.fn((event: string, handler: (state: string) => void) => {
      listeners[event] = (listeners[event] || []).filter(h => h !== handler);
    }),
  } as unknown as MatrixClient & {
    login: ReturnType<typeof vi.fn>;
    startClient: ReturnType<typeof vi.fn>;
    store: { startup: ReturnType<typeof vi.fn> };
    getRooms: ReturnType<typeof vi.fn>;
    once: ReturnType<typeof vi.fn>;
    removeListener: ReturnType<typeof vi.fn>;
  };

  return client;
};

describe('matrixService.login (interactive auth)', () => {
  let fakeClient: ReturnType<typeof createFakeClient>;
  let initCryptoSpy: ReturnType<typeof vi.spyOn>;
  let bindOutboxSpy: ReturnType<typeof vi.spyOn>;
  let secureProfileSpy: ReturnType<typeof vi.spyOn>;
  const originalNavigator = (global as any).navigator;

  beforeEach(() => {
    fakeClient = createFakeClient();
    vi.spyOn(matrixService, 'initClient').mockResolvedValue(fakeClient as unknown as MatrixClient);
    initCryptoSpy = vi.spyOn(matrixService, 'initCryptoBackend').mockResolvedValue('none' as any);
    bindOutboxSpy = vi.spyOn(matrixService, 'bindOutboxToClient').mockImplementation(() => undefined);
    secureProfileSpy = vi.spyOn(matrixService, 'setSecureCloudProfileForClient').mockImplementation(() => undefined);
    (global as any).navigator = {
      credentials: {
        get: vi.fn(),
        create: vi.fn(),
      },
    } as any;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    (global as any).navigator = originalNavigator;
  });

  it('throws TotpRequiredError when homeserver demands m.login.totp', async () => {
    fakeClient.login.mockRejectedValueOnce({
      errcode: 'M_FORBIDDEN',
      data: {
        flows: [{ stages: ['m.login.password', 'm.login.totp'] }],
        session: 'sess-1',
      },
    });

    await expect(login('https://hs', 'alice', 'secret')).rejects.toBeInstanceOf(TotpRequiredError);
    expect(fakeClient.login).toHaveBeenCalledTimes(1);
    expect(fakeClient.login).toHaveBeenCalledWith('m.login.password', expect.objectContaining({
      identifier: { type: 'm.id.user', user: 'alice' },
      password: 'secret',
    }));
    expect(initCryptoSpy).not.toHaveBeenCalled();
    expect(bindOutboxSpy).not.toHaveBeenCalled();
  });

  it('retries with TOTP code and resolves once validation succeeds', async () => {
    fakeClient.login
      .mockRejectedValueOnce({
        errcode: 'M_FORBIDDEN',
        data: {
          flows: [{ stages: ['m.login.password', 'm.login.totp'] }],
          session: 'sess-1',
        },
      })
      .mockResolvedValueOnce({
        user_id: '@alice:hs',
        access_token: 'token',
      });

    const client = await login('https://hs', 'alice', 'secret', { totpCode: '123456', totpSessionId: 'sess-1' });

    expect(client).toBe(fakeClient);
    expect(fakeClient.login).toHaveBeenCalledTimes(2);
    const secondCallPayload = fakeClient.login.mock.calls[1]?.[1];
    expect(secondCallPayload?.auth).toMatchObject({ type: 'm.login.totp', code: '123456', session: 'sess-1' });
    expect(initCryptoSpy).toHaveBeenCalledWith(fakeClient);
    expect(bindOutboxSpy).toHaveBeenCalledWith(fakeClient);
    expect(secureProfileSpy).not.toHaveBeenCalled();
  });

  it('surfaces validation errors for incorrect TOTP codes', async () => {
    fakeClient.login
      .mockRejectedValueOnce({
        errcode: 'M_FORBIDDEN',
        data: {
          flows: [{ stages: ['m.login.password', 'm.login.totp'] }],
          session: 'sess-1',
        },
      })
      .mockRejectedValueOnce({
        errcode: 'M_FORBIDDEN',
        data: {
          flows: [{ stages: ['m.login.password', 'm.login.totp'] }],
          session: 'sess-1',
          error: 'Неверный одноразовый код',
        },
      });

    await expect(
      login('https://hs', 'alice', 'secret', { totpCode: '654321', totpSessionId: 'sess-1' }),
    ).rejects.toMatchObject({
      message: 'Неверный одноразовый код',
      isValidationError: true,
      sessionId: 'sess-1',
    });

    expect(fakeClient.login).toHaveBeenCalledTimes(2);
    const secondAttemptPayload = fakeClient.login.mock.calls[1]?.[1];
    expect(secondAttemptPayload?.auth).toMatchObject({ type: 'm.login.totp', code: '654321', session: 'sess-1' });
    expect(initCryptoSpy).not.toHaveBeenCalled();
    expect(bindOutboxSpy).not.toHaveBeenCalled();
  });

  it('performs WebAuthn challenge when homeserver requires m.login.webauthn', async () => {
    const rawId = Uint8Array.from([1, 2, 3]).buffer;
    const clientData = Uint8Array.from([4, 5]).buffer;
    const authenticatorData = Uint8Array.from([6, 7]).buffer;
    const signature = Uint8Array.from([8, 9]).buffer;
    const credentialsGet = vi.mocked((navigator as any).credentials.get);
    credentialsGet.mockResolvedValue({
      id: 'cred-1',
      rawId,
      type: 'public-key',
      response: {
        clientDataJSON: clientData,
        authenticatorData,
        signature,
        userHandle: null,
      },
      getClientExtensionResults: vi.fn(() => ({})),
    } as any);

    fakeClient.login
      .mockRejectedValueOnce({
        errcode: 'M_FORBIDDEN',
        data: {
          flows: [{ stages: ['m.login.password', 'm.login.webauthn'] }],
          session: 'sess-pass',
          params: {
            'm.login.webauthn': {
              public_key: {
                challenge: 'AQID',
                rpId: 'example.org',
                allowCredentials: [],
              },
            },
          },
        },
      })
      .mockResolvedValueOnce({ user_id: '@alice:hs', access_token: 'token' });

    const client = await login('https://hs', 'alice', 'secret');

    expect(client).toBe(fakeClient);
    expect(credentialsGet).toHaveBeenCalledTimes(1);
    expect(fakeClient.login).toHaveBeenCalledTimes(2);
    const payload = fakeClient.login.mock.calls[1]?.[1];
    expect(payload?.auth?.type).toBe('m.login.webauthn');
    expect(payload?.auth?.session).toBe('sess-pass');
    expect(payload?.auth?.response?.rawId).toBe('AQID');
    expect(payload?.auth?.response?.response?.clientDataJSON).toBe('BAU');
    expect(payload?.auth?.response?.response?.authenticatorData).toBe('Bgc');
    expect(payload?.auth?.response?.response?.signature).toBe('CAk');
    expect(initCryptoSpy).toHaveBeenCalledWith(fakeClient);
    expect(bindOutboxSpy).toHaveBeenCalledWith(fakeClient);
  });

  it('propagates WebAuthn errors when user cancels passkey prompt', async () => {
    vi.mocked((navigator as any).credentials.get).mockRejectedValueOnce(new Error('User dismissed'));

    fakeClient.login.mockRejectedValueOnce({
      errcode: 'M_FORBIDDEN',
      data: {
        flows: [{ stages: ['m.login.password', 'm.login.passkey'] }],
        session: 'sess-pass',
        params: {
          'm.login.passkey': {
            public_key: {
              challenge: 'AQID',
              rpId: 'example.org',
              allowCredentials: [],
            },
          },
        },
      },
    });

    await expect(login('https://hs', 'alice', 'secret')).rejects.toThrow('User dismissed');
    expect(initCryptoSpy).not.toHaveBeenCalled();
    expect(bindOutboxSpy).not.toHaveBeenCalled();
  });
});
