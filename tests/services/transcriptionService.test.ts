import { describe, beforeEach, afterEach, it, expect, vi } from 'vitest';
import { MsgType } from 'matrix-js-sdk';
import {
  enqueueTranscriptionJob,
  __resetTranscriptionQueueForTests,
  __waitForTranscriptionIdle,
  updateRuntimeTranscriptionConfig,
} from '../../src/services/transcriptionService';
import type { MatrixClient } from '../../src/types';

const originalFetch = globalThis.fetch;

const createMockClient = () => {
  const sendEvent = vi.fn(async () => ({ event_id: 'rel-event' }));
  const downloadContent = vi.fn(async () => ({ data: new Blob(['dummy'], { type: 'audio/ogg' }) }));
  const getRoom = vi.fn(() => ({
    findEventById: vi.fn(() => null),
  }));
  const fetchRoomEvent = vi.fn(async () => ({
    content: { url: 'mxc://example/media' },
  }));
  const getEventMapper = vi.fn(() => (raw: any) => ({
    getContent: () => raw.content,
    getRelation: () => ({ key: 'econix.transcript' }),
    getTs: () => Date.now(),
    getId: () => 'rel-event-id',
  }));
  return {
    sendEvent,
    downloadContent,
    getRoom,
    fetchRoomEvent,
    getEventMapper,
  } as unknown as MatrixClient & {
    sendEvent: ReturnType<typeof vi.fn>;
  };
};

describe('transcriptionService queue', () => {
  beforeEach(() => {
    __resetTranscriptionQueueForTests();
    updateRuntimeTranscriptionConfig({
      enabled: true,
      provider: 'cloud',
      endpoint: 'https://transcribe.local/api',
      retryLimit: 3,
      apiKey: undefined,
      model: undefined,
      defaultLanguage: 'ru',
      maxDurationSec: 120,
    });
  });

  afterEach(() => {
    __resetTranscriptionQueueForTests();
    updateRuntimeTranscriptionConfig({ enabled: false, provider: 'disabled', endpoint: undefined });
    if (originalFetch) {
      globalThis.fetch = originalFetch;
    }
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('sends pending and completed transcript events on success', async () => {
    const mockClient = createMockClient();
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ text: 'hello world' }),
    }));
    globalThis.fetch = fetchMock as any;

    enqueueTranscriptionJob({
      client: mockClient,
      roomId: '!room:server',
      eventId: '$event',
      msgType: MsgType.Audio,
      mimeType: 'audio/ogg',
      durationMs: 2500,
      file: new Blob(['voice'], { type: 'audio/ogg' }),
      settings: { enabled: true, language: 'ru' },
    });

    await __waitForTranscriptionIdle();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(mockClient.sendEvent).toHaveBeenCalled();
    const calls = (mockClient.sendEvent as any).mock.calls;
    expect(calls.length).toBeGreaterThanOrEqual(2);
    const pendingPayload = calls[0][2];
    expect(pendingPayload['m.relates_to'].key).toBe('econix.transcript');
    expect(pendingPayload.body).toContain('pending');
    const completedPayload = calls[calls.length - 1][2];
    expect(completedPayload.body).toBe('hello world');
    expect(completedPayload['econix.transcript'].status).toBe('completed');
  });

  it('retries when transcription fails and eventually succeeds', async () => {
    vi.useFakeTimers();
    const mockClient = createMockClient();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 500, text: async () => 'fail' })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ text: 'ok' }) });
    globalThis.fetch = fetchMock as any;

    enqueueTranscriptionJob({
      client: mockClient,
      roomId: '!room:server',
      eventId: '$event',
      msgType: MsgType.Audio,
      mimeType: 'audio/ogg',
      durationMs: 1200,
      file: new Blob(['voice'], { type: 'audio/ogg' }),
      settings: { enabled: true },
    });

    const waitPromise = __waitForTranscriptionIdle();
    await vi.runAllTimersAsync();
    await waitPromise;

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const calls = (mockClient.sendEvent as any).mock.calls;
    const finalPayload = calls[calls.length - 1][2];
    expect(finalPayload['econix.transcript'].status).toBe('completed');
  });

  it('emits error annotation after exceeding retry limit', async () => {
    vi.useFakeTimers();
    const mockClient = createMockClient();
    const fetchMock = vi.fn(async () => ({ ok: false, status: 502, text: async () => 'error' }));
    globalThis.fetch = fetchMock as any;

    updateRuntimeTranscriptionConfig({ retryLimit: 2 });

    enqueueTranscriptionJob({
      client: mockClient,
      roomId: '!room:server',
      eventId: '$event',
      msgType: MsgType.Audio,
      mimeType: 'audio/ogg',
      durationMs: 1200,
      file: new Blob(['voice'], { type: 'audio/ogg' }),
      settings: { enabled: true },
    });

    const waitPromise = __waitForTranscriptionIdle();
    await vi.runAllTimersAsync();
    await waitPromise;

    const calls = (mockClient.sendEvent as any).mock.calls;
    const errorPayload = calls[calls.length - 1][2];
    expect(errorPayload['econix.transcript'].status).toBe('error');
    expect(fetchMock).toHaveBeenCalled();
  });
});
