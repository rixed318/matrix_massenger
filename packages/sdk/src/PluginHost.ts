import {
  createMemoryStorageAdapter,
  createPluginStorage,
  type PluginStorage,
  type PluginStorageAdapter,
} from './storage';
import {
  type CommandDefinition,
  type CommandContext,
  type PluginCleanup,
  type PluginContext,
  type PluginDefinition,
  type PluginEventHandler,
  type PluginHandle,
  type ReplyContent,
} from './plugin';
import {
  type AccountMetadata,
  type ClientRuntime,
  type CommandExecutionResult,
  type CommandInvocation,
  type MatrixClient,
  type MatrixMessageContent,
  type MessengerEvents,
  type PluginEventName,
  type PluginLogger,
  type RedactEventInput,
  type SendEventInput,
  type SendTextMessageInput,
} from './types';

const normaliseCommandName = (name: string): string => name.trim().toLowerCase();

const ensureArray = (value: string | string[] | undefined): string[] => {
  if (!value) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
};

const DEFAULT_LOGGER: PluginLogger = {
  debug: (...args: unknown[]) => console.debug('[matrix-sdk]', ...args),
  info: (...args: unknown[]) => console.info('[matrix-sdk]', ...args),
  warn: (...args: unknown[]) => console.warn('[matrix-sdk]', ...args),
  error: (...args: unknown[]) => console.error('[matrix-sdk]', ...args),
};

export interface PluginHostOptions {
  logger?: PluginLogger;
  storage?: PluginStorageAdapter;
}

interface RegisteredCommand {
  definition: CommandDefinition;
  names: string[];
}

interface RegisteredHandler<K extends PluginEventName = PluginEventName> {
  pluginId: string;
  handler: PluginEventHandler<K>;
}

interface TimerRegistration {
  type: 'timeout' | 'interval';
  handle: ReturnType<typeof setTimeout>;
}

interface PluginInstance {
  definition: PluginDefinition;
  storage: PluginStorage;
  cleanup?: PluginCleanup;
  commands: RegisteredCommand[];
  eventDisposers: Array<() => void>;
  timers: TimerRegistration[];
}

interface AccountContext {
  account: AccountMetadata;
  client: MatrixClient;
}

export class PluginHost {
  private readonly logger: PluginLogger;
  private readonly storage: PluginStorageAdapter;
  private readonly plugins = new Map<string, PluginInstance>();
  private readonly eventHandlers = new Map<PluginEventName, Set<RegisteredHandler>>();
  private readonly commandIndex = new Map<string, { pluginId: string; definition: CommandDefinition }>();
  private readonly accounts = new Map<string, AccountContext>();

  constructor(options: PluginHostOptions = {}) {
    this.logger = options.logger ?? DEFAULT_LOGGER;
    this.storage = options.storage ?? createMemoryStorageAdapter();
  }

  /** Returns the ids of all active plugins. */
  getPluginIds(): string[] {
    return Array.from(this.plugins.keys());
  }

  /** Returns metadata for all registered commands. */
  getRegisteredCommands(): Array<{ pluginId: string; definition: CommandDefinition; names: string[] }> {
    const result: Array<{ pluginId: string; definition: CommandDefinition; names: string[] }> = [];
    for (const instance of this.plugins.values()) {
      for (const entry of instance.commands) {
        result.push({ pluginId: instance.definition.id, definition: entry.definition, names: [...entry.names] });
      }
    }
    return result;
  }

  async registerPlugin(definition: PluginDefinition): Promise<PluginHandle> {
    if (!definition.id) {
      throw new Error('Plugin definition must provide an "id"');
    }
    if (this.plugins.has(definition.id)) {
      throw new Error(`Plugin with id "${definition.id}" already registered`);
    }

    const pluginLogger = this.createPluginLogger(definition.id);
    const storage = createPluginStorage(this.storage, definition.id);
    const instance: PluginInstance = {
      definition,
      storage,
      commands: [],
      eventDisposers: [],
      timers: [],
    };

    const context = this.createPluginContext(definition, instance, pluginLogger);

    try {
      const cleanup = await definition.setup(context);
      if (cleanup) {
        instance.cleanup = cleanup;
      }
      this.plugins.set(definition.id, instance);
      this.logger.info(`Plugin registered: ${definition.id}`);
      return {
        id: definition.id,
        definition,
        dispose: async () => {
          await this.unregisterPlugin(definition.id);
        },
      };
    } catch (err) {
      this.logger.error(`Plugin setup failed for ${definition.id}`, err);
      await this.disposeInstance(definition.id, instance);
      throw err;
    }
  }

  async unregisterPlugin(pluginId: string): Promise<void> {
    const instance = this.plugins.get(pluginId);
    if (!instance) {
      return;
    }
    this.plugins.delete(pluginId);
    await this.disposeInstance(pluginId, instance);
    this.logger.info(`Plugin unregistered: ${pluginId}`);
  }

