import type { AccountMetadata, MatrixClient, MatrixEvent, PluginEventName, MessengerEvents, PluginLogger, SendTextMessageInput, SendEventInput, RedactEventInput, MatrixSendResult } from './types';
import type { PluginStorage } from './storage';
export type PluginEventHandler<K extends PluginEventName> = (payload: MessengerEvents[K]) => void | Promise<void>;
export interface PluginScheduler {
    setTimeout(handler: () => void | Promise<void>, ms: number): () => void;
    setInterval(handler: () => void | Promise<void>, ms: number): () => void;
}
export interface PluginUiContext {
    render(surfaceId: string, payload: unknown): void;
}
export interface CommandContext {
    account: AccountMetadata;
    client: MatrixClient;
    roomId?: string;
    args: string[];
    event?: MatrixEvent;
    reply(content: ReplyContent): Promise<void>;
}
export type ReplyContent = string | {
    body: string;
    msgtype?: string;
    formattedBody?: string;
    format?: string;
    additionalContent?: Record<string, unknown>;
};
export type CommandHandlerResult = void | string | {
    message?: string;
};
export type CommandHandler = (context: CommandContext) => Promise<CommandHandlerResult> | CommandHandlerResult;
export interface CommandDefinition {
    name: string;
    description: string;
    usage?: string;
    aliases?: string[];
    handler: CommandHandler;
}
export interface PluginContext {
    id: string;
    logger: PluginLogger;
    storage: PluginStorage;
    events: {
        on<K extends PluginEventName>(event: K, handler: PluginEventHandler<K>): () => void;
        once<K extends PluginEventName>(event: K, handler: PluginEventHandler<K>): () => void;
    };
    commands: {
        register(definition: CommandDefinition): () => void;
        list(): CommandDefinition[];
    };
    actions: {
        sendTextMessage(input: SendTextMessageInput): Promise<MatrixSendResult>;
        sendEvent(input: SendEventInput): Promise<MatrixSendResult>;
        redactEvent(input: RedactEventInput): Promise<void>;
    };
    matrix: {
        listAccounts(): AccountMetadata[];
        getAccount(accountId: string): AccountMetadata | undefined;
        getClient(accountId: string): MatrixClient | undefined;
    };
    scheduler: PluginScheduler;
    ui: PluginUiContext;
}
export type PluginCleanup = () => void | Promise<void>;
export interface PluginDefinition {
    id: string;
    name?: string;
    version?: string;
    description?: string;
    setup(context: PluginContext): Promise<void | PluginCleanup> | void | PluginCleanup;
}
export interface PluginHandle {
    id: string;
    definition: PluginDefinition;
    dispose(): Promise<void>;
}
export declare const definePlugin: <T extends PluginDefinition>(definition: T) => T;
//# sourceMappingURL=plugin.d.ts.map