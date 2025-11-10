/// <reference types="vitest" />

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, screen, waitFor } from '@testing-library/react';

vi.mock('@matrix-messenger/core', () => {
  class HomeserverDiscoveryError extends Error {}
  class TotpRequiredError extends Error {
    public readonly isValidationError: boolean;
    public readonly sessionId: string | null;

    constructor(message?: string, options?: { validationError?: boolean; sessionId?: string | null }) {
      super(message);
      this.name = 'TotpRequiredError';
      this.isValidationError = Boolean(options?.validationError);
      this.sessionId = options?.sessionId ?? null;
    }
  }

  return {
    login: vi.fn(),
    resolveHomeserverBaseUrl: vi.fn(),
    register: vi.fn(),
    HomeserverDiscoveryError,
    TotpRequiredError,
    getSecureCloudDetectorCatalog: vi.fn(() => [
      {
        id: 'secure-cloud-lite-ml',
        displayName: 'Локальная ML модель (lite)',
        type: 'ml',
        models: [{ id: 'lite-json', label: 'Lite JSON', provider: 'onnx' }],
      },
    ]),
  };
});

import LoginPage from '../../../src/components/LoginPage';
import {
  login as loginService,
  resolveHomeserverBaseUrl,
  TotpRequiredError,
} from '@matrix-messenger/core';

describe('LoginPage TOTP flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('prompts for TOTP when homeserver requires 2FA', async () => {
    const loginMock = vi.mocked(loginService);
    const resolveMock = vi.mocked(resolveHomeserverBaseUrl);
    resolveMock.mockResolvedValue('https://matrix.example');
    loginMock.mockRejectedValueOnce(new TotpRequiredError('Требуется код 2FA', { sessionId: 'sess-1' }));

    render(<LoginPage onLoginSuccess={vi.fn()} initialError={null} />);

    fireEvent.click(screen.getByRole('button', { name: /Matrix.org/i }));
    fireEvent.change(screen.getByLabelText(/Username/i), { target: { value: 'alice' } });
    fireEvent.change(screen.getByLabelText(/Password/i), { target: { value: 'secret' } });

    fireEvent.click(screen.getByRole('button', { name: 'Войти' }));

    await waitFor(() => {
      expect(screen.getByLabelText(/Код 2FA/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/Введите код из приложения/i)).toBeInTheDocument();
    expect(screen.getByText(/Требуется код 2FA/)).toBeInTheDocument();
  });

  it('keeps credentials and surfaces validation errors for wrong TOTP codes', async () => {
    const loginMock = vi.mocked(loginService);
    const resolveMock = vi.mocked(resolveHomeserverBaseUrl);
    resolveMock.mockResolvedValue('https://matrix.example');

    loginMock
      .mockRejectedValueOnce(new TotpRequiredError('Введите код из приложения', { sessionId: 'sess-1' }))
      .mockRejectedValueOnce(new TotpRequiredError('Неверный одноразовый код', { sessionId: 'sess-1', validationError: true }));

    render(<LoginPage onLoginSuccess={vi.fn()} initialError={null} />);

    fireEvent.click(screen.getByRole('button', { name: /Matrix.org/i }));
    fireEvent.change(screen.getByLabelText(/Username/i), { target: { value: 'alice' } });
    fireEvent.change(screen.getByLabelText(/Password/i), { target: { value: 'secret' } });

    fireEvent.click(screen.getByRole('button', { name: 'Войти' }));

    await waitFor(() => {
      expect(screen.getByLabelText(/Код 2FA/i)).toBeInTheDocument();
    });

    const totpInput = screen.getByLabelText(/Код 2FA/i) as HTMLInputElement;
    fireEvent.change(totpInput, { target: { value: '123456' } });

    fireEvent.click(screen.getByRole('button', { name: 'Войти' }));

    await waitFor(() => {
      expect(screen.getByText(/Неверный одноразовый код/)).toBeInTheDocument();
    });

    expect(totpInput.value).toBe('123456');
    const secondCall = loginMock.mock.calls[1];
    expect(secondCall?.[3]).toMatchObject({ totpCode: '123456', totpSessionId: 'sess-1' });
  });
});
