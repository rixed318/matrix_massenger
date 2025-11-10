/* eslint-disable no-restricted-globals */
import type {
  PluginDefinition,
  PluginEventHandler,
  PluginEventName,
  PluginCleanup,
  CommandDefinition,
} from '@matrix-messenger/sdk';
import type { AnimatedReactionDefinition } from '../types/animatedReactions';
import {
  SANDBOX_MESSAGE,
  type SandboxActionRequest,
  type SandboxActionResponse,
  type SandboxCommandInvoke,
  type SandboxCommandResult,
  type SandboxEventMessage,
  type SandboxInboundMessage,
  type SandboxInitMessage,
  type SandboxMatrixRequest,
  type SandboxMatrixResponse,
  type SandboxOutboundMessage,
  type SandboxReadyMessage,
  type SandboxRegisterCommand,
  type SandboxStorageRequest,
  type SandboxStorageResponse,
  type SandboxUiRenderMessage,
} from './pluginSandboxProtocol';

interface PendingRequest {
  resolve(value: unknown): void;
  reject(error: Error): void;
}

const ctxSelf: DedicatedWorkerGlobalScope = self as unknown as DedicatedWorkerGlobalScope;

let nextRequestId = 1;
const pendingActions = new Map<number, PendingRequest>();
const pendingStorage = new Map<number, PendingRequest>();
const pendingMatrix = new Map<number, PendingRequest>();

const eventHandlers = new Map<PluginEventName, Set<PluginEventHandler<PluginEventName>>>();
const commandHandlers = new Map<number, CommandDefinition['handler']>();
const commandDefinitions = new Map<number, CommandDefinition>();

let allowedEvents = new Set<PluginEventName>();
let allowedActions = new Set<string>();
let allowStorage = false;
let allowScheduler = false;
let allowUiPanel = false;
let allowBackground = false;
let allowedSurfaces = new Set<string>();

let pluginDefinition: PluginDefinition | null = null;
let cleanup: PluginCleanup | void;

const post = (message: SandboxOutboundMessage) => {
  ctxSelf.postMessage(message);
};

const request = (
  message: SandboxActionRequest | SandboxStorageRequest | SandboxMatrixRequest,
  bucket: Map<number, PendingRequest>,
): Promise<unknown> => {
  const requestId = nextRequestId++;
  message.requestId = requestId;
  const promise = new Promise<unknown>((resolve, reject) => {
    bucket.set(requestId, { resolve, reject });
  });
  post(message);
  return promise;
};

const ensureEventAllowed = (event: PluginEventName) => {
  if (!allowedEvents.has(event)) {
    throw new Error(`Event ${event} is not allowed for this plugin`);
  }
};

const events = {
  on<K extends PluginEventName>(event: K, handler: PluginEventHandler<K>) {
    ensureEventAllowed(event);
    let handlers = eventHandlers.get(event);
    if (!handlers) {
      handlers = new Set();
      eventHandlers.set(event, handlers as Set<PluginEventHandler<PluginEventName>>);
      post({ type: SANDBOX_MESSAGE.SUBSCRIBE, event });
    }
    handlers.add(handler as PluginEventHandler<PluginEventName>);
    return () => {
      handlers?.delete(handler as PluginEventHandler<PluginEventName>);
      if (handlers && handlers.size === 0) {
        eventHandlers.delete(event);
        post({ type: SANDBOX_MESSAGE.UNSUBSCRIBE, event });
      }
    };
  },
  once<K extends PluginEventName>(event: K, handler: PluginEventHandler<K>) {
    const dispose = events.on(event, async payload => {
      dispose();
      await handler(payload as never);
    });
    return dispose;
  },
};

const createAction = (action: string) => {
  return async (payload: unknown) => {
    if (!allowedActions.has(action)) {
      throw new Error(`Action ${action} is not permitted`);
    }
    const response = (await request(
      {
        type: SANDBOX_MESSAGE.ACTION_REQUEST,
        action,
        payload,
        requestId: 0,
      } as SandboxActionRequest,
      pendingActions,
    )) as SandboxActionResponse;
    if (!response.success) {
      throw new Error(response.error ?? 'Action failed');
    }
    return response.result;
  };
};

