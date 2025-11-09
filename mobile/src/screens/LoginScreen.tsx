import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import * as Linking from 'expo-linking';
import { CameraType, CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import QRCode from 'react-native-qrcode-svg';
import {
  CredentialsPayload,
  MfaState,
  QrLoginState,
  SsoLoginPayload,
  SsoLoginResult,
  TokenLoginPayload,
} from '../context/MatrixSessionContext';

interface LoginScreenProps {
  onSubmit: (payload: CredentialsPayload) => Promise<void>;
  onTokenLogin: (payload: TokenLoginPayload) => Promise<void>;
  onSsoLogin: (payload: SsoLoginPayload) => Promise<SsoLoginResult>;
  onGenerateQr: (homeserverUrl: string) => Promise<void>;
  onCancelQr: () => Promise<void>;
  loading: boolean;
  error: string | null;
  qrState: QrLoginState;
  mfaState: MfaState;
  onClearError: () => void;
}

interface ParsedToken {
  token: string;
  homeserver?: string;
}

const parseLoginToken = (input: string): ParsedToken | null => {
  const trimmed = input.trim();
  if (!trimmed) return null;

  const sanitizeUrl = (raw: string) => {
    try {
      if (raw.startsWith('matrix:')) {
        const [, rest] = raw.split('matrix:');
        const normalized = rest.startsWith('//') ? `https:${rest}` : `https://${rest}`;
        return new URL(normalized);
      }
      return new URL(raw);
    } catch {
      return null;
    }
  };

  const directMatch = trimmed.match(/login[token_/-]+([A-Za-z0-9._~-]+)/i);
  const paramMatch = trimmed.match(/[?&#]login[_-]?token=([^&#]+)/i);

  if (paramMatch && paramMatch[1]) {
    const homeserverParam = trimmed.match(/[?&#](homeserver|hs)=([^&#]+)/i);
    return {
      token: decodeURIComponent(paramMatch[1]),
      homeserver: homeserverParam && homeserverParam[2] ? decodeURIComponent(homeserverParam[2]) : undefined,
    };
  }

  if (directMatch && directMatch[1]) {
    const url = sanitizeUrl(trimmed);
    const homeserver = url?.searchParams.get('homeserver') ?? url?.searchParams.get('hs') ?? undefined;
    return { token: decodeURIComponent(directMatch[1]), homeserver: homeserver ?? undefined };
  }

  const url = sanitizeUrl(trimmed);
  if (url) {
    const tokenFromPath = url.pathname.split('/').filter(Boolean).pop();
    const tokenFromParam = url.searchParams.get('loginToken') ?? url.searchParams.get('login_token');
    if (tokenFromParam) {
      return { token: tokenFromParam, homeserver: url.searchParams.get('homeserver') ?? undefined };
    }
    if (tokenFromPath && tokenFromPath.length > 6) {
      return { token: tokenFromPath, homeserver: url.searchParams.get('homeserver') ?? undefined };
    }
  }

  if (/^[A-Za-z0-9._~-]+$/.test(trimmed)) {
    return { token: trimmed };
  }

  return null;
};

const getMfaMessage = (state: MfaState): string | null => {
  if (state.status === 'required') {
    if (state.validationError) {
      return state.message || 'Неверный одноразовый код. Попробуйте снова.';
    }
    return state.message || 'Введите код подтверждения из TOTP приложения.';
  }
  if (state.status === 'verifying') {
    return state.message ?? 'Проверяем одноразовый код…';
  }
  return null;
};

const getQrStatusColor = (status: QrLoginState['status']): string => {
  switch (status) {
    case 'ready':
      return '#82e1d3';
    case 'polling':
    case 'approved':
      return '#3A7EFB';
    case 'cancelled':
      return '#9ba9c5';
    case 'error':
    case 'expired':
      return '#ff6b6b';
    default:
      return '#9ba9c5';
  }
};

export const LoginScreen: React.FC<LoginScreenProps> = ({
  onSubmit,
  onTokenLogin,
  onSsoLogin,
  onGenerateQr,
  onCancelQr,
  loading,
  error,
  qrState,
  mfaState,
  onClearError,
}) => {
  const [homeserverUrl, setHomeserverUrl] = useState('https://matrix-client.matrix.org');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const [showTotp, setShowTotp] = useState(false);
  const [tokenInput, setTokenInput] = useState('');
  const [tokenError, setTokenError] = useState<string | null>(null);
  const [ssoRequest, setSsoRequest] = useState<SsoLoginResult | null>(null);
  const [scannerVisible, setScannerVisible] = useState(false);
  const [scanFeedback, setScanFeedback] = useState<string | null>(null);
  const [hasScanned, setHasScanned] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();

  useEffect(() => {
    if (scannerVisible && permission && !permission.granted) {
      void requestPermission();
    }
  }, [scannerVisible, permission, requestPermission]);

  useEffect(() => {
    if (mfaState.status !== 'required' && mfaState.status !== 'verifying') {
      setTotpCode('');
    }
  }, [mfaState.status]);

  const effectiveTotpSessionId = useMemo(
    () => (mfaState.status === 'required' ? mfaState.sessionId : undefined),
    [mfaState],
  );

  const handleSubmit = useCallback(async () => {
    if (!homeserverUrl || !username || !password || loading) return;
    setTokenError(null);
    try {
      await onSubmit({
        homeserverUrl,
        username,
        password,
        totpCode: totpCode ? totpCode.trim() : undefined,
        totpSessionId: effectiveTotpSessionId,
      });
    } catch (err) {
      console.warn('login submit failed', err);
    }
  }, [homeserverUrl, username, password, loading, onSubmit, totpCode, effectiveTotpSessionId]);

  const handleTokenLogin = useCallback(async () => {
    const trimmed = tokenInput.trim();
    if (!trimmed) return;
    const parsed = parseLoginToken(trimmed);
    if (!parsed) {
      setTokenError('Не удалось определить токен. Проверьте формат и попробуйте снова.');
      return;
    }
    setTokenError(null);
    try {
      await onTokenLogin({ homeserverUrl: parsed.homeserver ?? homeserverUrl, loginToken: parsed.token });
      setTokenInput('');
      setScanFeedback(null);
    } catch (err) {
      console.warn('token login failed', err);
      const message = err instanceof Error ? err.message : 'Не удалось выполнить вход по токену.';
      setTokenError(message);
    }
  }, [tokenInput, onTokenLogin, homeserverUrl]);

  const handleGenerateQr = useCallback(async () => {
    try {
      await onGenerateQr(homeserverUrl);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Не удалось запросить QR-код.';
      Alert.alert('QR-вход', message);
    }
  }, [onGenerateQr, homeserverUrl]);

  const handleCancelQr = useCallback(async () => {
    try {
      await onCancelQr();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Не удалось отменить QR-сессию.';
      Alert.alert('QR-вход', message);
    }
  }, [onCancelQr]);

  const handleOpenSso = useCallback(async () => {
    try {
      const redirectUri = Linking.createURL('/auth/sso');
      const request = await onSsoLogin({ homeserverUrl, redirectUri });
      setSsoRequest(request);
      await Linking.openURL(request.loginUrl);
    } catch (err) {
      console.warn('sso launch failed', err);
      const message = err instanceof Error ? err.message : 'Не удалось открыть страницу SSO.';
      Alert.alert('SSO', message);
    }
  }, [homeserverUrl, onSsoLogin]);

  const handleScan = useCallback(
    async (result: BarcodeScanningResult) => {
      if (!result?.data || hasScanned) return;
      setHasScanned(true);
      const parsed = parseLoginToken(result.data);
      if (!parsed) {
        setScanFeedback('Не удалось распознать токен в QR-коде.');
        setHasScanned(false);
        return;
      }
      try {
        await onTokenLogin({ homeserverUrl: parsed.homeserver ?? homeserverUrl, loginToken: parsed.token });
        setScannerVisible(false);
        setScanFeedback(null);
        setTokenInput('');
      } catch (err) {
        console.warn('scanned token login failed', err);
        const message = err instanceof Error ? err.message : 'Не удалось войти с использованием отсканированного токена.';
        setScanFeedback(message);
        setHasScanned(false);
      }
    },
    [hasScanned, onTokenLogin, homeserverUrl],
  );

  const closeScanner = useCallback(() => {
    setScannerVisible(false);
    setHasScanned(false);
    setScanFeedback(null);
  }, []);

  const qrStatusMessage = useMemo(() => {
    if (qrState.status === 'idle') return 'QR-вход ещё не активирован.';
    if (qrState.status === 'loading') return qrState.message ?? 'Готовим запрос на сервере…';
    if (qrState.status === 'ready') return qrState.message ?? 'QR-код готов к сканированию.';
    if (qrState.status === 'polling') return qrState.message ?? 'Ожидаем подтверждение устройства.';
    if (qrState.status === 'approved') return qrState.message ?? 'Подтверждение получено. Завершаем вход…';
    if (qrState.status === 'cancelled') return qrState.message ?? 'QR-вход отменён.';
    if (qrState.status === 'expired') return qrState.error ?? 'QR-код истёк. Попробуйте снова.';
    if (qrState.status === 'error') return qrState.error ?? 'QR-вход недоступен.';
    return null;
  }, [qrState]);

  const showQrCode = qrState.matrixUri && (qrState.status === 'ready' || qrState.status === 'polling');
  const mfaMessage = getMfaMessage(mfaState);

  const handleClearError = useCallback(() => {
    onClearError();
    setTokenError(null);
  }, [onClearError]);

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView style={styles.inner} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
          <View style={styles.header}>
            <Text style={styles.title}>Matrix Messenger</Text>
            <Text style={styles.subtitle}>Войдите в свой аккаунт Matrix</Text>
          </View>

          {error ? (
            <TouchableOpacity onPress={handleClearError} accessibilityRole="button" style={styles.errorBanner}>
              <Text style={styles.errorBannerText}>{error}</Text>
              <Text style={styles.errorBannerHint}>Нажмите, чтобы скрыть сообщение</Text>
            </TouchableOpacity>
          ) : null}

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Вход по паролю</Text>
            <Text style={styles.label}>Homeserver URL</Text>
            <TextInput
              value={homeserverUrl}
              onChangeText={setHomeserverUrl}
              autoCapitalize="none"
              style={styles.input}
              placeholder="https://matrix.example.com"
              editable={!loading}
            />
            <Text style={styles.label}>Имя пользователя</Text>
            <TextInput
              value={username}
              onChangeText={setUsername}
              autoCapitalize="none"
              style={styles.input}
              placeholder="@user:example.com"
              editable={!loading}
            />
            <Text style={styles.label}>Пароль</Text>
            <TextInput
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              style={styles.input}
              placeholder="••••••••"
              editable={!loading}
            />

            {(mfaState.status === 'required' || showTotp || mfaState.status === 'verifying') && (
              <View style={styles.totpBlock}>
                <Text style={styles.label}>Одноразовый код (TOTP)</Text>
                <TextInput
                  value={totpCode}
                  onChangeText={setTotpCode}
                  autoCapitalize="none"
                  keyboardType="number-pad"
                  style={styles.input}
                  placeholder="123456"
                  editable={!loading}
                />
                {mfaMessage ? <Text style={styles.helper}>{mfaMessage}</Text> : null}
              </View>
            )}

            {mfaState.status !== 'required' ? (
              <TouchableOpacity style={styles.linkButton} onPress={() => setShowTotp(prev => !prev)}>
                <Text style={styles.linkButtonText}>
                  {showTotp ? 'Скрыть поле для одноразового кода' : 'У меня есть одноразовый код'}
                </Text>
              </TouchableOpacity>
            ) : null}

            <TouchableOpacity
              style={[styles.button, loading && styles.buttonDisabled]}
              onPress={handleSubmit}
              accessibilityRole="button"
              disabled={loading}
            >
              {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Войти</Text>}
            </TouchableOpacity>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Быстрый вход</Text>

            <View style={styles.inlineActions}>
              <TouchableOpacity style={styles.secondaryButton} onPress={handleOpenSso} accessibilityRole="button">
                <Text style={styles.secondaryButtonText}>Войти через SSO</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.secondaryButton}
                onPress={() => setScannerVisible(true)}
                accessibilityRole="button"
              >
                <Text style={styles.secondaryButtonText}>Сканер QR</Text>
              </TouchableOpacity>
            </View>

            <Text style={styles.label}>Токен входа</Text>
            <TextInput
              value={tokenInput}
              onChangeText={setTokenInput}
              autoCapitalize="none"
              style={styles.input}
              placeholder="Вставьте токен или ссылку с токеном"
              editable={!loading}
            />
            {tokenError ? <Text style={styles.error}>{tokenError}</Text> : null}
            <TouchableOpacity
              style={[styles.button, styles.subtleButton]}
              onPress={handleTokenLogin}
              accessibilityRole="button"
              disabled={loading}
            >
              <Text style={styles.buttonText}>Войти по токену</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>QR-вход</Text>
            <Text style={[styles.helper, { color: getQrStatusColor(qrState.status) }]}>{qrStatusMessage}</Text>
            {showQrCode ? (
              <View style={styles.qrWrapper}>
                <QRCode value={qrState.matrixUri ?? ''} size={200} backgroundColor="transparent" color="#fff" />
              </View>
            ) : null}
            <View style={styles.inlineActions}>
              <TouchableOpacity style={styles.secondaryButton} onPress={handleGenerateQr} accessibilityRole="button">
                <Text style={styles.secondaryButtonText}>
                  {qrState.status === 'ready' || qrState.status === 'polling' ? 'Обновить QR' : 'Сгенерировать QR'}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.secondaryButton} onPress={handleCancelQr} accessibilityRole="button">
                <Text style={styles.secondaryButtonText}>Отменить</Text>
              </TouchableOpacity>
            </View>
            {qrState.fallbackUrl ? (
              <TouchableOpacity
                style={styles.linkButton}
                onPress={() => Linking.openURL(qrState.fallbackUrl!)}
                accessibilityRole="button"
              >
                <Text style={styles.linkButtonText}>Открыть fallback в браузере</Text>
              </TouchableOpacity>
            ) : null}
          </View>

          {ssoRequest ? (
            <View style={styles.section}>
              <Text style={styles.helper}>
                Ожидаем завершения входа через SSO. Если браузер не открылся автоматически, используйте ссылку ниже.
              </Text>
              <TouchableOpacity
                style={styles.linkButton}
                onPress={() => Linking.openURL(ssoRequest.loginUrl)}
                accessibilityRole="button"
              >
                <Text style={styles.linkButtonText}>Открыть страницу SSO повторно</Text>
              </TouchableOpacity>
            </View>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>

      <Modal visible={scannerVisible} animationType="slide" transparent onRequestClose={closeScanner}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Сканирование QR-кода</Text>
            {permission && permission.granted ? (
              <CameraView
                style={styles.camera}
                facing={CameraType.back}
                onBarcodeScanned={handleScan}
                barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
              />
            ) : (
              <View style={styles.permissionBlock}>
                <Text style={styles.helper}>Для сканирования QR-кодов требуется разрешение на использование камеры.</Text>
                <TouchableOpacity style={styles.button} onPress={() => requestPermission()} accessibilityRole="button">
                  <Text style={styles.buttonText}>Выдать доступ</Text>
                </TouchableOpacity>
              </View>
            )}
            {scanFeedback ? <Text style={styles.error}>{scanFeedback}</Text> : null}
            <TouchableOpacity style={[styles.button, styles.modalCloseButton]} onPress={closeScanner} accessibilityRole="button">
              <Text style={styles.buttonText}>Закрыть</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0B1526',
  },
  inner: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 24,
    paddingVertical: 32,
    gap: 24,
  },
  header: {
    gap: 8,
  },
  title: {
    color: '#fff',
    fontSize: 28,
    fontWeight: '700',
  },
  subtitle: {
    color: '#9ba9c5',
    fontSize: 16,
  },
  section: {
    backgroundColor: '#101d35',
    borderRadius: 16,
    padding: 20,
    gap: 16,
    borderWidth: 1,
    borderColor: '#1f2a44',
  },
  sectionTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
  },
  label: {
    color: '#9ba9c5',
    fontSize: 14,
  },
  input: {
    backgroundColor: '#0b1526',
    borderRadius: 12,
    color: '#fff',
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    borderWidth: 1,
    borderColor: '#1f2a44',
  },
  button: {
    backgroundColor: '#3A7EFB',
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
  },
  subtleButton: {
    backgroundColor: '#2c4675',
  },
  secondaryButton: {
    flex: 1,
    backgroundColor: '#1b2a46',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#2d3a5c',
  },
  secondaryButtonText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 14,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 16,
  },
  error: {
    color: '#ff6b6b',
  },
  helper: {
    color: '#9ba9c5',
    fontSize: 13,
    lineHeight: 18,
  },
  linkButton: {
    alignSelf: 'flex-start',
  },
  linkButtonText: {
    color: '#82e1d3',
    fontSize: 14,
    fontWeight: '600',
  },
  inlineActions: {
    flexDirection: 'row',
    gap: 12,
  },
  qrWrapper: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
  },
  totpBlock: {
    gap: 12,
  },
  errorBanner: {
    backgroundColor: 'rgba(255,107,107,0.12)',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,107,107,0.3)',
    gap: 6,
  },
  errorBannerText: {
    color: '#ff6b6b',
    fontWeight: '600',
    fontSize: 14,
  },
  errorBannerHint: {
    color: '#ff9b9b',
    fontSize: 12,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.75)',
    justifyContent: 'center',
    padding: 24,
  },
  modalContent: {
    backgroundColor: '#101d35',
    borderRadius: 16,
    padding: 20,
    gap: 16,
    borderWidth: 1,
    borderColor: '#1f2a44',
  },
  modalTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
    textAlign: 'center',
  },
  camera: {
    width: '100%',
    aspectRatio: 3 / 4,
    borderRadius: 12,
    overflow: 'hidden',
  },
  permissionBlock: {
    alignItems: 'center',
    gap: 12,
  },
  modalCloseButton: {
    backgroundColor: '#2c4675',
  },
});

export default LoginScreen;
