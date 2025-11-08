/// <reference types="vitest" />

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

vi.mock('../src/services/matrixService', () => {
  return {
    login: vi.fn(),
    resolveHomeserverBaseUrl: vi.fn(),
    register: vi.fn(),
    HomeserverDiscoveryError: class HomeserverDiscoveryError extends Error {},
  };
});

import LoginPage from '../src/components/LoginPage';
import { login as loginService, resolveHomeserverBaseUrl, register as registerService } from '../src/services/matrixService';

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
    expect(loginMock).toHaveBeenCalledWith('https://resolved.example', 'alice', 'secret');
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
