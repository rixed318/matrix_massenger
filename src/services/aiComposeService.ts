import { ClientEvent } from 'matrix-js-sdk';
import type { MatrixClient, MatrixEvent, MatrixRoom, DraftContent, DraftAttachment } from '../types';

export interface SmartReplyPrivacyLimits {
  maxMessages: number;
  /** Maximum number of characters from conversation context sent to the model. */
  maxCharacters: number;
  /** Whether display names and sender IDs are included in the context payload. */
  includeUserNames: boolean;
  /** Whether non-text attachments are summarized for the model. */
  includeMedia: boolean;
}

export interface SmartReplySettings {
  enabled: boolean;
  privacy: SmartReplyPrivacyLimits;
  /** Identifier of the preferred model (if any). */
  model?: string;
  /** Optional endpoint override used when calling a remote service. */
  endpoint?: string;
  /** Optional bearer token or API key for the endpoint. */
  apiKey?: string;
}

export type SmartReplySafetySeverity = 'info' | 'warning' | 'critical';

export interface SmartReplySafetyMetadata {
  blocked: boolean;
  reasons: string[];
  categories?: string[];
  severity?: SmartReplySafetySeverity;
}

export interface SmartReplySuggestion {
  id: string;
  text: string;
  confidence?: number;
  provider?: string;
  safety: SmartReplySafetyMetadata;
  raw?: unknown;
}

export interface SmartReplyComposeOptions {
  limit?: number;
  signal?: AbortSignal;
  endpoint?: string;
  model?: string;
  apiKey?: string;
}

interface InternalSettingsPayload {
  enabled?: boolean;
  privacy?: Partial<SmartReplyPrivacyLimits>;
  model?: string;
  endpoint?: string;
  apiKey?: string;
}

interface ConversationEventPayload {
  eventId: string | null;
  ts: number;
  senderId: string | null;
  senderName: string | null;
  isOwn: boolean;
  body: string;
}

interface ComposeRequestPayload {
  roomId: string;
  roomName?: string | null;
  limit: number;
  privacy: SmartReplyPrivacyLimits;
  messages: ConversationEventPayload[];
  draft?: {
    body: string;
    formatted?: string;
    attachments?: Array<{ name: string; mimeType: string; kind: string; size?: number }>;
    msgtype?: string;
  } | null;
  model?: string;
}

const SMART_REPLY_ACCOUNT_EVENT = 'com.matrix_messenger.smart_reply.settings';
const SMART_REPLY_LOCAL_PREFIX = 'matrix.smart_reply.settings';

const resolveStringEnv = (key: string, fallback?: string): string | undefined => {
  try {
    const env = (import.meta as any)?.env ?? {};
    const value = env[key];
    if (typeof value === 'string' && value.length > 0) {
      return value;
    }
  } catch {
    /* no-op */
  }
  return fallback;
};

const DEFAULT_PRIVACY_LIMITS: SmartReplyPrivacyLimits = {
  maxMessages: 12,
  maxCharacters: 4000,
  includeUserNames: true,
  includeMedia: false,
};

const DEFAULT_SETTINGS: SmartReplySettings = {
  enabled: false,
  privacy: DEFAULT_PRIVACY_LIMITS,
  model: resolveStringEnv('VITE_AI_COMPOSE_MODEL'),
  endpoint: resolveStringEnv('VITE_AI_COMPOSE_URL'),
  apiKey: resolveStringEnv('VITE_AI_COMPOSE_API_KEY'),
};

const settingsCache = new Map<string, SmartReplySettings>();
const listeners = new Map<string, Set<(settings: SmartReplySettings) => void>>();
const clientBindings = new WeakMap<MatrixClient, (event: MatrixEvent) => void>();

const clonePrivacy = (privacy?: SmartReplyPrivacyLimits | null): SmartReplyPrivacyLimits => ({
  maxMessages: Math.max(1, Math.min(privacy?.maxMessages ?? DEFAULT_PRIVACY_LIMITS.maxMessages, 50)),
  maxCharacters: Math.max(500, Math.min(privacy?.maxCharacters ?? DEFAULT_PRIVACY_LIMITS.maxCharacters, 40_000)),
  includeUserNames: typeof privacy?.includeUserNames === 'boolean' ? privacy.includeUserNames : DEFAULT_PRIVACY_LIMITS.includeUserNames,
  includeMedia: typeof privacy?.includeMedia === 'boolean' ? privacy.includeMedia : DEFAULT_PRIVACY_LIMITS.includeMedia,
});

