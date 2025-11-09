# Matrix Messenger Plugin API

This document describes the public API exposed by the Matrix Messenger host application for third-party plugins and bots. The API is distributed as an npm package `@matrix-messenger/sdk` and can also be consumed by scripts that integrate with the runtime through a global helper.

## Package overview

The SDK provides the following key building blocks:

- **`PluginHost`** – a host-side coordinator responsible for loading plugins, routing Matrix events and executing commands.
- **`definePlugin`** – a helper for plugin authors that preserves strong typing of the `setup` contract.
- **Typed helpers and utilities** for working with Matrix clients, registering commands, storing data and scheduling background tasks.
- **Storage adapters** for persisting plugin state either in-memory (default) or in browser `localStorage`.

Source code for the package lives in `packages/sdk/` and the compiled ESM artifacts are emitted into `packages/sdk/dist/`.【F:packages/sdk/package.json†L1-L32】【F:packages/sdk/dist/index.d.ts†L1-L24】

To add the SDK to an external project, install it from the workspace or npm registry and depend on `matrix-js-sdk` as a peer:

```bash
npm install @matrix-messenger/sdk matrix-js-sdk
```

Inside this repository the root `package.json` exposes the SDK via a workspace, so other packages can import it directly using the package name without additional path configuration.【F:package.json†L1-L23】

## Defining a plugin

A plugin exports a definition created with `definePlugin`. The `setup` function receives a `PluginContext` object that exposes all runtime capabilities.【F:packages/sdk/src/plugin.ts†L41-L85】

```ts
import { definePlugin } from '@matrix-messenger/sdk';

export default definePlugin({
  id: 'com.example.echo',
  name: 'Echo bot',
  async setup(ctx) {
    ctx.events.on('matrix.message', async payload => {
      if (payload.content.body?.startsWith('!echo ')) {
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

### Plugin context capabilities

The `PluginContext` instance offers several namespaces:【F:packages/sdk/src/plugin.ts†L46-L85】【F:packages/sdk/src/PluginHost.ts†L152-L212】

- `logger`: scoped logging helpers writing through the host logger.
- `events`: subscribe with `on(event, handler)` or `once(event, handler)` to receive host lifecycle or Matrix events.
- `commands`: register slash-style commands available through the host (see below).
- `actions`: send Matrix events via `sendTextMessage`, `sendEvent`, or `redactEvent`.
- `matrix`: inspect available accounts (`listAccounts`, `getAccount`, `getClient`).
- `storage`: async key-value storage bound to the plugin id (persists via the configured adapter).
- `scheduler`: schedule timers with automatic cleanup when the plugin unloads.

### Events dispatched to plugins

The host emits the following typed events to plugins via the `events` API:【F:packages/sdk/src/types.ts†L33-L72】

| Event name | Payload | Description |
| --- | --- | --- |
| `matrix.client-ready` | account + client | Fired when the host attaches a Matrix client. |
| `matrix.client-updated` | account + client | Fired when account metadata (name, avatar, etc.) changes. |
| `matrix.client-stopped` | account + client | Fired when an account is removed or disconnected. |
| `matrix.room-event` | roomId, event, metadata | Generic timeline events from Matrix rooms. |
| `matrix.message` | `MatrixMessageContent` | Convenience event for `m.room.message` timeline items. |
| `command.invoked` | command metadata | Fired after a registered command completes. |

Handlers may be synchronous or async; all promises are awaited and errors are logged but do not stop other handlers.【F:packages/sdk/src/PluginHost.ts†L250-L268】

### Registering commands

Plugins can expose commands by calling `ctx.commands.register`. Command handlers receive a `CommandContext` with the current account/client, parsed arguments, optional source event, and a `reply` helper. Returning a string or `{ message }` populates the execution result, and `reply` can be used to send follow-up messages directly into the originating room.【F:packages/sdk/src/plugin.ts†L18-L45】【F:packages/sdk/src/PluginHost.ts†L212-L248】

On the host side commands are resolved case-insensitively. `PluginHost.executeCommand` runs the command, emits the `command.invoked` event, and returns a `CommandExecutionResult` describing the outcome.【F:packages/sdk/src/PluginHost.ts†L270-L332】

### Storage and scheduling

The SDK ships with adapters for in-memory and browser `localStorage` persistence. Hosts can inject a custom adapter; plugin authors simply call `ctx.storage.get/set/delete/keys/clear` with JSON-serializable values.【F:packages/sdk/src/storage.ts†L1-L126】

Timers created via `ctx.scheduler.setTimeout` / `setInterval` are automatically tracked and cleared when the plugin unloads, preventing orphaned intervals.【F:packages/sdk/src/PluginHost.ts†L190-L212】

### Sending Matrix events

`ctx.actions.sendTextMessage` builds a Matrix message event with sensible defaults (`m.text` and optional formatted body) and routes it through the host-managed `MatrixClient`. `sendEvent` allows posting arbitrary event types, while `redactEvent` wraps the SDK's `redactEvent` call with optional reason support.【F:packages/sdk/src/PluginHost.ts†L214-L242】

## Runtime integration in the app

The React host wires the SDK through a thin bridge (`src/services/pluginHost.ts`). For each logged-in account the app registers the Matrix client with the `PluginHost`, forwards timeline events, and cleans up when the account is removed.【F:src/services/pluginHost.ts†L1-L78】【F:src/App.tsx†L66-L147】

A convenience global is exposed in browser contexts so third-party scripts can register plugins dynamically:

```js
window.matrixMessenger.registerPlugin(myPluginDefinition);
```

The global includes the `PluginHost` instance for advanced scenarios.【F:src/services/pluginHost.ts†L80-L93】

## End-to-end test coverage

An integration-style Vitest in `tests/e2e/pluginHost.test.ts` exercises plugin registration, event delivery, and command execution, ensuring the host wiring remains stable as the SDK evolves.【F:tests/e2e/pluginHost.test.ts†L1-L64】

## Versioning and compatibility

- The SDK targets Node.js ≥ 18 and Matrix JS SDK `^30.1.0`.【F:packages/sdk/package.json†L1-L31】
- The host treats plugin ids as unique; attempting to register the same id twice throws an error.
- Commands are registered once per name/alias; duplicates result in an exception to guard against accidental overrides.【F:packages/sdk/src/PluginHost.ts†L166-L178】
- Storage adapters may be swapped to provide custom persistence (for example encrypted stores in desktop builds).

We recommend pinning to a specific SDK version and consulting this document for breaking changes. Contributions and feedback are welcome via pull requests.