  private async disposeInstance(pluginId: string, instance: PluginInstance): Promise<void> {
    for (const disposer of instance.eventDisposers) {
      try {
        disposer();
      } catch (err) {
        this.logger.warn(`Failed to dispose event handler for plugin ${pluginId}`, err);
      }
    }
    instance.eventDisposers.length = 0;

    for (const entry of instance.commands) {
      for (const name of entry.names) {
        this.commandIndex.delete(name);
      }
    }
    instance.commands.length = 0;

    for (const timer of instance.timers) {
      if (timer.type === 'timeout') {
        clearTimeout(timer.handle);
      } else {
        clearInterval(timer.handle);
      }
    }
    instance.timers.length = 0;

    if (instance.cleanup) {
      try {
        await instance.cleanup();
      } catch (err) {
        this.logger.warn(`Cleanup failed for plugin ${pluginId}`, err);
      }
    }
  }

  private createPluginLogger(pluginId: string): PluginLogger {
    return {
      debug: (...args: unknown[]) => this.logger.debug(`[${pluginId}]`, ...args),
      info: (...args: unknown[]) => this.logger.info(`[${pluginId}]`, ...args),
      warn: (...args: unknown[]) => this.logger.warn(`[${pluginId}]`, ...args),
      error: (...args: unknown[]) => this.logger.error(`[${pluginId}]`, ...args),
    };
  }

  private createPluginContext(
    definition: PluginDefinition,
    instance: PluginInstance,
    logger: PluginLogger,
  ): PluginContext {
    const on = <K extends PluginEventName>(event: K, handler: PluginEventHandler<K>): (() => void) => {
      const record: RegisteredHandler<PluginEventName> = {
        pluginId: definition.id,
        handler: handler as PluginEventHandler<PluginEventName>,
      };
      let handlers = this.eventHandlers.get(event);
      if (!handlers) {
        handlers = new Set();
        this.eventHandlers.set(event, handlers);
      }
      handlers.add(record);

      const dispose = () => {
        handlers?.delete(record);
      };
      instance.eventDisposers.push(dispose);
      return dispose;
    };

    const once = <K extends PluginEventName>(event: K, handler: PluginEventHandler<K>): (() => void) => {
      const dispose = on(event, async payload => {
        dispose();
        await handler(payload);
      });
      return dispose;
    };

    const registerCommand = (definitionToRegister: CommandDefinition): (() => void) => {
      const allNames = [definitionToRegister.name, ...ensureArray(definitionToRegister.aliases)].map(normaliseCommandName);
      if (allNames.some(name => this.commandIndex.has(name))) {
        throw new Error(`Command name already in use: ${definitionToRegister.name}`);
      }
      for (const name of allNames) {
        this.commandIndex.set(name, { pluginId: definition.id, definition: definitionToRegister });
      }
      instance.commands.push({ definition: definitionToRegister, names: allNames });
      return () => {
        for (const name of allNames) {
          this.commandIndex.delete(name);
        }
        instance.commands = instance.commands.filter(entry => entry.definition !== definitionToRegister);
      };
    };

    const scheduler = {
      setTimeout: (handler: () => void | Promise<void>, ms: number) => {
        const handle = setTimeout(() => {
          void Promise.resolve(handler()).catch(err => logger.error('Scheduled timeout failed', err));
        }, ms);
        instance.timers.push({ type: 'timeout', handle });
        return () => clearTimeout(handle);
      },
      setInterval: (handler: () => void | Promise<void>, ms: number) => {
        const handle = setInterval(() => {
          void Promise.resolve(handler()).catch(err => logger.error('Scheduled interval failed', err));
        }, ms);
        instance.timers.push({ type: 'interval', handle });
        return () => clearInterval(handle);
      },
    };

    return {
      id: definition.id,
      logger,
      storage: instance.storage,
      events: { on, once },
      commands: {
        register: registerCommand,
        list: () => instance.commands.map(entry => entry.definition),
      },
      actions: {
        sendTextMessage: input => this.sendTextMessage(input),
        sendEvent: input => this.sendEvent(input),
        redactEvent: input => this.redactEvent(input),
      },
      matrix: {
        listAccounts: () => this.listAccounts(),
        getAccount: accountId => this.accounts.get(accountId)?.account,
        getClient: accountId => this.accounts.get(accountId)?.client,
      },
      scheduler,
    };
  }

  private ensureAccount(accountId: string): AccountContext {
    const context = this.accounts.get(accountId);
    if (!context) {
      throw new Error(`Unknown account: ${accountId}`);
    }
    return context;
  }

  private buildMessageContent(input: SendTextMessageInput): MatrixMessageContent {
    const content: MatrixMessageContent = {
      body: input.body,
      msgtype: input.msgtype ?? 'm.text',
    };
    if (input.formattedBody) {
      content.format = input.format ?? 'org.matrix.custom.html';
      content.formatted_body = input.formattedBody;
    }
    if (input.additionalContent) {
      Object.assign(content, input.additionalContent);
    }
    return content;
  }

