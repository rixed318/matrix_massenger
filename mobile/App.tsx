import { StatusBar } from 'expo-status-bar'
import Constants from 'expo-constants'
import React, { useState } from 'react'
import { SafeAreaView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native'
import { resolveHomeserverBaseUrl, HomeserverDiscoveryError } from '@matrix-messenger/core'

const defaultHomeserver =
  Constants.expoConfig?.extra?.homeserverUrl ?? 'https://matrix-client.matrix.org'

export default function App() {
  const [homeserver, setHomeserver] = useState(defaultHomeserver)
  const [status, setStatus] = useState<string>('Введите адрес homeserver и нажмите Проверить')
  const [busy, setBusy] = useState(false)

  const handleDiscover = async () => {
    if (busy) return
    setBusy(true)
    setStatus('Выполняется discovery…')
    try {
      const baseUrl = await resolveHomeserverBaseUrl(homeserver)
      setStatus(`Homeserver найден: ${baseUrl}`)
    } catch (error) {
      if (error instanceof HomeserverDiscoveryError) {
        setStatus(error.message)
      } else {
        setStatus('Неожиданная ошибка во время discovery.')
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar style="light" />
      <View style={styles.header}>
        <Text style={styles.title}>Matrix Messenger Mobile</Text>
        <Text style={styles.subtitle}>Прототип, разделяющий бизнес-логику с веб/Tauri приложением</Text>
      </View>
      <View style={styles.card}>
        <Text style={styles.label}>Homeserver</Text>
        <TextInput
          accessibilityLabel="Matrix homeserver"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          placeholder="matrix.example.com"
          style={styles.input}
          value={homeserver}
          onChangeText={setHomeserver}
        />
        <TouchableOpacity accessibilityRole="button" style={styles.button} onPress={handleDiscover} disabled={busy}>
          <Text style={styles.buttonText}>{busy ? 'Проверяем…' : 'Проверить'}</Text>
        </TouchableOpacity>
        <Text style={styles.status}>{status}</Text>
      </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0B1526',
    alignItems: 'center',
    justifyContent: 'flex-start',
    paddingHorizontal: 24,
    paddingVertical: 32,
  },
  header: {
    width: '100%',
    marginBottom: 24,
  },
  title: {
    fontSize: 28,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  subtitle: {
    marginTop: 8,
    fontSize: 16,
    lineHeight: 22,
    color: '#B4C2DF',
  },
  card: {
    backgroundColor: '#12213B',
    borderRadius: 16,
    padding: 20,
    width: '100%',
    gap: 12,
  },
  label: {
    color: '#B4C2DF',
    fontSize: 14,
  },
  input: {
    backgroundColor: '#0B1526',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    color: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#203456',
  },
  button: {
    marginTop: 8,
    backgroundColor: '#3A7EFB',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  buttonText: {
    color: '#FFFFFF',
    fontWeight: '600',
    fontSize: 16,
  },
  status: {
    marginTop: 12,
    color: '#FFFFFF',
    fontSize: 14,
    lineHeight: 20,
  },
})
