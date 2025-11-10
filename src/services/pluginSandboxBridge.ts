import type {
  PluginContext,
  PluginDefinition,
  PluginEventName,
  CommandDefinition,
} from '@matrix-messenger/sdk';
import type { ConfigureAnimatedReactionsPayload } from '../types/animatedReactions';
import {
  SANDBOX_MESSAGE,
  type SandboxActionRequest,
  type SandboxCommandInvoke,
  type SandboxCommandResult,
  type SandboxInitMessage,
  type SandboxMatrixRequest,
  type SandboxOutboundMessage,
  type SandboxRegisterCommand,
  type SandboxStorageRequest,
  type SandboxEventSubscription,
  type SandboxLogMessage,
  type SerializedCommandDefinition,
  type SandboxInboundMessage,
} from './pluginSandboxProtocol';

export interface SandboxManifest {
  id: string;
  name: string;
  entry: string;
  version?: string;
  description?: string;
}

export interface PluginSandboxOptions {
  manifest: SandboxManifest;
  entryUrl: string;
  allowedEvents: PluginEventName[];
  allowedActions: string[];
  allowStorage: boolean;
  allowScheduler: boolean;
  createWorker?: (url: URL) => Worker;
  configureAnimatedReactions?: (pluginId: string, payload: ConfigureAnimatedReactionsPayload) => Promise<unknown> | unknown;
  getAnimatedReactionsPreference?: () => boolean;
}

class PluginSandboxBridge {
  private readonly options: PluginSandboxOptions;
  private readonly ctx: PluginContext;
  private readonly allowedEvents: Set<PluginEventName>;
  private readonly allowedActions: Set<string>;
  private worker: Worker | null = null;
  private disposed = false;
  private readyPromise: Promise<void> | null = null;
  private resolveReady: (() => void) | null = null;
  private rejectReady: ((error: Error) => void) | null = null;
  private readonly eventDisposers = new Map<PluginEventName, () => void>();
  private readonly commandDisposers = new Map<number, () => void>();
  private readonly pendingCommands = new Map<number, { resolve(value: SandboxCommandResult): void; reject(error: Error): void }>();
  private nextRequestId = 1;

  constructor(options: PluginSandboxOptions, ctx: PluginContext) {
    this.options = options;
    this.ctx = ctx;
    this.allowedEvents = new Set(options.allowedEvents);
    this.allowedActions = new Set(options.allowedActions);
  }

  async initialise(): Promise<void> {
    if (typeof window === 'undefined') {
      throw new Error('Sandboxed plugins are only supported in browser environments');
    }
    const workerUrl = new URL('./pluginSandboxWorker.ts', import.meta.url);
    const workerFactory = this.options.createWorker ?? (url => new Worker(url, { type: 'module' }));
    this.worker = workerFactory(workerUrl);
    this.worker.addEventListener('message', event => this.handleMessage(event.data as SandboxOutboundMessage));
    this.worker.addEventListener('error', event => {
      console.error('[plugin-sandbox] Worker error', event);
      if (this.rejectReady) {
        this.rejectReady(new Error('Sandbox worker failed to initialise'));
      }
    });

    this.readyPromise = new Promise<void>((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });

    const initMessage: SandboxInitMessage = {
      type: SANDBOX_MESSAGE.INIT,
      manifest: this.options.manifest,
      entryUrl: this.options.entryUrl,
      allowedEvents: Array.from(this.allowedEvents),
      allowedActions: Array.from(this.allowedActions),
      allowStorage: this.options.allowStorage,
      allowScheduler: this.options.allowScheduler,
    };
    this.worker.postMessage(initMessage);
    await this.readyPromise;
  }

  async dispose(): Promise<void> {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    if (this.worker) {
      this.worker.postMessage({ type: SANDBOX_MESSAGE.DISPOSE } as SandboxInboundMessage);
      this.worker.terminate();
      this.worker = null;
    }
    for (const disposer of this.eventDisposers.values()) {
      disposer();
    }
    this.eventDisposers.clear();
    for (const disposer of this.commandDisposers.values()) {
      void Promise.resolve(disposer()).catch(error => console.warn('[plugin-sandbox] Failed to dispose command', error));
    }
    this.commandDisposers.clear();
    this.pendingCommands.clear();
    if (this.options.configureAnimatedReactions) {
      try {
        await Promise.resolve(this.options.configureAnimatedReactions(this.options.manifest.id, { clear: true }));
      } catch (error) {
        console.warn('[plugin-sandbox] Failed to clear animated reactions', error);
      }
    }
  }

