import {
  PluginHost,
  createBrowserStorageAdapter,
  createMemoryStorageAdapter,
  type AccountMetadata,
  type PluginDefinition,
  type PluginEventName,
  type PluginHandle,
} from '@matrix-messenger/sdk';
import type { MatrixClient, MatrixEvent, MatrixRoom } from '../types';

const storage = typeof window !== 'undefined'
  ? createBrowserStorageAdapter('matrix-messenger.plugins')
  : createMemoryStorageAdapter();

export const pluginHost = new PluginHost({ storage });

export const KNOWN_PLUGIN_EVENTS: PluginEventName[] = [
  'matrix.client-ready',
  'matrix.client-updated',
  'matrix.client-stopped',
  'matrix.room-event',
  'matrix.message',
  'command.invoked',
];

export const KNOWN_PLUGIN_PERMISSIONS = [
  'sendTextMessage',
  'sendEvent',
  'redactEvent',
  'storage',
  'scheduler',
] as const;

export type PluginPermission = typeof KNOWN_PLUGIN_PERMISSIONS[number];

const PERMISSION_DESCRIPTIONS: Record<PluginPermission, string> = {
  sendTextMessage: 'Отправка текстовых сообщений от имени выбранного аккаунта',
  sendEvent: 'Отправка произвольных событий в комнату Matrix',
  redactEvent: 'Удаление (redact) событий в комнатах Matrix',
  storage: 'Доступ к изолированному хранилищу плагина',
  scheduler: 'Запуск фоновых таймеров внутри плагина',
};

export const describePluginPermission = (permission: PluginPermission): string =>
  PERMISSION_DESCRIPTIONS[permission] ?? permission;

export interface PluginManifest {
  id: string;
  name: string;
  version?: string;
  description?: string;
  entry: string;
  permissions?: PluginPermission[];
  requiredEvents?: PluginEventName[];
}

interface StoredPluginEntry {
  manifest: PluginManifest;
  enabled: boolean;
  lastError?: string;
}

type StoredPluginState = Record<string, StoredPluginEntry>;

const PLUGIN_STORAGE_KEY = 'matrix-messenger.plugins.preferences';

const pluginHandles = new Map<string, PluginHandle>();
let manifestCache: PluginManifest[] | null = null;

const readStoredPlugins = (): StoredPluginState => {
  if (typeof window === 'undefined') {
    return {};
  }
  try {
    const raw = window.localStorage.getItem(PLUGIN_STORAGE_KEY);
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw) as StoredPluginState;
    if (!parsed || typeof parsed !== 'object') {
      return {};
    }
    return parsed;
  } catch (error) {
    console.warn('Failed to read stored plugins', error);
    return {};
  }
};

const writeStoredPlugins = (state: StoredPluginState) => {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    window.localStorage.setItem(PLUGIN_STORAGE_KEY, JSON.stringify(state));
  } catch (error) {
    console.warn('Failed to persist plugin preferences', error);
  }
};

const validateManifest = (manifest: PluginManifest): PluginManifest => {
  if (!manifest || typeof manifest !== 'object') {
    throw new Error('Некорректный манифест плагина');
  }
  const { id, name, entry, permissions, requiredEvents } = manifest;
  if (!id || typeof id !== 'string') {
    throw new Error('Манифест должен содержать строковый "id"');
  }
  if (!name || typeof name !== 'string') {
    throw new Error(`Плагин "${id}" должен содержать название`);
  }
  if (!entry || typeof entry !== 'string') {
    throw new Error(`Плагин "${id}" должен содержать путь к модулю`);
  }
  if (permissions) {
    for (const permission of permissions) {
      if (!KNOWN_PLUGIN_PERMISSIONS.includes(permission)) {
        throw new Error(`Плагин "${id}" запрашивает неизвестное разрешение "${permission}"`);
      }
    }
  }
  if (requiredEvents) {
    for (const event of requiredEvents) {
      if (!KNOWN_PLUGIN_EVENTS.includes(event)) {
        throw new Error(`Плагин "${id}" запрашивает неподдерживаемое событие "${event}"`);
      }
    }
  }
  return manifest;
};

const resolveEntryUrl = (entry: string): string => {
  if (typeof window === 'undefined') {
    return entry;
  }
  try {
    return new URL(entry, window.location.origin).toString();
  } catch (error) {
    console.warn('Failed to resolve plugin entry, using raw value', error);
    return entry;
  }
};

