# Plugin catalog and manifests

Matrix Messenger ships with a built-in plugin host powered by `@matrix-messenger/sdk`. The runtime bridges the SDK inside `src/services/pluginHost.ts`, registers Matrix clients for every logged-in account, and exposes a `window.matrixMessenger.registerPlugin` helper for advanced integrations.【F:src/services/pluginHost.ts†L1-L255】

## Authoring a plugin module

Create your plugin as an ES module that exports a `PluginDefinition`. The simplest approach is to reuse the SDK helper `definePlugin` and respond to Matrix events. Example modules live under `examples/` and can be bundled with any toolchain that emits modern JavaScript.【F:packages/sdk/src/plugin.ts†L1-L123】【F:plugins/echo-bot.js†L1-L22】

```js
import { definePlugin } from '@matrix-messenger/sdk';

export default definePlugin({
  id: 'demo.echo',
  name: 'Echo bot',
  async setup(ctx) {
    ctx.events.on('matrix.message', async payload => {
      if (payload.content?.body?.startsWith('!echo ')) {
        await ctx.actions.sendTextMessage({
          accountId: payload.account.id,
          roomId: payload.roomId,
          body: payload.content.body.slice('!echo '.length),
        });
      }
    });
  },
});
```

## Manifest format

The catalog reads manifests from `plugins/registry.json`. Each entry describes how the UI should present a plugin and which permissions it requires.【F:plugins/registry.json†L1-L11】

```jsonc
{
  "id": "demo.echo",
  "name": "Echo bot",
  "version": "1.0.0",
  "description": "Отвечает на команды !echo в комнатах Matrix.",
  "entry": "./echo-bot.js",
  "permissions": ["sendTextMessage"],
  "requiredEvents": ["matrix.message"]
}
```

When the catalog loads, the host resolves the `entry` against the registry URL, validates `permissions` and `requiredEvents`, and caches the manifest together with user preferences. Unknown permission strings or unsupported events trigger an error and prevent installation.【F:src/services/pluginHost.ts†L18-L235】

### Supported permissions

| Permission | Description |
| --- | --- |
| `sendTextMessage` | Allows the plugin to call `ctx.actions.sendTextMessage`. |
| `sendEvent` | Grants access to `ctx.actions.sendEvent` for arbitrary Matrix events. |
| `redactEvent` | Enables `ctx.actions.redactEvent` for moderation scenarios. |
| `storage` | Requests access to the plugin-scoped persistent storage adapter. |
| `scheduler` | Permits background timers (`ctx.scheduler.setTimeout/setInterval`). |

Valid event names include `matrix.client-ready`, `matrix.client-updated`, `matrix.client-stopped`, `matrix.room-event`, `matrix.message`, and `command.invoked`—matching the dispatcher built into the SDK.【F:packages/sdk/src/types.ts†L33-L86】【F:src/services/pluginHost.ts†L18-L112】

## Publishing to the catalog

1. Add your bundled module (for example `plugins/my-plugin.js`) to the repository or an accessible URL.
2. Append a new manifest object to `plugins/registry.json` with the metadata described above.
3. Submit the change together with documentation updates so reviewers understand the requested permissions.
4. Ensure the module exports a `PluginDefinition` whose `id` matches the manifest. Mismatches are logged and can confuse users during updates.【F:src/services/pluginHost.ts†L90-L164】

## Runtime behaviour

- The catalog modal (opened from the **«Плагины»** button in the sidebar) lists registry entries, warns about requested permissions, and prompts the user before installation.【F:src/components/RoomList.tsx†L1-L190】【F:src/components/PluginCatalogModal.tsx†L1-L164】
- Successful installations are persisted under the `matrix-messenger.plugins.preferences` key. At boot the app calls `bootstrapStoredPlugins()` to re-register enabled plugins automatically.【F:src/services/pluginHost.ts†L37-L235】【F:src/App.tsx†L1-L63】
- The settings panel (**Настройки → Плагины**) enumerates installed plugins, shows required events/permissions, and exposes controls to enable, disable, or remove them.【F:src/components/Settings/PluginsPanel.tsx†L1-L169】【F:src/components/SettingsModal.tsx†L1-L360】

By combining manifests with the existing SDK you can ship reusable features while giving users explicit control over the access granted to each plugin.
