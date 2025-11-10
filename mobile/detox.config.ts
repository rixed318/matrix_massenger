import { DetoxConfig } from 'detox';

const config: DetoxConfig = {
  testRunner: 'jest',
  runnerConfig: 'e2e/jest.config.js',
  apps: {
    'ios.sim.debug': {
      type: 'ios.app',
      build: 'expo run:ios --scheme matrix-messenger --configuration Debug',
      binaryPath: 'ios/build/Build/Products/Debug-iphonesimulator/matrix-messenger.app',
    },
    'android.emu.debug': {
      type: 'android.apk',
      build: 'expo run:android --variant debug',
      binaryPath: 'android/app/build/outputs/apk/debug/app-debug.apk',
    },
  },
  devices: {
    simulator: {
      type: 'ios.simulator',
      device: {
        type: 'iPhone 15',
      },
    },
    emulator: {
      type: 'android.emulator',
      device: {
        avdName: 'Pixel_7_API_34',
      },
    },
  },
  configurations: {
    'ios.sim.debug': {
      device: 'simulator',
      app: 'ios.sim.debug',
    },
    'android.emu.debug': {
      device: 'emulator',
      app: 'android.emu.debug',
    },
  },
};

export default config;