const loadPluginModule = async (manifest: PluginManifest): Promise<PluginDefinition> => {
  const url = resolveEntryUrl(manifest.entry);
  const module = await import(/* @vite-ignore */ url);
  const definition = (module?.default ?? module) as PluginDefinition | undefined;
  if (!definition || typeof definition !== 'object' || typeof definition.setup !== 'function') {
    throw new Error(`Модуль плагина "${manifest.id}" не экспортирует корректное определение`);
  }
  if (definition.id && definition.id !== manifest.id) {
    console.warn(`Идентификатор манифеста (${manifest.id}) отличается от id в модуле (${definition.id}). Используется значение из модуля.`);
  }
  return definition;
};

const registerPluginFromManifest = async (manifest: PluginManifest): Promise<void> => {
  const definition = await loadPluginModule(manifest);
  const handle = await pluginHost.registerPlugin({ ...definition, id: definition.id ?? manifest.id });
  pluginHandles.set(manifest.id, handle);
};

const unregisterPlugin = async (pluginId: string): Promise<void> => {
  const existingHandle = pluginHandles.get(pluginId);
  if (existingHandle) {
    pluginHandles.delete(pluginId);
    await existingHandle.dispose();
    return;
  }
  await pluginHost.unregisterPlugin(pluginId);
};

const updateStoredEntry = (pluginId: string, updater: (entry: StoredPluginEntry | undefined) => StoredPluginEntry | undefined) => {
  const state = readStoredPlugins();
  const next = updater(state[pluginId]);
  if (next) {
    state[pluginId] = next;
  } else {
    delete state[pluginId];
  }
  writeStoredPlugins(state);
};

export const getPluginRegistry = async (): Promise<PluginManifest[]> => {
  if (manifestCache) {
    return manifestCache;
  }
  if (typeof window === 'undefined' || typeof fetch === 'undefined') {
    return [];
  }
  const registryUrl = new URL('../../plugins/registry.json', import.meta.url);
  const response = await fetch(registryUrl.toString());
  if (!response.ok) {
    throw new Error('Не удалось загрузить каталог плагинов');
  }
  const payload = await response.json();
  const items: unknown = payload?.plugins ?? payload;
  if (!Array.isArray(items)) {
    throw new Error('Каталог плагинов имеет неверный формат');
  }
  manifestCache = items.map(item => {
    const manifest = validateManifest(item as PluginManifest);
    return {
      ...manifest,
      entry: new URL(manifest.entry, registryUrl).toString(),
    } satisfies PluginManifest;
  });
  return manifestCache;
};

export interface InstalledPluginState {
  id: string;
  manifest: PluginManifest;
  enabled: boolean;
  active: boolean;
  lastError?: string;
}

export const getInstalledPlugins = async (): Promise<InstalledPluginState[]> => {
  const registry = await getPluginRegistry().catch(() => null);
  const registryById = new Map(registry?.map(item => [item.id, item] as const) ?? []);
  const state = readStoredPlugins();
  const activeIds = new Set(pluginHost.getPluginIds());
  return Object.entries(state)
    .map(([id, entry]) => {
      const manifest = registryById.get(id) ?? entry.manifest;
      return {
        id,
        manifest,
        enabled: entry.enabled,
        active: activeIds.has(id),
        lastError: entry.lastError,
      } satisfies InstalledPluginState;
    })
    .sort((a, b) => a.manifest.name.localeCompare(b.manifest.name));
};

const activatePlugin = async (manifest: PluginManifest): Promise<void> => {
  validateManifest(manifest);
  await registerPluginFromManifest(manifest);
};

export const installPluginFromManifest = async (manifest: PluginManifest): Promise<void> => {
  validateManifest(manifest);
  try {
    await activatePlugin(manifest);
    updateStoredEntry(manifest.id, () => ({ manifest, enabled: true }));
  } catch (error) {
    updateStoredEntry(manifest.id, () => ({ manifest, enabled: false, lastError: (error as Error).message }));
    throw error;
  }
};

export const enableStoredPlugin = async (pluginId: string): Promise<void> => {
  const state = readStoredPlugins();
  const entry = state[pluginId];
  if (!entry) {
    throw new Error('Плагин не найден в локальном списке');
  }
  await activatePlugin(entry.manifest);
  updateStoredEntry(pluginId, current => current ? { ...current, enabled: true, lastError: undefined } : undefined);
};

