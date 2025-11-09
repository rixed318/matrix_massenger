import detox, { device, DetoxConfig } from 'detox';
import adapter from 'detox/runners/jest/adapter';

jest.setTimeout(120000);

beforeAll(async () => {
  const config = require('../.detoxrc.json') as DetoxConfig;
  await detox.init(config, { launchApp: false });
}, 120000);

afterAll(async () => {
  await detox.cleanup();
}, 120000);

beforeEach(async () => {
  await adapter.beforeEach();
  await device.launchApp({ newInstance: true });
});

afterEach(async () => {
  await adapter.afterEach();
  await device.terminateApp();
});
