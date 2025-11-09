import { definePlugin } from '@matrix-messenger/sdk';

export default definePlugin({
  id: 'com.matrix-messenger.examples.echo',
  name: 'Echo bot',
  description: 'Replies with the same text when users type !echo',
  setup(ctx) {
    ctx.logger.info('Echo bot ready');

    ctx.events.on('matrix.message', async payload => {
      const body = payload.content.body ?? '';
      if (!body.startsWith('!echo ')) {
        return;
      }
      const text = body.slice('!echo '.length);
      if (!text.trim()) {
        return;
      }
      await ctx.actions.sendTextMessage({
        accountId: payload.account.id,
        roomId: payload.roomId,
        body: text,
      });
    });

    ctx.commands.register({
      name: 'echo',
      description: 'Echo the provided text',
      handler: async ({ args, reply }) => {
        const text = args.join(' ');
        if (!text.trim()) {
          await reply('Usage: /echo <text>');
          return;
        }
        await reply(text);
        return 'ok';
      },
    });
  },
});