const sanitizeSettings = (value: InternalSettingsPayload | null | undefined): SmartReplySettings => {
  if (!value || typeof value !== 'object') {
    return { ...DEFAULT_SETTINGS, privacy: { ...DEFAULT_PRIVACY_LIMITS } };
  }
  return {
    enabled: typeof value.enabled === 'boolean' ? value.enabled : DEFAULT_SETTINGS.enabled,
    privacy: clonePrivacy(value.privacy as SmartReplyPrivacyLimits | null | undefined),
    model: typeof value.model === 'string' && value.model.length ? value.model : DEFAULT_SETTINGS.model,
    endpoint: typeof value.endpoint === 'string' && value.endpoint.length ? value.endpoint : DEFAULT_SETTINGS.endpoint,
    apiKey: typeof value.apiKey === 'string' && value.apiKey.length ? value.apiKey : DEFAULT_SETTINGS.apiKey,
  };
};

const getUserScopedKey = (client?: MatrixClient | null): string => {
  const userId = client?.getUserId?.();
  if (typeof userId === 'string' && userId.length) {
    return userId;
  }
  return 'default';
};

const readLocalSettings = (scope: string): SmartReplySettings | null => {
  if (typeof window === 'undefined') {
    return null;
  }
  try {
    const raw = window.localStorage?.getItem(`${SMART_REPLY_LOCAL_PREFIX}:${scope}`);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw);
    return sanitizeSettings(parsed);
  } catch (error) {
    console.debug('smart-reply: failed to read local settings', error);
    return null;
  }
};

const writeLocalSettings = (scope: string, settings: SmartReplySettings) => {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    window.localStorage?.setItem(`${SMART_REPLY_LOCAL_PREFIX}:${scope}`, JSON.stringify(settings));
  } catch (error) {
    console.debug('smart-reply: failed to persist settings locally', error);
  }
};

const notifyListeners = (scope: string, settings: SmartReplySettings) => {
  const scoped = listeners.get(scope);
  if (!scoped || scoped.size === 0) {
    return;
  }
  scoped.forEach(listener => {
    try {
      listener(settings);
    } catch (error) {
      console.debug('smart-reply: listener errored', error);
    }
  });
};

const ensureAccountDataListener = (client: MatrixClient, scope: string) => {
  if (clientBindings.has(client)) {
    return;
  }
  const handler = (event: MatrixEvent) => {
    try {
      if (event?.getType?.() !== SMART_REPLY_ACCOUNT_EVENT) {
        return;
      }
      const content = event.getContent?.();
      const sanitized = sanitizeSettings(content as InternalSettingsPayload);
      settingsCache.set(scope, sanitized);
      notifyListeners(scope, sanitized);
      writeLocalSettings(scope, sanitized);
    } catch (error) {
      console.debug('smart-reply: failed to process account data update', error);
    }
  };
  clientBindings.set(client, handler);
  (client as any).on?.(ClientEvent.AccountData, handler);
};

export const getSmartReplySettings = (client?: MatrixClient | null): SmartReplySettings => {
  const scope = getUserScopedKey(client);
  if (settingsCache.has(scope)) {
    return settingsCache.get(scope)!;
  }

  let merged = sanitizeSettings(null);
  const local = readLocalSettings(scope);
  if (local) {
    merged = { ...merged, ...local, privacy: clonePrivacy(local.privacy) };
  }

  try {
    const accountData = client ? (client as any).getAccountData?.(SMART_REPLY_ACCOUNT_EVENT) : null;
    const content = accountData?.getContent?.();
    if (content && typeof content === 'object') {
      const remote = sanitizeSettings(content as InternalSettingsPayload);
      merged = {
        ...merged,
        ...remote,
        privacy: clonePrivacy(remote.privacy),
      };
    }
  } catch (error) {
    console.debug('smart-reply: failed to read account data settings', error);
  }

  settingsCache.set(scope, merged);
  return merged;
};

export const setSmartReplySettings = async (
  client: MatrixClient | null | undefined,
  value: SmartReplySettings,
): Promise<void> => {
  const scope = getUserScopedKey(client);
  const sanitized = {
    ...value,
    privacy: clonePrivacy(value.privacy),
    model: value.model ?? undefined,
    endpoint: value.endpoint ?? undefined,
    apiKey: value.apiKey ?? undefined,
  };
  settingsCache.set(scope, sanitized);
  notifyListeners(scope, sanitized);
  writeLocalSettings(scope, sanitized);

  try {
    if (client) {
      await (client as any).setAccountData?.(SMART_REPLY_ACCOUNT_EVENT, {
        enabled: sanitized.enabled,
        privacy: sanitized.privacy,
        model: sanitized.model,
        endpoint: sanitized.endpoint,
        apiKey: sanitized.apiKey,
      });
    }
  } catch (error) {
    console.warn('smart-reply: failed to persist settings to account data', error);
  }
};

