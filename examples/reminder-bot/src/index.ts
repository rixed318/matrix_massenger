import { definePlugin } from '@matrix-messenger/sdk';

type Reminder = {
  id: string;
  accountId: string;
  roomId: string;
  message: string;
  remindAt: number;
};

const STORAGE_KEY = 'reminders';

export default definePlugin({
  id: 'com.matrix-messenger.examples.reminder',
  name: 'Reminder bot',
  description: 'Schedules timed reminders with durable storage',
  async setup(ctx) {
    const reminders = new Map<string, Reminder>();
    const cancels = new Map<string, () => void>();

    const persist = async () => {
      await ctx.storage.set(STORAGE_KEY, Array.from(reminders.values()));
    };

    const cancelReminder = async (id: string) => {
      const cancel = cancels.get(id);
      if (cancel) {
        cancel();
        cancels.delete(id);
      }
      if (reminders.delete(id)) {
        await persist();
      }
    };

    const schedule = (reminder: Reminder) => {
      const delay = Math.max(0, reminder.remindAt - Date.now());
      const cancel = ctx.scheduler.setTimeout(async () => {
        try {
          await ctx.actions.sendTextMessage({
            accountId: reminder.accountId,
            roomId: reminder.roomId,
            body: `⏰ Reminder: ${reminder.message}`,
          });
        } finally {
          reminders.delete(reminder.id);
          cancels.delete(reminder.id);
          await persist();
        }
      }, delay);
      cancels.set(reminder.id, cancel);
    };

    const stored = await ctx.storage.get<Reminder[]>(STORAGE_KEY);
    if (stored?.length) {
      for (const reminder of stored) {
        reminders.set(reminder.id, reminder);
        schedule(reminder);
      }
    }

    ctx.events.on('matrix.client-stopped', async payload => {
      const affected = Array.from(reminders.values()).filter(r => r.accountId === payload.account.id);
      for (const reminder of affected) {
        await cancelReminder(reminder.id);
      }
    });

    ctx.commands.register({
      name: 'remind',
      description: 'Schedule a reminder in N minutes',
      usage: '/remind <minutes> <message>',
      handler: async ({ args, reply, account, roomId }) => {
        if (!roomId) {
          await reply('Reminders can only be set inside a room.');
          return;
        }
        if (args.length < 2) {
          await reply('Usage: /remind <minutes> <message>');
          return;
        }
        const minutes = Number(args[0]);
        if (!Number.isFinite(minutes) || minutes <= 0) {
          await reply('Please provide a positive number of minutes.');
          return;
        }
        const message = args.slice(1).join(' ').trim();
        if (!message) {
          await reply('Please provide a reminder message.');
          return;
        }
        const remindAt = Date.now() + minutes * 60 * 1000;
        const reminder: Reminder = {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          accountId: account.id,
          roomId,
          message,
          remindAt,
        };
        reminders.set(reminder.id, reminder);
        schedule(reminder);
        await persist();
        await reply(`Reminder set for ${minutes} minute(s).`);
        return `reminder:${reminder.id}`;
      },
    });
  },
});
