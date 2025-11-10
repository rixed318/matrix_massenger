import type {
  CommandDefinition,
  PluginEventName,
  SendEventInput,
  SendTextMessageInput,
  RedactEventInput,
  AccountMetadata,
} from '@matrix-messenger/sdk';
import type { ConfigureAnimatedReactionsPayload } from '../types/animatedReactions';

export const SANDBOX_MESSAGE = {
  INIT: 'sandbox:init',
  READY: 'sandbox:ready',
  EVENT: 'sandbox:event',
  SUBSCRIBE: 'sandbox:event-subscribe',
  UNSUBSCRIBE: 'sandbox:event-unsubscribe',
  REGISTER_COMMAND: 'sandbox:register-command',
  UNREGISTER_COMMAND: 'sandbox:unregister-command',
  COMMAND_INVOKE: 'sandbox:command-invoke',
  COMMAND_RESULT: 'sandbox:command-result',
  ACTION_REQUEST: 'sandbox:action-request',
  ACTION_RESPONSE: 'sandbox:action-response',
  STORAGE_REQUEST: 'sandbox:storage-request',
  STORAGE_RESPONSE: 'sandbox:storage-response',
  MATRIX_REQUEST: 'sandbox:matrix-request',
  MATRIX_RESPONSE: 'sandbox:matrix-response',
  LOG: 'sandbox:log',
  ERROR: 'sandbox:error',
  DISPOSE: 'sandbox:dispose',
  UI_RENDER: 'sandbox:ui-render',
} as const;

export type SandboxMessageType = typeof SANDBOX_MESSAGE[keyof typeof SANDBOX_MESSAGE];

export type SandboxActionName = keyof SandboxActionPayloads;

export interface SandboxActionPayloads {
  sendTextMessage: SendTextMessageInput;
  sendEvent: SendEventInput;
  redactEvent: RedactEventInput;
  configureAnimatedReactions: ConfigureAnimatedReactionsPayload;
  getAnimatedReactionsPreference: Record<string, never>;
}

export type SandboxActionRequest = {
  type: typeof SANDBOX_MESSAGE.ACTION_REQUEST;
  requestId: number;
  action: SandboxActionName;
  payload: SandboxActionPayloads[SandboxActionName];
};

export type SandboxActionResponse = {
  type: typeof SANDBOX_MESSAGE.ACTION_RESPONSE;
  requestId: number;
  success: boolean;
  result?: unknown;
  error?: string;
};

export type SandboxCommandInvoke = {
  type: typeof SANDBOX_MESSAGE.COMMAND_INVOKE;
  requestId: number;
  handlerId: number;
  command: string;
  invocation: {
    account: AccountMetadata;
    roomId?: string;
    args: string[];
    event?: unknown;
  };
};

export type SandboxCommandResult = {
  type: typeof SANDBOX_MESSAGE.COMMAND_RESULT;
  requestId: number;
  success: boolean;
  result?: unknown;
  error?: string;
};

export type SandboxStorageOperation =
  | { op: 'get'; key: string }
  | { op: 'set'; key: string; value: unknown }
  | { op: 'delete'; key: string }
  | { op: 'keys' }
  | { op: 'clear' };

export type SandboxStorageRequest = {
  type: typeof SANDBOX_MESSAGE.STORAGE_REQUEST;
  requestId: number;
  operation: SandboxStorageOperation;
};

export type SandboxStorageResponse = {
  type: typeof SANDBOX_MESSAGE.STORAGE_RESPONSE;
  requestId: number;
  success: boolean;
  result?: unknown;
  error?: string;
};

export type SandboxMatrixOperation =
  | { op: 'listAccounts' }
  | { op: 'getAccount'; accountId: string };

export type SandboxMatrixRequest = {
  type: typeof SANDBOX_MESSAGE.MATRIX_REQUEST;
  requestId: number;
  operation: SandboxMatrixOperation;
};

export type SandboxMatrixResponse = {
  type: typeof SANDBOX_MESSAGE.MATRIX_RESPONSE;
  requestId: number;
  success: boolean;
  result?: unknown;
  error?: string;
};

export type SandboxInitMessage = {
  type: typeof SANDBOX_MESSAGE.INIT;
  manifest: {
    id: string;
    name: string;
    entry: string;
    version?: string;
    description?: string;
  };
  entryUrl: string;
  allowedEvents: PluginEventName[];
  allowedActions: SandboxActionName[];
  allowStorage: boolean;
  allowScheduler: boolean;
  allowUiPanel: boolean;
  allowBackground: boolean;
  surfaces: Array<{ id: string; location: string }>;
};

export type SandboxReadyMessage = {
  type: typeof SANDBOX_MESSAGE.READY;
};

export type SandboxEventSubscription =
  | {
      type: typeof SANDBOX_MESSAGE.SUBSCRIBE;
      event: PluginEventName;
    }
  | {
      type: typeof SANDBOX_MESSAGE.UNSUBSCRIBE;
      event: PluginEventName;
    };

export type SerializedCommandDefinition = Omit<CommandDefinition, 'handler'> & {
  handlerId: number;
};

export type SandboxRegisterCommand = {
  type: typeof SANDBOX_MESSAGE.REGISTER_COMMAND;
  definition: SerializedCommandDefinition;
};

export type SandboxUnregisterCommand = {
  type: typeof SANDBOX_MESSAGE.UNREGISTER_COMMAND;
  handlerId: number;
};

export type SandboxEventMessage = {
  type: typeof SANDBOX_MESSAGE.EVENT;
  event: PluginEventName;
  payload: unknown;
};

export type SandboxLogMessage = {
  type: typeof SANDBOX_MESSAGE.LOG;
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
  args?: unknown[];
};

export type SandboxErrorMessage = {
  type: typeof SANDBOX_MESSAGE.ERROR;
  error: string;
};

export type SandboxDisposeMessage = {
  type: typeof SANDBOX_MESSAGE.DISPOSE;
  reason?: string;
};

export type SandboxOutboundMessage =
  | SandboxReadyMessage
  | SandboxEventSubscription
  | SandboxRegisterCommand
  | SandboxUnregisterCommand
  | SandboxActionRequest
  | SandboxCommandResult
  | SandboxStorageRequest
  | SandboxMatrixRequest
  | SandboxLogMessage
  | SandboxErrorMessage
  | SandboxUiRenderMessage;

export type SandboxInboundMessage =
  | SandboxInitMessage
  | SandboxEventMessage
  | SandboxCommandInvoke
  | SandboxActionResponse
  | SandboxStorageResponse
  | SandboxMatrixResponse
  | SandboxDisposeMessage;

export type SandboxUiRenderMessage = {
  type: typeof SANDBOX_MESSAGE.UI_RENDER;
  surfaceId: string;
  payload: unknown;
};
