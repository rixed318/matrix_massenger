import { definePlugin } from '@matrix-messenger/sdk';

export default definePlugin({
  id: 'demo.echo',
  name: 'Echo bot',
  version: '1.0.0',
  description: 'Отвечает на команды !echo, повторяя текст сообщения.',
  setup(ctx) {
    ctx.events.on('matrix.message', async payload => {
      const body = payload.content?.body;
      if (typeof body !== 'string') {
        return;
      }
      const prefix = '!echo ';
      if (body.startsWith(prefix)) {
        await ctx.actions.sendTextMessage({
          accountId: payload.account.id,
          roomId: payload.roomId,
          body: body.slice(prefix.length) || '(пусто)',
        });
      }
    });
  },
});