export const observeSmartReplySettings = (
  client: MatrixClient,
  listener: (settings: SmartReplySettings) => void,
): (() => void) => {
  const scope = getUserScopedKey(client);
  ensureAccountDataListener(client, scope);

  const scopedSet = listeners.get(scope) ?? new Set<(settings: SmartReplySettings) => void>();
  listeners.set(scope, scopedSet);
  scopedSet.add(listener);

  try {
    listener(getSmartReplySettings(client));
  } catch (error) {
    console.debug('smart-reply: observer invocation failed', error);
  }

  return () => {
    const set = listeners.get(scope);
    if (!set) {
      return;
    }
    set.delete(listener);
    if (set.size === 0) {
      listeners.delete(scope);
    }
  };
};

const randomId = (): string => {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {
    /* no-op */
  }
  return `ai-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`;
};

const describeAttachmentContent = (content: any): string[] => {
  if (!content || typeof content !== 'object') {
    return [];
  }
  const descriptions: string[] = [];
  const msgType = typeof content.msgtype === 'string' ? content.msgtype : '';
  const body = typeof content.body === 'string' ? content.body : '';
  if (msgType === 'm.image') {
    descriptions.push(`Image${body ? `: ${body}` : ''}`);
  } else if (msgType === 'm.file') {
    descriptions.push(`File${body ? `: ${body}` : ''}`);
  } else if (msgType === 'm.video') {
    descriptions.push(`Video${body ? `: ${body}` : ''}`);
  } else if (msgType === 'm.audio' || msgType === 'm.voice') {
    descriptions.push(`Audio${body ? `: ${body}` : ''}`);
  } else if (msgType === 'm.sticker') {
    descriptions.push(`Sticker${body ? `: ${body}` : ''}`);
  } else if (msgType === 'm.location') {
    descriptions.push(`Location${body ? `: ${body}` : ''}`);
  }
  return descriptions;
};

const sanitizeBody = (body: unknown, maxLength: number): string => {
  if (typeof body !== 'string') {
    return '';
  }
  const trimmed = body.trim();
  if (!trimmed.length) {
    return '';
  }
  if (trimmed.length <= maxLength) {
    return trimmed;
  }
  return `${trimmed.slice(0, maxLength - 3)}...`;
};

const buildConversationContext = (
  client: MatrixClient,
  room: MatrixRoom | null,
  privacy: SmartReplyPrivacyLimits,
): ConversationEventPayload[] => {
  if (!room) {
    return [];
  }
  const timeline = room.getLiveTimeline?.();
  const events = timeline?.getEvents?.() ?? [];
  const eligible = events
    .filter(event => event?.getType?.() === 'm.room.message' && !event.isRedacted?.())
    .sort((a, b) => (a.getTs?.() ?? 0) - (b.getTs?.() ?? 0));

  const maxMessages = Math.max(1, privacy.maxMessages);
  const maxChars = Math.max(500, privacy.maxCharacters);
  const context: ConversationEventPayload[] = [];
  let totalChars = 0;

  for (let i = Math.max(0, eligible.length - maxMessages); i < eligible.length; i += 1) {
    const event = eligible[i];
    const body = sanitizeBody(event.getContent?.()?.body, maxChars);
    if (!body) {
      continue;
    }
    const attachments = privacy.includeMedia ? describeAttachmentContent(event.getContent?.()) : [];
    const withAttachments = attachments.length ? `${body}\n${attachments.map(desc => `[${desc}]`).join('\n')}` : body;
    const length = withAttachments.length;
    if (totalChars + length > maxChars && context.length > 0) {
      break;
    }
    totalChars += length;
    const sender = event.getSender?.() ?? null;
    const member = sender ? room?.getMember?.(sender) ?? null : null;
    context.push({
      eventId: event.getId?.() ?? null,
      ts: event.getTs?.() ?? Date.now(),
      senderId: privacy.includeUserNames ? sender : null,
      senderName: privacy.includeUserNames ? (member?.name ?? sender) ?? null : null,
      isOwn: sender === client.getUserId?.(),
      body: withAttachments,
    });
  }

  return context;
};

const describeDraftAttachments = (attachments: DraftAttachment[] | undefined | null) => {
  if (!attachments || !Array.isArray(attachments)) {
    return [] as Array<{ name: string; mimeType: string; kind: string; size?: number }>;
  }
  return attachments.map(attachment => ({
    name: attachment.name,
    mimeType: attachment.mimeType,
    kind: attachment.kind,
    size: attachment.size,
  }));
};

const createComposePayload = (
  client: MatrixClient,
  roomId: string,
  draft: DraftContent | null | undefined,
  limit: number,
  settings: SmartReplySettings,
): ComposeRequestPayload => {
  const room = client.getRoom?.(roomId) ?? null;
  return {
    roomId,
    roomName: room?.name ?? null,
    limit,
    privacy: settings.privacy,
    messages: buildConversationContext(client, room, settings.privacy),
    draft: draft
      ? {
          body: draft.plain ?? '',
          formatted: draft.formatted ?? undefined,
          attachments: describeDraftAttachments(draft.attachments),
          msgtype: draft.msgtype,
        }
      : null,
    model: settings.model,
  };
};

