import { describe, expect, it, vi } from 'vitest';
import {
  PluginHost,
  createMemoryStorageAdapter,
  type MatrixClient,
} from '@matrix-messenger/sdk';
import { createSandboxedPluginDefinition } from '../../src/services/pluginSandboxBridge';
import { SANDBOX_MESSAGE, type SandboxInitMessage } from '../../src/services/pluginSandboxProtocol';

class MockWorker {
  public received: any[] = [];
  public eventsFromHost: any[] = [];
  public responsesFromHost: any[] = [];
  public terminated = false;
  private listeners: Array<(event: MessageEvent) => void> = [];
  private initHandler?: (message: SandboxInitMessage) => void;

  constructor(onInit?: (message: SandboxInitMessage, worker: MockWorker) => void) {
    this.initHandler = message => onInit?.(message, this);
  }

  addEventListener(type: string, listener: (event: MessageEvent) => void) {
    if (type === 'message') {
      this.listeners.push(listener);
    }
  }

  removeEventListener(type: string, listener: (event: MessageEvent) => void) {
    if (type === 'message') {
      this.listeners = this.listeners.filter(existing => existing !== listener);
    }
  }

  postMessage(message: any) {
    this.received.push(message);
    if (message.type === SANDBOX_MESSAGE.INIT && this.initHandler) {
      this.initHandler(message);
    }
    if (message.type === SANDBOX_MESSAGE.EVENT) {
      this.eventsFromHost.push(message);
    }
    if (
      message.type === SANDBOX_MESSAGE.ACTION_RESPONSE ||
      message.type === SANDBOX_MESSAGE.STORAGE_RESPONSE ||
      message.type === SANDBOX_MESSAGE.MATRIX_RESPONSE
    ) {
      this.responsesFromHost.push(message);
    }
    if (message.type === SANDBOX_MESSAGE.DISPOSE) {
      this.terminated = true;
    }
  }

  send(message: any) {
    const event = { data: message } as MessageEvent;
    for (const listener of this.listeners) {
      listener(event);
    }
  }

  terminate() {
    this.terminated = true;
  }
}

const createHost = () => {
  const host = new PluginHost({ storage: createMemoryStorageAdapter() });
  host.registerAccount(
    {
      id: 'acc1',
      userId: '@bot:example.org',
      homeserverUrl: 'https://matrix.example.org',
      label: 'Example Bot',
    },
    {} as MatrixClient,
  );
  (host as any).sendTextMessage = vi.fn().mockResolvedValue({ eventId: '$event' });
  return host as PluginHost & { sendTextMessage: ReturnType<typeof vi.fn> };
};

const createSandboxDefinition = (workerFactory: () => MockWorker, allowedActions: string[]) =>
  createSandboxedPluginDefinition({
    manifest: {
      id: 'test.echo',
      name: 'Test Echo',
      entry: 'echo.js',
      version: '1.0.0',
      description: 'Mock sandbox plugin',
    },
    entryUrl: 'https://example.org/plugin.js',
    allowedEvents: ['matrix.message'],
    allowedActions,
    allowStorage: false,
    allowScheduler: false,
    createWorker: () => workerFactory(),
  });