  private nextId(): number {
    return this.nextRequestId++;
  }

  private handleMessage(message: SandboxOutboundMessage) {
    switch (message.type) {
      case SANDBOX_MESSAGE.READY:
        this.resolveReady?.();
        this.resolveReady = null;
        this.rejectReady = null;
        break;
      case SANDBOX_MESSAGE.SUBSCRIBE:
      case SANDBOX_MESSAGE.UNSUBSCRIBE:
        this.handleSubscription(message as SandboxEventSubscription);
        break;
      case SANDBOX_MESSAGE.REGISTER_COMMAND:
        void this.handleRegisterCommand((message as SandboxRegisterCommand).definition);
        break;
      case SANDBOX_MESSAGE.UNREGISTER_COMMAND:
        this.handleUnregisterCommand(message.handlerId);
        break;
      case SANDBOX_MESSAGE.ACTION_REQUEST:
        void this.handleActionRequest(message as SandboxActionRequest);
        break;
      case SANDBOX_MESSAGE.STORAGE_REQUEST:
        void this.handleStorageRequest(message as SandboxStorageRequest);
        break;
      case SANDBOX_MESSAGE.MATRIX_REQUEST:
        void this.handleMatrixRequest(message as SandboxMatrixRequest);
        break;
      case SANDBOX_MESSAGE.COMMAND_RESULT:
        this.resolveCommand(message as SandboxCommandResult);
        break;
      case SANDBOX_MESSAGE.LOG:
        this.handleLog(message as SandboxLogMessage);
        break;
      case SANDBOX_MESSAGE.ERROR:
        console.error('[plugin-sandbox] Worker error', message.error);
        break;
      default:
        console.warn('[plugin-sandbox] Unknown message', message);
    }
  }

  private resolveCommand(message: SandboxCommandResult) {
    const pending = this.pendingCommands.get(message.requestId);
    if (!pending) {
      return;
    }
    this.pendingCommands.delete(message.requestId);
    if (message.success === false) {
      pending.reject(new Error(message.error ?? 'Command execution failed'));
    } else {
      pending.resolve(message);
    }
  }

  private handleLog(message: SandboxLogMessage) {
    const args = Array.isArray(message.args) ? message.args : [];
    switch (message.level) {
      case 'debug':
        console.debug('[plugin-sandbox]', message.message, ...args);
        break;
      case 'info':
        console.info('[plugin-sandbox]', message.message, ...args);
        break;
      case 'warn':
        console.warn('[plugin-sandbox]', message.message, ...args);
        break;
      case 'error':
      default:
        console.error('[plugin-sandbox]', message.message, ...args);
        break;
    }
  }

  private handleSubscription(message: SandboxEventSubscription) {
    if (!this.allowedEvents.has(message.event)) {
      console.warn('[plugin-sandbox] Plugin attempted to subscribe to disallowed event', message.event);
      return;
    }
    if (!this.worker) {
      return;
    }
    if (message.type === SANDBOX_MESSAGE.SUBSCRIBE) {
      if (this.eventDisposers.has(message.event)) {
        return;
      }
      const disposer = this.ctx.events.on(message.event, payload => {
        this.worker?.postMessage({
          type: SANDBOX_MESSAGE.EVENT,
          event: message.event,
          payload,
        } satisfies SandboxEventMessage);
      });
      this.eventDisposers.set(message.event, disposer);
    } else {
      const disposer = this.eventDisposers.get(message.event);
      if (disposer) {
        disposer();
        this.eventDisposers.delete(message.event);
      }
    }
  }

  private async handleRegisterCommand(definition: SerializedCommandDefinition) {
    const handler: CommandDefinition['handler'] = async commandContext => {
      if (!this.worker) {
        throw new Error('Sandbox worker not available');
      }
      const requestId = this.nextId();
      const pending = new Promise<SandboxCommandResult>((resolve, reject) => {
        this.pendingCommands.set(requestId, { resolve, reject });
      });
      const message: SandboxCommandInvoke = {
        type: SANDBOX_MESSAGE.COMMAND_INVOKE,
        requestId,
        handlerId: definition.handlerId,
        command: definition.name,
        invocation: {
          account: commandContext.account,
          roomId: commandContext.roomId,
          args: commandContext.args,
          event: commandContext.event,
        },
      };
      this.worker.postMessage(message);
      const result = await pending;
      if (result.success === false) {
        throw new Error(result.error ?? 'Command execution failed');
      }
      return result.result as unknown;
    };

    const registeredDisposer = this.ctx.commands.register({
      name: definition.name,
      description: definition.description,
      usage: definition.usage,
      aliases: definition.aliases,
      handler,
    });
    this.commandDisposers.set(definition.handlerId, registeredDisposer);
  }

