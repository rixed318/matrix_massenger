import { definePlugin } from '@matrix-messenger/sdk';

export default definePlugin({
  id: 'demo.echo',
  name: 'Echo bot',
  version: '1.0.0',
  description: 'Отвечает на команды !echo, повторяя текст сообщения.',
  setup(ctx) {
    const surfaceId = 'echo-control';
    const renderPanel = (context) => {
      void ctx.ui.render(surfaceId, {
        lastUpdated: new Date().toISOString(),
        context,
      });
    };

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

    ctx.events.on('ui.render', event => {
      if (event.surfaceId !== surfaceId) {
        return;
      }
      renderPanel(event.context);
    });

    ctx.events.on('ui.action', async event => {
      if (event.surfaceId !== surfaceId || event.action !== 'send.echo') {
        return;
      }
      const [account] = ctx.matrix.listAccounts();
      const roomId = typeof event.context?.roomId === 'string' ? event.context.roomId : undefined;
      const text = typeof event.payload?.text === 'string' ? event.payload.text.trim() : '';
      if (!account || !roomId || !text) {
        return;
      }
      await ctx.actions.sendTextMessage({ accountId: account.id, roomId, body: text });
      renderPanel({ ...event.context, lastSent: text });
    });
  },
});