const inferSafetyMetadata = (raw: any): SmartReplySafetyMetadata => {
  const blocked = Boolean(raw?.blocked ?? raw?.flagged);
  const reasons: string[] = Array.isArray(raw?.reasons)
    ? raw.reasons.filter((reason: unknown) => typeof reason === 'string')
    : [];
  const categories: string[] | undefined = Array.isArray(raw?.categories)
    ? raw.categories.filter((category: unknown) => typeof category === 'string')
    : undefined;
  const severity: SmartReplySafetySeverity | undefined = ['info', 'warning', 'critical'].includes(raw?.severity)
    ? raw.severity
    : undefined;
  return {
    blocked,
    reasons,
    categories,
    severity,
  };
};

const normalizeSuggestions = (raw: any): SmartReplySuggestion[] => {
  if (!raw) {
    return [];
  }
  const suggestionsSource = Array.isArray(raw?.suggestions) ? raw.suggestions : Array.isArray(raw) ? raw : [];
  const normalized: SmartReplySuggestion[] = [];
  for (const entry of suggestionsSource) {
    if (!entry) {
      continue;
    }
    const text = typeof entry.text === 'string' ? entry.text.trim() : typeof entry === 'string' ? entry.trim() : '';
    if (!text) {
      continue;
    }
    const safety = inferSafetyMetadata(entry.safety ?? entry.meta ?? {});
    normalized.push({
      id: typeof entry.id === 'string' && entry.id.length ? entry.id : randomId(),
      text,
      confidence: typeof entry.confidence === 'number' ? entry.confidence : undefined,
      provider: typeof entry.provider === 'string' ? entry.provider : undefined,
      safety,
      raw: entry,
    });
  }
  return normalized;
};

const callRemoteComposeEndpoint = async (
  endpoint: string,
  apiKey: string | undefined,
  payload: ComposeRequestPayload,
  signal?: AbortSignal,
): Promise<SmartReplySuggestion[]> => {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }
  const response = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
    signal,
  });
  if (!response.ok) {
    throw new Error(`AI compose endpoint responded with ${response.status}`);
  }
  const data = await response.json().catch(() => null);
  return normalizeSuggestions(data).filter(suggestion => !suggestion.safety.blocked);
};

const fallbackLocalSuggestions = (payload: ComposeRequestPayload): SmartReplySuggestion[] => {
  const lastMessage = payload.messages.filter(event => !event.isOwn).slice(-1)[0];
  if (!lastMessage) {
    return [];
  }
  const text = lastMessage.body.toLowerCase();
  const suggestions: string[] = [];
  if (/thank/.test(text) || /спасибо/.test(text)) {
    suggestions.push('Пожалуйста!');
    suggestions.push('Всегда рад помочь.');
  }
  if (/meeting|встреч/.test(text)) {
    suggestions.push('Давайте согласуем время.');
  }
  if (/hello|привет/.test(text)) {
    suggestions.push('Привет! Как дела?');
  }
  if (suggestions.length < payload.limit) {
    suggestions.push('Сейчас проверю и отвечу.');
  }
  if (suggestions.length < payload.limit) {
    suggestions.push('Звучит хорошо.');
  }
  return suggestions.slice(0, payload.limit).map(textSuggestion => ({
    id: randomId(),
    text: textSuggestion,
    safety: {
      blocked: false,
      reasons: [],
    },
    provider: 'heuristic',
  }));
};

export const generateSmartReplies = async (
  client: MatrixClient,
  roomId: string,
  draft: DraftContent | null | undefined,
  options: SmartReplyComposeOptions = {},
): Promise<SmartReplySuggestion[]> => {
  const settings = getSmartReplySettings(client);
  if (!settings.enabled) {
    return [];
  }
  const limit = Math.max(1, Math.min(options.limit ?? 3, 6));
  const payload = createComposePayload(client, roomId, draft, limit, settings);
  if (payload.messages.length === 0 && !draft?.plain) {
    return [];
  }

  const endpoint = options.endpoint ?? settings.endpoint;
  const apiKey = options.apiKey ?? settings.apiKey;
  const model = options.model ?? settings.model;
  if (model && !payload.model) {
    payload.model = model;
  }

  if (endpoint) {
    try {
      return await callRemoteComposeEndpoint(endpoint, apiKey, payload, options.signal);
    } catch (error) {
      console.warn('smart-reply: remote compose request failed', error);
    }
  }

  return fallbackLocalSuggestions(payload);
};