const createStorage = () => {
  const ensureAllowed = () => {
    if (!allowStorage) {
      throw new Error('Storage access is not permitted for this plugin');
    }
  };
  return {
    async get<T>(key: string): Promise<T | undefined> {
      ensureAllowed();
      const response = (await request(
        {
          type: SANDBOX_MESSAGE.STORAGE_REQUEST,
          operation: { op: 'get', key },
          requestId: 0,
        } as SandboxStorageRequest,
        pendingStorage,
      )) as SandboxStorageResponse;
      if (!response.success) {
        throw new Error(response.error ?? 'Storage get failed');
      }
      return response.result as T | undefined;
    },
    async set<T>(key: string, value: T): Promise<void> {
      ensureAllowed();
      const response = (await request(
        {
          type: SANDBOX_MESSAGE.STORAGE_REQUEST,
          operation: { op: 'set', key, value },
          requestId: 0,
        } as SandboxStorageRequest,
        pendingStorage,
      )) as SandboxStorageResponse;
      if (!response.success) {
        throw new Error(response.error ?? 'Storage set failed');
      }
    },
    async delete(key: string): Promise<void> {
      ensureAllowed();
      const response = (await request(
        {
          type: SANDBOX_MESSAGE.STORAGE_REQUEST,
          operation: { op: 'delete', key },
          requestId: 0,
        } as SandboxStorageRequest,
        pendingStorage,
      )) as SandboxStorageResponse;
      if (!response.success) {
        throw new Error(response.error ?? 'Storage delete failed');
      }
    },
    async keys(): Promise<string[]> {
      ensureAllowed();
      const response = (await request(
        {
          type: SANDBOX_MESSAGE.STORAGE_REQUEST,
          operation: { op: 'keys' },
          requestId: 0,
        } as SandboxStorageRequest,
        pendingStorage,
      )) as SandboxStorageResponse;
      if (!response.success) {
        throw new Error(response.error ?? 'Storage keys failed');
      }
      return Array.isArray(response.result) ? (response.result as string[]) : [];
    },
    async clear(): Promise<void> {
      ensureAllowed();
      const response = (await request(
        {
          type: SANDBOX_MESSAGE.STORAGE_REQUEST,
          operation: { op: 'clear' },
          requestId: 0,
        } as SandboxStorageRequest,
        pendingStorage,
      )) as SandboxStorageResponse;
      if (!response.success) {
        throw new Error(response.error ?? 'Storage clear failed');
      }
    },
  };
};

const matrix = {
  async listAccounts() {
    const response = (await request(
      {
        type: SANDBOX_MESSAGE.MATRIX_REQUEST,
        operation: { op: 'listAccounts' },
        requestId: 0,
      } as SandboxMatrixRequest,
      pendingMatrix,
    )) as SandboxMatrixResponse;
    if (!response.success) {
      throw new Error(response.error ?? 'Matrix listAccounts failed');
    }
    return Array.isArray(response.result) ? response.result : [];
  },
  async getAccount(accountId: string) {
    const response = (await request(
      {
        type: SANDBOX_MESSAGE.MATRIX_REQUEST,
        operation: { op: 'getAccount', accountId },
        requestId: 0,
      } as SandboxMatrixRequest,
      pendingMatrix,
    )) as SandboxMatrixResponse;
    if (!response.success) {
      throw new Error(response.error ?? 'Matrix getAccount failed');
    }
    return response.result ?? undefined;
  },
  getClient() {
    throw new Error('Matrix client access is not available inside sandbox');
  },
};

const scheduler = {
  setTimeout(handler: () => void | Promise<void>, ms: number) {
    if (!allowScheduler) {
      throw new Error('Scheduler permission is not granted');
    }
    const handle = setTimeout(() => {
      void Promise.resolve(handler()).catch(error => {
        console.error('[sandbox] scheduled timeout failed', error);
      });
    }, ms);
    return () => clearTimeout(handle);
  },
  setInterval(handler: () => void | Promise<void>, ms: number) {
    if (!allowScheduler) {
      throw new Error('Scheduler permission is not granted');
    }
    const handle = setInterval(() => {
      void Promise.resolve(handler()).catch(error => {
        console.error('[sandbox] scheduled interval failed', error);
      });
    }, ms);
    return () => clearInterval(handle);
  },
};

