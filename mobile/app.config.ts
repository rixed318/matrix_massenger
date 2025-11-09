import path from 'node:path'
import type { ExpoConfig } from '@expo/config-types'

const IS_PREVIEW = process.env.APP_VARIANT === 'preview'
const ICON_PATH = path.resolve(__dirname, '../app-icon.png')

export default (): ExpoConfig => ({
  name: IS_PREVIEW ? 'Matrix Messenger Preview' : 'Matrix Messenger',
  slug: 'matrix-messenger',
  version: '0.1.0',
  owner: undefined,
  orientation: 'default',
  icon: ICON_PATH,
  scheme: 'matrixmessenger',
  userInterfaceStyle: 'automatic',
  platforms: ['ios', 'android'],
  extra: {
    homeserverUrl: process.env.EXPO_PUBLIC_HOMESERVER_URL ?? 'https://matrix-client.matrix.org'
  },
  ios: {
    supportsTablet: true,
    bundleIdentifier: IS_PREVIEW ? 'com.matrix.messenger.preview' : 'com.matrix.messenger.dev',
    buildNumber: '1',
    infoPlist: {
      NSCameraUsageDescription: 'Matrix Messenger needs camera access for video calls.',
      NSMicrophoneUsageDescription: 'Matrix Messenger needs microphone access for calls.'
    }
  },
  android: {
    package: IS_PREVIEW ? 'com.matrix.messenger.preview' : 'com.matrix.messenger.dev',
    versionCode: 1,
    adaptiveIcon: {
      foregroundImage: ICON_PATH,
      backgroundColor: '#0B1526'
    },
    permissions: [
      'CAMERA',
      'RECORD_AUDIO',
      'READ_EXTERNAL_STORAGE',
      'WRITE_EXTERNAL_STORAGE'
    ]
  },
  updates: {
    url: 'https://u.expo.dev/YOUR-EAS-PROJECT-ID'
  },
  runtimeVersion: {
    policy: 'appVersion'
  },
  assetBundlePatterns: ['**/*']
})