describe('plugin sandbox bridge', () => {
  it('delivers events and executes permitted actions', async () => {
    const host = createHost();
    let workerInstance: MockWorker | null = null;
    const definition = createSandboxDefinition(() => {
      workerInstance = new MockWorker((message, worker) => {
        worker.send({ type: SANDBOX_MESSAGE.READY });
        worker.send({ type: SANDBOX_MESSAGE.SUBSCRIBE, event: 'matrix.message' });
      });
      return workerInstance!;
    }, ['sendTextMessage']);

    const handle = await host.registerPlugin(definition);
    expect(workerInstance).toBeTruthy();

    const payload = {
      account: {
        id: 'acc1',
        userId: '@bot:example.org',
        homeserverUrl: 'https://matrix.example.org',
        label: 'Example Bot',
      },
      client: {} as MatrixClient,
      roomId: '!room:example.org',
      event: { getType: () => 'm.room.message', getContent: () => ({ body: 'hello' }) } as any,
      content: { body: 'hello' },
      messageType: 'm.text',
      isLiveEvent: true,
      direction: 'forward' as const,
      data: {},
    };
    await host.emit('matrix.message', payload);
    expect(workerInstance?.eventsFromHost).toHaveLength(1);

    workerInstance?.send({
      type: SANDBOX_MESSAGE.ACTION_REQUEST,
      requestId: 1,
      action: 'sendTextMessage',
      payload: { accountId: 'acc1', roomId: '!room:example.org', body: 'pong' },
    });

    expect(host.sendTextMessage).toHaveBeenCalledWith(
      expect.objectContaining({ accountId: 'acc1', roomId: '!room:example.org', body: 'pong' }),
    );
    expect(workerInstance?.responsesFromHost[0]).toMatchObject({
      type: SANDBOX_MESSAGE.ACTION_RESPONSE,
      requestId: 1,
      success: true,
    });

    await handle.dispose();
    expect(workerInstance?.terminated).toBe(true);
  });

  it('rejects actions without permission', async () => {
    const host = createHost();
    let workerInstance: MockWorker | null = null;
    const definition = createSandboxDefinition(() => {
      workerInstance = new MockWorker((message, worker) => {
        worker.send({ type: SANDBOX_MESSAGE.READY });
      });
      return workerInstance!;
    }, []);

    await host.registerPlugin(definition);
    expect(workerInstance).toBeTruthy();

    workerInstance?.send({
      type: SANDBOX_MESSAGE.ACTION_REQUEST,
      requestId: 42,
      action: 'sendTextMessage',
      payload: { accountId: 'acc1', roomId: '!room:example.org', body: 'blocked' },
    });

    expect(host.sendTextMessage).not.toHaveBeenCalled();
    expect(workerInstance?.responsesFromHost[0]).toMatchObject({
      type: SANDBOX_MESSAGE.ACTION_RESPONSE,
      requestId: 42,
      success: false,
    });
  });

  it('cleans up subscriptions on dispose', async () => {
    const host = createHost();
    let workerInstance: MockWorker | null = null;
    const definition = createSandboxDefinition(() => {
      workerInstance = new MockWorker((message, worker) => {
        worker.send({ type: SANDBOX_MESSAGE.READY });
        worker.send({ type: SANDBOX_MESSAGE.SUBSCRIBE, event: 'matrix.message' });
      });
      return workerInstance!;
    }, ['sendTextMessage']);

    const handle = await host.registerPlugin(definition);
    await host.emit('matrix.message', {
      account: { id: 'acc1', userId: '@bot:example.org', homeserverUrl: 'https://matrix.example.org', label: 'Example Bot' },
      client: {} as MatrixClient,
      roomId: '!room:example.org',
      event: { getType: () => 'm.room.message', getContent: () => ({ body: 'first' }) } as any,
      content: { body: 'first' },
      messageType: 'm.text',
      isLiveEvent: true,
      direction: 'forward' as const,
      data: {},
    });
    expect(workerInstance?.eventsFromHost).toHaveLength(1);

    await handle.dispose();
    expect(workerInstance?.terminated).toBe(true);

    await host.emit('matrix.message', {
      account: { id: 'acc1', userId: '@bot:example.org', homeserverUrl: 'https://matrix.example.org', label: 'Example Bot' },
      client: {} as MatrixClient,
      roomId: '!room:example.org',
      event: { getType: () => 'm.room.message', getContent: () => ({ body: 'second' }) } as any,
      content: { body: 'second' },
      messageType: 'm.text',
      isLiveEvent: true,
      direction: 'forward' as const,
      data: {},
    });
    expect(workerInstance?.eventsFromHost).toHaveLength(1);
  });
});
