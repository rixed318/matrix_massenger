import { type PluginStorageAdapter } from './storage';
import { type CommandDefinition, type PluginDefinition, type PluginHandle } from './plugin';
import { type AccountMetadata, type CommandExecutionResult, type CommandInvocation, type MatrixClient, type MessengerEvents, type PluginEventName, type PluginLogger } from './types';
export interface PluginHostOptions {
    logger?: PluginLogger;
    storage?: PluginStorageAdapter;
}
interface AccountContext {
    account: AccountMetadata;
    client: MatrixClient;
}
export declare class PluginHost {
    private readonly logger;
    private readonly storage;
    private readonly plugins;
    private readonly eventHandlers;
    private readonly commandIndex;
    private readonly accounts;
    constructor(options?: PluginHostOptions);
    /** Returns the ids of all active plugins. */
    getPluginIds(): string[];
    /** Returns metadata for all registered commands. */
    getRegisteredCommands(): Array<{
        pluginId: string;
        definition: CommandDefinition;
        names: string[];
    }>;
    registerPlugin(definition: PluginDefinition): Promise<PluginHandle>;
    unregisterPlugin(pluginId: string): Promise<void>;
    private disposeInstance;
    private createPluginLogger;
    private createPluginContext;
    private ensureAccount;
    private buildMessageContent;
    private sendTextMessage;
    private sendEvent;
    private redactEvent;
    emit<K extends PluginEventName>(event: K, payload: MessengerEvents[K]): Promise<void>;
    registerAccount(account: AccountMetadata, client: MatrixClient): void;
    updateAccount(account: AccountMetadata): void;
    unregisterAccount(accountId: string): void;
    getAccountContext(accountId: string): AccountContext | undefined;
    listAccounts(): AccountMetadata[];
    executeCommand(invocation: CommandInvocation): Promise<CommandExecutionResult>;
}
export {};
//# sourceMappingURL=PluginHost.d.ts.map