const actions = {
  sendTextMessage: createAction('sendTextMessage'),
  sendEvent: createAction('sendEvent'),
  redactEvent: createAction('redactEvent'),
  configureAnimatedReactions: createAction('configureAnimatedReactions'),
  getAnimatedReactionsPreference: createAction('getAnimatedReactionsPreference'),
};

const ui = {
  render(surfaceId: string, payload: unknown) {
    if (!allowUiPanel) {
      throw new Error('UI access is not permitted for this plugin');
    }
    if (!allowedSurfaces.has(surfaceId)) {
      throw new Error(`Unknown UI surface ${surfaceId}`);
    }
    const message: SandboxUiRenderMessage = {
      type: SANDBOX_MESSAGE.UI_RENDER,
      surfaceId,
      payload,
    };
    post(message);
  },
};

const buildLogger = (id: string) => ({
  debug: (...args: unknown[]) => post({ type: SANDBOX_MESSAGE.LOG, level: 'debug', message: `[${id}]`, args }),
  info: (...args: unknown[]) => post({ type: SANDBOX_MESSAGE.LOG, level: 'info', message: `[${id}]`, args }),
  warn: (...args: unknown[]) => post({ type: SANDBOX_MESSAGE.LOG, level: 'warn', message: `[${id}]`, args }),
  error: (...args: unknown[]) => post({ type: SANDBOX_MESSAGE.LOG, level: 'error', message: `[${id}]`, args }),
});

