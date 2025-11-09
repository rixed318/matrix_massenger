import React, { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { CredentialsPayload } from '../context/MatrixSessionContext';

interface LoginScreenProps {
  onSubmit: (payload: CredentialsPayload) => Promise<void>;
  loading: boolean;
  error: string | null;
}

export const LoginScreen: React.FC<LoginScreenProps> = ({ onSubmit, loading, error }) => {
  const [homeserverUrl, setHomeserverUrl] = useState('https://matrix-client.matrix.org');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  const handleSubmit = async () => {
    if (!homeserverUrl || !username || !password || loading) return;
    try {
      await onSubmit({ homeserverUrl, username, password });
    } catch (err) {
      console.warn('login submit failed', err);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView style={styles.inner} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.header}>
          <Text style={styles.title}>Matrix Messenger</Text>
          <Text style={styles.subtitle}>Войдите в свой аккаунт Matrix</Text>
        </View>
        <View style={styles.form}>
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
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <TouchableOpacity
            style={[styles.button, loading && styles.buttonDisabled]}
            onPress={handleSubmit}
            accessibilityRole="button"
            disabled={loading}
          >
            {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Войти</Text>}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
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
    paddingHorizontal: 24,
    paddingVertical: 32,
    justifyContent: 'center',
  },
  header: {
    marginBottom: 32,
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
  form: {
    gap: 16,
  },
  label: {
    color: '#9ba9c5',
    fontSize: 14,
  },
  input: {
    backgroundColor: '#101d35',
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
});
