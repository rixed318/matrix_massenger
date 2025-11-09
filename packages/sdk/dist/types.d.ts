import type { MatrixClient as MatrixJsClient, MatrixEvent as MatrixJsEvent, Room as MatrixJsRoom, IContent } from 'matrix-js-sdk';
export type MatrixClient = MatrixJsClient;
export type MatrixEvent = MatrixJsEvent;
export type MatrixRoom = MatrixJsRoom;
export type MatrixMessageContent = IContent;
export interface AccountMetadata {
    id: string;
    userId: string;
    homeserverUrl: string;
    displayName?: string | null;
    avatarUrl?: string | null;
    /** Human readable label shown in UI selections. */
    label?: string;
    /** Arbitrary metadata supplied by the host application. */
    data?: Record<string, unknown>;
}
export interface ClientRuntime {
    account: AccountMetadata;
    client: MatrixClient;
}
export type TimelineDirection = 'forward' | 'backward';
export interface RoomEventPayload {
    account: AccountMetadata;
    client: MatrixClient;
    roomId: string;
    event: MatrixEvent;
    /** Indicates whether the event arrived in the live timeline (true) or from history pagination (false). */
    isLiveEvent: boolean;
    direction: TimelineDirection;
    /** Additional data forwarded from the Matrix SDK timeline listener. */
    data?: Record<string, unknown>;
}
export interface MessageEventPayload extends RoomEventPayload {
    content: MatrixMessageContent;
    messageType: string;
}
export interface CommandInvocationPayload {
    command: string;
    args: string[];
    account?: AccountMetadata;
    roomId?: string;
    event?: MatrixEvent;
    pluginId?: string;
}
export interface MessengerEvents {
    'matrix.client-ready': ClientRuntime;
    'matrix.client-updated': ClientRuntime;
    'matrix.client-stopped': ClientRuntime;
    'matrix.room-event': RoomEventPayload;
    'matrix.message': MessageEventPayload;
    'command.invoked': CommandInvocationPayload;
}
export type PluginEventName = keyof MessengerEvents;
export interface SendTextMessageInput {
    accountId: string;
    roomId: string;
    body: string;
    msgtype?: string;
    formattedBody?: string;
    format?: string;
    additionalContent?: Partial<MatrixMessageContent>;
}
export interface SendEventInput {
    accountId: string;
    roomId: string;
    type: string;
    content: Record<string, unknown>;
}
export interface RedactEventInput {
    accountId: string;
    roomId: string;
    eventId: string;
    reason?: string;
}
export interface MatrixSendResult {
    eventId: string;
}
export interface CommandInvocation {
    command: string;
    accountId: string;
    roomId?: string;
    args?: string[];
    event?: MatrixEvent;
}
export interface CommandExecutionResult {
    command: string;
    pluginId?: string;
    status: 'ok' | 'error' | 'not_found' | 'not_available';
    message?: string;
    error?: unknown;
}
export interface PluginLogger {
    debug(...args: unknown[]): void;
    info(...args: unknown[]): void;
    warn(...args: unknown[]): void;
    error(...args: unknown[]): void;
}
//# sourceMappingURL=types.d.ts.map