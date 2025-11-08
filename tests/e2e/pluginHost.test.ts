import { describe, expect, it, vi } from 'vitest';
import {
  PluginHost,
  createMemoryStorageAdapter,
  definePlugin,
  type PluginDefinition,
} from '@matrix-messenger/sdk';
import type { MatrixClient, MatrixEvent, MatrixMessageContent } from '@matrix-messenger/sdk';

const createMockClient = (): MatrixClient => ({
  sendEvent: vi.fn().mockResolvedValue({ event_id: '$event' }),
  redactEvent: vi.fn().mockResolvedValue(undefined),
} as unknown as MatrixClient);

const createMockEvent = (content: MatrixMessageContent = { body: 'hello', msgtype: 'm.text' }): MatrixEvent => ({
  getType: vi.fn().mockReturnValue('m.room.message'),
  getContent: vi.fn().mockReturnValue(content),
} as unknown as MatrixEvent);

describe('PluginHost', () => {
  it('dispatches events and executes commands', async () => {
    const host = new PluginHost({ storage: createMemoryStorageAdapter() });
    const received: MatrixMessageContent[] = [];

    const plugin: PluginDefinition = definePlugin({
      id: 'test.echo',
      setup(ctx) {
        ctx.events.on('matrix.message', payload => {
          received.push(payload.content);
        });
        ctx.commands.register({
          name: 'ping',
          description: 'Responds with pong',
          handler: async ({ reply }) => {
            await reply('pong');
            return 'handled';
          },
        });
      },
    });

    const client = createMockClient();
    await host.registerPlugin(plugin);
    host.registerAccount({
      id: 'acc1',
      userId: '@bot:example.org',
      homeserverUrl: 'https://matrix.example.org',
      label: 'Example Bot',
    }, client);

    const event = createMockEvent();
    await host.emit('matrix.message', {
      account: {
        id: 'acc1',
        userId: '@bot:example.org',
        homeserverUrl: 'https://matrix.example.org',
        label: 'Example Bot',
      },
      client,
      roomId: '!room:example.org',
      event,
      content: event.getContent(),
      messageType: 'm.text',
      isLiveEvent: true,
      direction: 'forward',
      data: {},
    });

    expect(received).toHaveLength(1);
    expect(received[0].body).toBe('hello');

    const result = await host.executeCommand({
      command: 'ping',
      accountId: 'acc1',
      roomId: '!room:example.org',
      args: [],
    });

    expect(result.status).toBe('ok');
    expect(result.pluginId).toBe('test.echo');
    expect(result.message).toBe('handled');
    expect((client.sendEvent as any)).toHaveBeenCalledWith(
      '!room:example.org',
      'm.room.message',
      expect.objectContaining({ body: 'pong' }),
    );
  });
});
