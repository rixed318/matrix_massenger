/// <reference types="vitest" />

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

vi.mock('@matrix-messenger/core', () => {
  return {
    login: vi.fn(),
    resolveHomeserverBaseUrl: vi.fn(),
    register: vi.fn(),
    HomeserverDiscoveryError: class HomeserverDiscoveryError extends Error {},
    TotpRequiredError: class TotpRequiredError extends Error {
      constructor(message?: string, _options?: { validationError?: boolean; sessionId?: string | null }) {
        super(message);
        this.name = 'TotpRequiredError';
        this.isValidationError = Boolean(_options?.validationError);
        this.sessionId = _options?.sessionId ?? null;
      }
      public readonly isValidationError: boolean;
      public readonly sessionId: string | null;
    },
    getSecureCloudDetectorCatalog: vi.fn(() => [
      {
        id: 'secure-cloud-lite-ml',
        displayName: 'Локальная ML модель (lite)',
        type: 'ml',
        models: [
          { id: 'lite-json', label: 'Lite JSON', provider: 'onnx' },
          { id: 'securecloud-api', label: 'Secure Cloud API', provider: 'external' },
        ],
      },
    ]),
  };
});

import LoginPage from '../src/components/LoginPage';
import { login as loginService, resolveHomeserverBaseUrl, register as registerService } from '@matrix-messenger/core';

describe('LoginPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('shows secure cloud specific fields after selecting the option', () => {
    render(<LoginPage onLoginSuccess={vi.fn()} initialError={null} />);

    fireEvent.click(screen.getByRole('button', { name: /Secure Cloud/i }));

    const homeserverInput = screen.getByLabelText(/Homeserver URL/i) as HTMLInputElement;
    expect(homeserverInput.value).toBe('https://matrix.secure-messenger.com');
    expect(screen.queryByLabelText(/Secure Cloud API/i)).not.toBeNull();
    expect(screen.queryByLabelText(/Порог риска/i)).not.toBeNull();
    expect(screen.queryByLabelText(/Политика хранения предупреждений/i)).not.toBeNull();
    expect(screen.getByText(/Secure Cloud Premium/i)).not.toBeNull();
  });

  it('enables editing homeserver details for self-hosted connections', () => {
    render(<LoginPage onLoginSuccess={vi.fn()} initialError={null} />);

    fireEvent.click(screen.getByRole('button', { name: /Существующий сервер/i }));

    const homeserverInput = screen.getByLabelText(/Homeserver URL/i) as HTMLInputElement;
    expect(homeserverInput.readOnly).toBe(false);
    expect(homeserverInput.placeholder).toContain('example.com');
  });

  it('submits login credentials and notifies about successful login', async () => {
    const onLoginSuccess = vi.fn();
    const loginMock = vi.mocked(loginService);
    const resolveMock = vi.mocked(resolveHomeserverBaseUrl);
    resolveMock.mockResolvedValue('https://resolved.example');
    const fakeClient = { id: 'client' } as any;
    loginMock.mockResolvedValue(fakeClient);

    render(<LoginPage onLoginSuccess={onLoginSuccess} initialError={null} />);

    fireEvent.click(screen.getByRole('button', { name: /Matrix.org/i }));

    fireEvent.change(screen.getByLabelText(/Username/i), { target: { value: 'alice' } });
    fireEvent.change(screen.getByLabelText(/Password/i), { target: { value: 'secret' } });

    fireEvent.click(screen.getByRole('button', { name: 'Войти' }));

    await waitFor(() => {
      expect(onLoginSuccess).toHaveBeenCalledWith(fakeClient);
    });

    expect(resolveMock).toHaveBeenCalledWith('https://matrix.org');
    const call = loginMock.mock.calls[0];
    expect(call?.[0]).toBe('https://resolved.example');
    expect(call?.[1]).toBe('alice');
    expect(call?.[2]).toBe('secret');
    expect(call?.[3]).toBeUndefined();
  });

  it('submits registration form and calls register handler', async () => {
    const onLoginSuccess = vi.fn();
    const registerMock = vi.mocked(registerService);
    const fakeClient = { id: 'client' } as any;
    registerMock.mockResolvedValue(fakeClient);

    render(<LoginPage onLoginSuccess={onLoginSuccess} initialError={null} />);

    fireEvent.click(screen.getByRole('button', { name: /Secure Cloud/i }));
    fireEvent.click(screen.getByRole('button', { name: /Зарегистрироваться/i }));

    fireEvent.change(screen.getByLabelText(/Username/i), { target: { value: 'bob' } });
    fireEvent.change(screen.getByLabelText(/^Password$/i), { target: { value: 'hunter2' } });
    fireEvent.change(screen.getByLabelText(/Confirm password/i), { target: { value: 'hunter2' } });

    fireEvent.click(screen.getByRole('button', { name: /Создать аккаунт/i }));

    await waitFor(() => {
      expect(registerMock).toHaveBeenCalledWith('https://matrix.secure-messenger.com', 'bob', 'hunter2');
      expect(onLoginSuccess).toHaveBeenCalledWith(fakeClient);
    });
  });
});
