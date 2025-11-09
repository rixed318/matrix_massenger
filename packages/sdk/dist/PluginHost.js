import { createMemoryStorageAdapter, createPluginStorage, } from './storage';
const normaliseCommandName = (name) => name.trim().toLowerCase();
const ensureArray = (value) => {
    if (!value) {
        return [];
    }
    return Array.isArray(value) ? value : [value];
};
const DEFAULT_LOGGER = {
    debug: (...args) => console.debug('[matrix-sdk]', ...args),
    info: (...args) => console.info('[matrix-sdk]', ...args),
    warn: (...args) => console.warn('[matrix-sdk]', ...args),
    error: (...args) => console.error('[matrix-sdk]', ...args),
};
export class PluginHost {
    constructor(options = {}) {
        this.plugins = new Map();
        this.eventHandlers = new Map();
        this.commandIndex = new Map();
        this.accounts = new Map();
        this.logger = options.logger ?? DEFAULT_LOGGER;
        this.storage = options.storage ?? createMemoryStorageAdapter();
    }
    /** Returns the ids of all active plugins. */
    getPluginIds() {
        return Array.from(this.plugins.keys());
    }
    /** Returns metadata for all registered commands. */
    getRegisteredCommands() {
        const result = [];
        for (const instance of this.plugins.values()) {
            for (const entry of instance.commands) {
                result.push({ pluginId: instance.definition.id, definition: entry.definition, names: [...entry.names] });
            }
        }
        return result;
    }
    async registerPlugin(definition) {
        if (!definition.id) {
            throw new Error('Plugin definition must provide an "id"');
        }
        if (this.plugins.has(definition.id)) {
            throw new Error(`Plugin with id "${definition.id}" already registered`);
        }
        const pluginLogger = this.createPluginLogger(definition.id);
        const storage = createPluginStorage(this.storage, definition.id);
        const instance = {
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
        }
        catch (err) {
            this.logger.error(`Plugin setup failed for ${definition.id}`, err);
            await this.disposeInstance(definition.id, instance);
            throw err;
        }
    }
    async unregisterPlugin(pluginId) {
        const instance = this.plugins.get(pluginId);
        if (!instance) {
            return;
        }
        this.plugins.delete(pluginId);
        await this.disposeInstance(pluginId, instance);
        this.logger.info(`Plugin unregistered: ${pluginId}`);
    }
    async disposeInstance(pluginId, instance) {
        for (const disposer of instance.eventDisposers) {
            try {
                disposer();
            }
            catch (err) {
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
            }
            else {
                clearInterval(timer.handle);
            }
        }
        instance.timers.length = 0;
        if (instance.cleanup) {
            try {
                await instance.cleanup();
            }
            catch (err) {
                this.logger.warn(`Cleanup failed for plugin ${pluginId}`, err);
            }
        }
    }
    createPluginLogger(pluginId) {
        return {
            debug: (...args) => this.logger.debug(`[${pluginId}]`, ...args),
            info: (...args) => this.logger.info(`[${pluginId}]`, ...args),
            warn: (...args) => this.logger.warn(`[${pluginId}]`, ...args),
            error: (...args) => this.logger.error(`[${pluginId}]`, ...args),
        };
    }
    createPluginContext(definition, instance, logger) {
        const on = (event, handler) => {
            const record = {
                pluginId: definition.id,
                handler: handler,
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
        const once = (event, handler) => {
            const dispose = on(event, async (payload) => {
                dispose();
                await handler(payload);
            });
            return dispose;
        };
        const registerCommand = (definitionToRegister) => {
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
            setTimeout: (handler, ms) => {
                const handle = setTimeout(() => {
                    void Promise.resolve(handler()).catch(err => logger.error('Scheduled timeout failed', err));
                }, ms);
                instance.timers.push({ type: 'timeout', handle });
                return () => clearTimeout(handle);
            },
            setInterval: (handler, ms) => {
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
    ensureAccount(accountId) {
        const context = this.accounts.get(accountId);
        if (!context) {
            throw new Error(`Unknown account: ${accountId}`);
        }
        return context;
    }
    buildMessageContent(input) {
        const content = {
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
    async sendTextMessage(input) {
        const { client } = this.ensureAccount(input.accountId);
        const content = this.buildMessageContent(input);
        const response = await client.sendEvent(input.roomId, 'm.room.message', content);
        const eventId = response?.event_id ?? response?.eventId ?? '';
        return { eventId };
    }
    async sendEvent(input) {
        const { client } = this.ensureAccount(input.accountId);
        const response = await client.sendEvent(input.roomId, input.type, input.content);
        const eventId = response?.event_id ?? response?.eventId ?? '';
        return { eventId };
    }
    async redactEvent(input) {
        const { client } = this.ensureAccount(input.accountId);
        const opts = input.reason ? { reason: input.reason } : undefined;
        await client.redactEvent(input.roomId, input.eventId, undefined, opts);
    }
    async emit(event, payload) {
        const handlers = this.eventHandlers.get(event);
        if (!handlers || handlers.size === 0) {
            return;
        }
        const executions = Array.from(handlers).map(async (handler) => {
            try {
                await handler.handler(payload);
            }
            catch (err) {
                this.logger.error(`Plugin handler failed for event ${String(event)}`, err);
            }
        });
        await Promise.allSettled(executions);
    }
    registerAccount(account, client) {
        const context = { account, client };
        this.accounts.set(account.id, context);
        void this.emit('matrix.client-ready', context);
    }
    updateAccount(account) {
        const context = this.accounts.get(account.id);
        if (!context) {
            return;
        }
        context.account = account;
        void this.emit('matrix.client-updated', context);
    }
    unregisterAccount(accountId) {
        const context = this.accounts.get(accountId);
        if (!context) {
            return;
        }
        this.accounts.delete(accountId);
        void this.emit('matrix.client-stopped', context);
    }
    getAccountContext(accountId) {
        return this.accounts.get(accountId);
    }
    listAccounts() {
        return Array.from(this.accounts.values()).map(ctx => ctx.account);
    }
    async executeCommand(invocation) {
        const name = normaliseCommandName(invocation.command);
        const registration = this.commandIndex.get(name);
        if (!registration) {
            return { command: invocation.command, status: 'not_found' };
        }
        const pluginInstance = this.plugins.get(registration.pluginId);
        if (!pluginInstance) {
            return { command: invocation.command, status: 'not_available', pluginId: registration.pluginId };
        }
        let resultMessage;
        try {
            const context = this.ensureAccount(invocation.accountId);
            const reply = async (content) => {
                if (!invocation.roomId) {
                    throw new Error('Cannot reply without room context');
                }
                if (typeof content === 'string') {
                    await this.sendTextMessage({ accountId: invocation.accountId, roomId: invocation.roomId, body: content });
                }
                else {
                    await this.sendTextMessage({
                        accountId: invocation.accountId,
                        roomId: invocation.roomId,
                        body: content.body,
                        msgtype: content.msgtype,
                        formattedBody: content.formattedBody,
                        format: content.format,
                        additionalContent: content.additionalContent,
                    });
                }
            };
            const commandContext = {
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
            }
            else if (handlerResult && typeof handlerResult === 'object') {
                resultMessage = handlerResult.message;
            }
            await this.emit('command.invoked', {
                command: invocation.command,
                args: invocation.args ?? [],
                account: context.account,
                roomId: invocation.roomId,
                event: invocation.event,
                pluginId: registration.pluginId,
            });
            return {
                command: invocation.command,
                pluginId: registration.pluginId,
                status: 'ok',
                message: resultMessage,
            };
        }
        catch (err) {
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
//# sourceMappingURL=PluginHost.js.map