  private async sendTextMessage(input: SendTextMessageInput) {
    const { client } = this.ensureAccount(input.accountId);
    const content = this.buildMessageContent(input);
    const response = await client.sendEvent(input.roomId, 'm.room.message', content as unknown as Record<string, unknown>);
    const eventId = (response as any)?.event_id ?? (response as any)?.eventId ?? '';
    return { eventId };
  }

  private async sendEvent(input: SendEventInput) {
    const { client } = this.ensureAccount(input.accountId);
    const response = await client.sendEvent(input.roomId, input.type, input.content as any);
    const eventId = (response as any)?.event_id ?? (response as any)?.eventId ?? '';
    return { eventId };
  }

  private async redactEvent(input: RedactEventInput) {
    const { client } = this.ensureAccount(input.accountId);
    const opts = input.reason ? { reason: input.reason } : undefined;
    await client.redactEvent(input.roomId, input.eventId, undefined, opts as any);
  }

  async emit<K extends PluginEventName>(event: K, payload: MessengerEvents[K]): Promise<void> {
    const handlers = this.eventHandlers.get(event);
    if (!handlers || handlers.size === 0) {
      return;
    }
    const executions = Array.from(handlers).map(async handler => {
      try {
        await handler.handler(payload as never);
      } catch (err) {
        this.logger.error(`Plugin handler failed for event ${String(event)}`, err);
      }
    });
    await Promise.allSettled(executions);
  }

  registerAccount(account: AccountMetadata, client: MatrixClient): void {
    const context: AccountContext = { account, client };
    this.accounts.set(account.id, context);
    void this.emit('matrix.client-ready', context as ClientRuntime);
  }

  updateAccount(account: AccountMetadata): void {
    const context = this.accounts.get(account.id);
    if (!context) {
      return;
    }
    context.account = account;
    void this.emit('matrix.client-updated', context as ClientRuntime);
  }

  unregisterAccount(accountId: string): void {
    const context = this.accounts.get(accountId);
    if (!context) {
      return;
    }
    this.accounts.delete(accountId);
    void this.emit('matrix.client-stopped', context as ClientRuntime);
  }

  getAccountContext(accountId: string): AccountContext | undefined {
    return this.accounts.get(accountId);
  }

  listAccounts(): AccountMetadata[] {
    return Array.from(this.accounts.values()).map(ctx => ctx.account);
  }

  async executeCommand(invocation: CommandInvocation): Promise<CommandExecutionResult> {
    const name = normaliseCommandName(invocation.command);
    const registration = this.commandIndex.get(name);
    if (!registration) {
      return { command: invocation.command, status: 'not_found' };
    }
    const pluginInstance = this.plugins.get(registration.pluginId);
    if (!pluginInstance) {
      return { command: invocation.command, status: 'not_available', pluginId: registration.pluginId };
    }

    let resultMessage: string | undefined;
    try {
      const context = this.ensureAccount(invocation.accountId);
      const reply = async (content: ReplyContent) => {
        if (!invocation.roomId) {
          throw new Error('Cannot reply without room context');
        }
        if (typeof content === 'string') {
          await this.sendTextMessage({ accountId: invocation.accountId, roomId: invocation.roomId, body: content });
        } else {
          await this.sendTextMessage({
            accountId: invocation.accountId,
            roomId: invocation.roomId,
            body: content.body,
            msgtype: content.msgtype,
            formattedBody: content.formattedBody,
            format: content.format,
            additionalContent: content.additionalContent as Partial<MatrixMessageContent>,
          });
        }
      };

      const commandContext: CommandContext = {
        account: context.account,
        client: context.client,
        roomId: invocation.roomId,
        args: invocation.args ?? [],
        event: invocation.event,
        reply,
      };

      const handlerResult = await registration.definition.handler(commandContext);
      if (typeof handlerResult === 'string') {
        resultMessage = handlerResult;
      } else if (handlerResult && typeof handlerResult === 'object') {
        resultMessage = handlerResult.message;
      }

      await this.emit('command.invoked', {
        command: invocation.command,
        args: invocation.args ?? [],
        account: context.account,
        roomId: invocation.roomId,
        event: invocation.event,
        pluginId: registration.pluginId,
      } as MessengerEvents['command.invoked']);

      return {
        command: invocation.command,
        pluginId: registration.pluginId,
        status: 'ok',
        message: resultMessage,
      };
    } catch (err) {
      this.logger.error(`Command execution failed: ${invocation.command}`, err);
      return {
        command: invocation.command,
        pluginId: registration.pluginId,
        status: 'error',
        error: err,
        message: resultMessage,
      };
    }
  }
}
