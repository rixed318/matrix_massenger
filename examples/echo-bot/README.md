# Echo bot example

This example shows the smallest possible plugin that reacts to chat messages beginning with `!echo` and replies with the remaining text.

## Usage

1. Install dependencies (in the repository root):

   ```bash
   npm install
   npm run build --workspace @matrix-messenger/sdk
   npm run build --workspace matrix-messenger-echo-bot
   ```

2. Load the compiled plugin bundle in the Matrix Messenger host, or register the plugin dynamically:

   ```js
   import echoBot from './dist/index.js';
   window.matrixMessenger.registerPlugin(echoBot);
   ```

The plugin uses the `matrix.message` event and the `sendTextMessage` helper exported by the SDK.【F:examples/echo-bot/src/index.ts†L1-L29】