const handleInit = async (message: SandboxInitMessage) => {
  try {
    allowedEvents = new Set(message.allowedEvents);
    allowedActions = new Set(message.allowedActions);
    allowStorage = message.allowStorage;
    allowScheduler = message.allowScheduler;
    allowUiPanel = message.allowUiPanel;
    allowBackground = message.allowBackground;
    allowedSurfaces = new Set((message.surfaces ?? []).map(surface => surface.id));

    const module = await import(/* @vite-ignore */ message.entryUrl);
    const definition = (module?.default ?? module) as PluginDefinition | undefined;
    if (!definition || typeof definition.setup !== 'function') {
      post({ type: SANDBOX_MESSAGE.ERROR, error: 'Plugin module did not export a valid definition' });
      return;
    }
    pluginDefinition = definition;

    const resolvedId = definition.id ?? message.manifest.id;
    const animatedReactions = (() => {
      const canConfigure = allowedActions.has('configureAnimatedReactions');
      const canQuery = allowedActions.has('getAnimatedReactionsPreference');
      if (!canConfigure && !canQuery) {
        return undefined;
      }
      return {
        async isEnabled(): Promise<boolean> {
          if (!canQuery) {
            throw new Error('Animated reactions preference access is not permitted');
          }
          const response = await actions.getAnimatedReactionsPreference({});
          if (response && typeof response === 'object' && 'enabled' in (response as any)) {
            return Boolean((response as any).enabled);
          }
          return Boolean(response);
        },
        async register(definitions: AnimatedReactionDefinition[], options?: { append?: boolean }): Promise<void> {
          if (!canConfigure) {
            throw new Error('Animated reactions configuration is not permitted');
          }
          await actions.configureAnimatedReactions({ definitions, append: Boolean(options?.append) });
        },
        async clear(): Promise<void> {
          if (!canConfigure) {
            throw new Error('Animated reactions configuration is not permitted');
          }
          await actions.configureAnimatedReactions({ clear: true });
        },
      };
    })();

    const context = {
      id: resolvedId,
      logger: buildLogger(resolvedId),
      storage: createStorage(),
      events,
      animatedReactions,
      commands: {
        register(definitionToRegister: CommandDefinition) {
          const handlerId = nextRequestId++;
          commandHandlers.set(handlerId, definitionToRegister.handler);
          commandDefinitions.set(handlerId, definitionToRegister);
          const serialised: SandboxRegisterCommand = {
            type: SANDBOX_MESSAGE.REGISTER_COMMAND,
            definition: {
              handlerId,
              name: definitionToRegister.name,
              description: definitionToRegister.description,
              usage: definitionToRegister.usage,
              aliases: definitionToRegister.aliases,
            },
          };
          post(serialised);
          return () => {
            commandHandlers.delete(handlerId);
            commandDefinitions.delete(handlerId);
            post({ type: SANDBOX_MESSAGE.UNREGISTER_COMMAND, handlerId });
          };
        },
        list() {
          return Array.from(commandDefinitions.values());
        },
      },
      actions,
      matrix,
      scheduler,
      ui,
    } as const;

    cleanup = await definition.setup(context);
    const ready: SandboxReadyMessage = { type: SANDBOX_MESSAGE.READY };
    post(ready);
  } catch (error) {
    post({
      type: SANDBOX_MESSAGE.ERROR,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

const handleCommandInvoke = async (message: SandboxCommandInvoke) => {
  const handler = commandHandlers.get(message.handlerId);
  if (!handler) {
    post({
      type: SANDBOX_MESSAGE.COMMAND_RESULT,
      requestId: message.requestId,
      success: false,
      error: `Unknown command handler ${message.handlerId}`,
    } as SandboxCommandResult);
    return;
  }
  try {
    const result = await handler({
      account: message.invocation.account,
      client: undefined as never,
      roomId: message.invocation.roomId,
      args: message.invocation.args,
      event: message.invocation.event as never,
      reply: async () => {
        throw new Error('Direct replies are not supported inside sandbox');
      },
    });
    post({
      type: SANDBOX_MESSAGE.COMMAND_RESULT,
      requestId: message.requestId,
      success: true,
      result,
    } as SandboxCommandResult);
  } catch (error) {
    post({
      type: SANDBOX_MESSAGE.COMMAND_RESULT,
      requestId: message.requestId,
      success: false,
      error: error instanceof Error ? error.message : String(error),
    } as SandboxCommandResult);
  }
};

const handleEvent = (message: SandboxEventMessage) => {
  const handlers = eventHandlers.get(message.event);
  if (!handlers || handlers.size === 0) {
    return;
  }
  for (const handler of handlers) {
    void Promise.resolve(handler(message.payload as never)).catch(error => {
      console.error('[sandbox] event handler failed', error);
    });
  }
};

const handleResponse = <T extends SandboxActionResponse | SandboxStorageResponse | SandboxMatrixResponse | SandboxCommandResult>(
  message: T,
  bucket: Map<number, PendingRequest>,
) => {
  const pending = bucket.get(message.requestId);
  if (!pending) {
    return;
  }
  bucket.delete(message.requestId);
  if ('success' in message && !message.success) {
    pending.reject(new Error(message.error ?? 'Operation failed'));
  } else {
    pending.resolve(message);
  }
};

const dispose = async () => {
  try {
    if (typeof cleanup === 'function') {
      await cleanup();
    }
  } finally {
    eventHandlers.clear();
    commandHandlers.clear();
  }
};

ctxSelf.addEventListener('message', event => {
  const data = event.data as SandboxInboundMessage;
  switch (data.type) {
    case SANDBOX_MESSAGE.INIT:
      void handleInit(data as SandboxInitMessage);
      break;
    case SANDBOX_MESSAGE.EVENT:
      handleEvent(data as SandboxEventMessage);
      break;
    case SANDBOX_MESSAGE.COMMAND_INVOKE:
      void handleCommandInvoke(data as SandboxCommandInvoke);
      break;
    case SANDBOX_MESSAGE.ACTION_RESPONSE:
      handleResponse(data as SandboxActionResponse, pendingActions);
      break;
    case SANDBOX_MESSAGE.STORAGE_RESPONSE:
      handleResponse(data as SandboxStorageResponse, pendingStorage);
      break;
    case SANDBOX_MESSAGE.MATRIX_RESPONSE:
      handleResponse(data as SandboxMatrixResponse, pendingMatrix);
      break;
    case SANDBOX_MESSAGE.DISPOSE:
      void dispose();
      break;
    default:
      console.warn('[sandbox] Unknown message', data);
  }
});
