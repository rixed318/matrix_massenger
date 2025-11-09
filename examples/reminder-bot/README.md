# Reminder bot example

This sample plugin registers a `/remind <minutes> <message>` command and uses the scheduler plus persistent storage to deliver reminders even after restarts.

## Usage

1. Build the SDK and the reminder bot:

   ```bash
   npm install
   npm run build --workspace @matrix-messenger/sdk
   npm run build --workspace matrix-messenger-reminder-bot
   ```

2. Load the plugin in Matrix Messenger or register it at runtime:

   ```js
   import reminderBot from './dist/index.js';
   window.matrixMessenger.registerPlugin(reminderBot);
   ```

When a reminder is scheduled the plugin persists it via `ctx.storage` and reschedules the task on startup, showcasing durable jobs.【F:examples/reminder-bot/src/index.ts†L1-L77】
