import assert from 'node:assert/strict';
import { beforeEach, afterEach, test, mock, describe } from 'node:test';
import { AutoDiscovery, AutoDiscoveryAction } from 'matrix-js-sdk';
import { resolveHomeserverBaseUrl, HomeserverDiscoveryError } from '../.test-dist/services/matrixService.js';

describe('resolveHomeserverBaseUrl helper', () => {
  let findClientConfigMock;

  beforeEach(() => {
    findClientConfigMock = mock.method(AutoDiscovery, 'findClientConfig');
  });

  afterEach(() => {
    mock.restoreAll();
  });

  test('normalises base URL for a domain input', async () => {
    findClientConfigMock.mock.mockImplementation(async () => ({
      'm.homeserver': {
        state: AutoDiscoveryAction.SUCCESS,
        base_url: 'https://matrix.example.com',
        error: null,
      },
    }));

    const baseUrl = await resolveHomeserverBaseUrl('matrix.example.com');
    assert.equal(baseUrl, 'https://matrix.example.com');
    assert.equal(findClientConfigMock.mock.callCount(), 1);
    assert.equal(findClientConfigMock.mock.calls[0].arguments[0], 'matrix.example.com');
  });

  test('resolves matrix IDs by extracting the homeserver part', async () => {
    findClientConfigMock.mock.mockImplementation(async () => ({
      'm.homeserver': {
        state: AutoDiscoveryAction.SUCCESS,
        base_url: 'https://example.org',
        error: null,
      },
    }));

    const baseUrl = await resolveHomeserverBaseUrl('@alice:example.org');
    assert.equal(baseUrl, 'https://example.org');
    assert.equal(findClientConfigMock.mock.calls[0].arguments[0], 'example.org');
  });

  test('enforces https for IP addresses with custom ports', async () => {
    findClientConfigMock.mock.mockImplementation(async () => ({
      'm.homeserver': {
        state: AutoDiscoveryAction.SUCCESS,
        base_url: 'http://10.0.0.5:8448',
        error: null,
      },
    }));

    const baseUrl = await resolveHomeserverBaseUrl('10.0.0.5:8448');
    assert.equal(baseUrl, 'https://10.0.0.5:8448');
    assert.equal(findClientConfigMock.mock.calls[0].arguments[0], '10.0.0.5:8448');
  });

  test('throws a descriptive error when discovery fails', async () => {
    findClientConfigMock.mock.mockImplementation(async () => ({
      'm.homeserver': {
        state: AutoDiscoveryAction.FAIL_PROMPT,
        base_url: null,
        error: AutoDiscovery.ERROR_MISSING_WELLKNOWN,
      },
    }));

    await assert.rejects(() => resolveHomeserverBaseUrl('invalid.example'), HomeserverDiscoveryError);
    await assert.rejects(
      () => resolveHomeserverBaseUrl('invalid.example'),
      new HomeserverDiscoveryError('На сервере отсутствует /.well-known/matrix/client.'),
    );
  });
});