export const disablePlugin = async (pluginId: string): Promise<void> => {
  await unregisterPlugin(pluginId);
  updateStoredEntry(pluginId, current => current ? { ...current, enabled: false } : undefined);
};

export const removeStoredPlugin = async (pluginId: string): Promise<void> => {
  await unregisterPlugin(pluginId);
  updateStoredEntry(pluginId, () => undefined);
};

export const bootstrapStoredPlugins = async (): Promise<void> => {
  if (typeof window === 'undefined') {
    return;
  }
  const state = readStoredPlugins();
  let changed = false;
  for (const entry of Object.values(state)) {
    if (!entry.enabled) {
      continue;
    }
    try {
      await activatePlugin(entry.manifest);
      if (entry.lastError) {
        entry.lastError = undefined;
        changed = true;
      }
    } catch (error) {
      console.error('Не удалось активировать плагин', entry.manifest.id, error);
      entry.lastError = (error as Error).message;
      entry.enabled = false;
      changed = true;
    }
  }
  if (changed) {
    writeStoredPlugins(state);
  }
};

type AccountRegistration = {
  key: string;
  client: MatrixClient;
  userId: string;
  homeserverUrl: string;
  displayName?: string | null;
  avatarUrl?: string | null;
};

const accountListeners = new Map<string, { timeline: (...args: any[]) => void }>();

const toMetadata = (registration: AccountRegistration): AccountMetadata => ({
  id: registration.key,
  userId: registration.userId,
  homeserverUrl: registration.homeserverUrl,
  displayName: registration.displayName ?? undefined,
  avatarUrl: registration.avatarUrl ?? undefined,
  label: registration.displayName ?? registration.userId,
});

const emitTimeline = (
  accountId: string,
  event: MatrixEvent,
  room?: MatrixRoom | null,
  toStartOfTimeline?: boolean,
  _removed?: boolean,
  data?: Record<string, unknown>,
) => {
  if (!room) {
    return;
  }
  const context = pluginHost.getAccountContext(accountId);
  if (!context) {
    return;
  }
  const payload = {
    account: context.account,
    client: context.client,
    roomId: room.roomId,
    event,
    data,
    isLiveEvent: Boolean((data as any)?.liveEvent ?? (data as any)?.timeline?.getLiveTimeline?.()),
    direction: toStartOfTimeline ? 'backward' as const : 'forward' as const,
  };
  void pluginHost.emit('matrix.room-event', payload);
  if (event.getType?.() === 'm.room.message') {
    const content = event.getContent();
    void pluginHost.emit('matrix.message', {
      ...payload,
      content: content as any,
      messageType: (content?.msgtype ?? 'm.text') as string,
    });
  }
};

export const attachAccountToPluginHost = (registration: AccountRegistration): (() => void) => {
  pluginHost.registerAccount(toMetadata(registration), registration.client);
  const timelineHandler = (
    event: MatrixEvent,
    room?: MatrixRoom,
    toStartOfTimeline?: boolean,
    removed?: boolean,
    data?: Record<string, unknown>,
  ) => emitTimeline(registration.key, event, room, toStartOfTimeline, removed, data);
  (registration.client as any).on?.('Room.timeline', timelineHandler);
  accountListeners.set(registration.key, { timeline: timelineHandler });

  return () => {
    const current = accountListeners.get(registration.key);
    if (current) {
      (registration.client as any).removeListener?.('Room.timeline', current.timeline);
      accountListeners.delete(registration.key);
    }
    pluginHost.unregisterAccount(registration.key);
  };
};

export const updateAccountForPlugins = (registration: AccountRegistration): void => {
  pluginHost.updateAccount(toMetadata(registration));
};

export const registerExternalPlugin = (definition: PluginDefinition) => pluginHost.registerPlugin(definition);

declare global {
  interface Window {
    matrixMessenger?: {
      host: PluginHost;
      registerPlugin: (definition: PluginDefinition) => Promise<PluginHandle>;
    };
  }
}

if (typeof window !== 'undefined') {
  window.matrixMessenger = window.matrixMessenger ?? {
    host: pluginHost,
    registerPlugin: (definition: PluginDefinition) => pluginHost.registerPlugin(definition),
  };
}