  private handleUnregisterCommand(handlerId: number) {
    const disposer = this.commandDisposers.get(handlerId);
    if (disposer) {
      disposer();
      this.commandDisposers.delete(handlerId);
    }
  }

  private async handleActionRequest(message: SandboxActionRequest) {
    if (!this.worker) {
      return;
    }
    const response: SandboxActionResponse = {
      type: SANDBOX_MESSAGE.ACTION_RESPONSE,
      requestId: message.requestId,
      success: false,
    };
    try {
      if (!this.allowedActions.has(message.action)) {
        throw new Error(`Action ${message.action} is not permitted`);
      }
      if (message.action === 'configureAnimatedReactions') {
        if (!this.options.configureAnimatedReactions) {
          throw new Error('Animated reactions configuration is not available');
        }
        const result = await this.options.configureAnimatedReactions(
          this.options.manifest.id,
          message.payload as ConfigureAnimatedReactionsPayload,
        );
        response.success = true;
        response.result = result;
      } else if (message.action === 'getAnimatedReactionsPreference') {
        const enabled = this.options.getAnimatedReactionsPreference?.() ?? false;
        response.success = true;
        response.result = { enabled };
      } else {
        const handler = (this.ctx.actions as Record<string, (payload: unknown) => unknown>)[message.action];
        if (!handler) {
          throw new Error(`Action ${message.action} is not implemented`);
        }
        const result = await handler(message.payload);
        response.success = true;
        response.result = result;
      }
    } catch (error) {
      response.error = error instanceof Error ? error.message : String(error);
    }
    this.worker.postMessage(response);
  }

  private async handleStorageRequest(message: SandboxStorageRequest) {
    if (!this.worker) {
      return;
    }
    const response: SandboxStorageResponse = {
      type: SANDBOX_MESSAGE.STORAGE_RESPONSE,
      requestId: message.requestId,
      success: false,
    };
    try {
      if (!this.options.allowStorage) {
        throw new Error('Storage access not granted');
      }
      const storage = this.ctx.storage;
      switch (message.operation.op) {
        case 'get':
          response.result = await storage.get(message.operation.key);
          break;
        case 'set':
          await storage.set(message.operation.key, message.operation.value);
          break;
        case 'delete':
          await storage.delete(message.operation.key);
          break;
        case 'keys':
          response.result = await storage.keys();
          break;
        case 'clear':
          await storage.clear();
          break;
        default:
          throw new Error(`Unknown storage operation ${(message.operation as any).op}`);
      }
      response.success = true;
    } catch (error) {
      response.error = error instanceof Error ? error.message : String(error);
    }
    this.worker.postMessage(response);
  }

  private async handleMatrixRequest(message: SandboxMatrixRequest) {
    if (!this.worker) {
      return;
    }
    const response: SandboxMatrixResponse = {
      type: SANDBOX_MESSAGE.MATRIX_RESPONSE,
      requestId: message.requestId,
      success: false,
    };
    try {
      switch (message.operation.op) {
        case 'listAccounts':
          response.result = this.ctx.matrix.listAccounts();
          break;
        case 'getAccount':
          response.result = this.ctx.matrix.getAccount(message.operation.accountId);
          break;
        default:
          throw new Error(`Unsupported matrix operation ${(message.operation as any).op}`);
      }
      response.success = true;
    } catch (error) {
      response.error = error instanceof Error ? error.message : String(error);
    }
    this.worker.postMessage(response);
  }
}

export const createSandboxedPluginDefinition = (
  options: PluginSandboxOptions,
): PluginDefinition => ({
  id: options.manifest.id,
  name: options.manifest.name,
  version: options.manifest.version,
  description: options.manifest.description,
  setup: async ctx => {
    const bridge = new PluginSandboxBridge(options, ctx);
    await bridge.initialise();
    return () => bridge.dispose();
  },
});
