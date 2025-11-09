import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  describePluginPermission,
  disablePlugin,
  enableStoredPlugin,
  getInstalledPlugins,
  removeStoredPlugin,
  type InstalledPluginState,
  type PluginPermission,
  KNOWN_PLUGIN_PERMISSIONS,
} from '../../services/pluginHost';

const formatPermissions = (permissions?: PluginPermission[]): string => {
  if (!permissions || permissions.length === 0) {
    return 'Нет специальных разрешений';
  }
  return permissions.map(permission => describePluginPermission(permission)).join(', ');
};

const PluginRow: React.FC<{
  plugin: InstalledPluginState;
  onToggle: (plugin: InstalledPluginState, enabled: boolean) => Promise<void>;
  onRemove: (plugin: InstalledPluginState) => Promise<void>;
  isBusy: boolean;
}> = ({ plugin, onToggle, onRemove, isBusy }) => {
  const { manifest } = plugin;
  const statusLabel = plugin.enabled
    ? plugin.active ? 'Включён' : 'Ошибка загрузки'
    : 'Выключен';

  const handleToggle = () => {
    void onToggle(plugin, !plugin.enabled);
  };

  const handleRemove = () => {
    if (window.confirm(`Удалить плагин «${manifest.name}»?`)) {
      void onRemove(plugin);
    }
  };

  return (
    <div className="border border-border-primary rounded-lg p-4 space-y-2">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h4 className="text-base font-semibold text-text-primary">{manifest.name}</h4>
          {manifest.version && (
            <span className="text-xs text-text-secondary">Версия {manifest.version}</span>
          )}
        </div>
        <span className="text-xs px-2 py-1 rounded-full bg-bg-tertiary text-text-secondary">{statusLabel}</span>
      </div>
      {manifest.description && (
        <p className="text-sm text-text-secondary">{manifest.description}</p>
      )}
      {plugin.lastError && (
        <p className="text-xs text-red-400">{plugin.lastError}</p>
      )}
      {manifest.requiredEvents && manifest.requiredEvents.length > 0 && (
        <div className="text-xs text-text-secondary">
          <span className="font-semibold text-text-primary">Требуемые события:</span>{' '}
          {manifest.requiredEvents.join(', ')}
        </div>
      )}
      <div className="text-xs text-text-secondary">
        <span className="font-semibold text-text-primary">Разрешения:</span>{' '}
        {formatPermissions(manifest.permissions)}
      </div>
      <div className="flex items-center gap-2 pt-2">
        <button
          type="button"
          className="px-3 py-1 rounded-md bg-accent text-text-inverted text-sm disabled:opacity-60"
          onClick={handleToggle}
          disabled={isBusy}
        >
          {plugin.enabled ? 'Выключить' : 'Включить'}
        </button>
        <button
          type="button"
          className="px-3 py-1 rounded-md border border-border-primary text-sm text-text-secondary hover:text-text-primary"
          onClick={handleRemove}
          disabled={isBusy}
        >
          Удалить
        </button>
      </div>
    </div>
  );
};

const PluginsPanel: React.FC = () => {
  const [plugins, setPlugins] = useState<InstalledPluginState[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getInstalledPlugins();
      setPlugins(data);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleToggle = useCallback(async (plugin: InstalledPluginState, enabled: boolean) => {
    setBusyId(plugin.id);
    try {
      if (enabled) {
        await enableStoredPlugin(plugin.id);
      } else {
        await disablePlugin(plugin.id);
      }
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusyId(null);
    }
  }, [refresh]);

  const handleRemove = useCallback(async (plugin: InstalledPluginState) => {
    setBusyId(plugin.id);
    try {
      await removeStoredPlugin(plugin.id);
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusyId(null);
    }
  }, [refresh]);

  const requestedPermissions = useMemo(() => {
    const requested = new Set<PluginPermission>();
    for (const plugin of plugins) {
      for (const permission of plugin.manifest.permissions ?? []) {
        requested.add(permission);
      }
    }
    return Array.from(requested);
  }, [plugins]);

  return (
    <section className="space-y-4">
      <header className="space-y-1">
        <h3 className="text-lg font-semibold text-text-primary">Плагины</h3>
        <p className="text-sm text-text-secondary">
          Управляйте установленными интеграциями. Вы можете включать или удалять плагины, а также проверять их разрешения.
        </p>
      </header>

      {loading && <div className="text-sm text-text-secondary">Загрузка списка плагинов…</div>}
      {error && !loading && <div className="text-sm text-red-400">{error}</div>}

      {!loading && plugins.length === 0 && (
        <div className="text-sm text-text-secondary">Плагины не установлены.</div>
      )}

      <div className="space-y-3">
        {plugins.map(plugin => (
          <PluginRow
            key={plugin.id}
            plugin={plugin}
            onToggle={handleToggle}
            onRemove={handleRemove}
            isBusy={busyId === plugin.id}
          />
        ))}
      </div>

      {requestedPermissions.length > 0 && (
        <div className="rounded-md bg-bg-secondary p-3 text-xs text-text-secondary">
          <div className="font-semibold text-text-primary mb-1">Активные разрешения плагинов</div>
          <ul className="list-disc list-inside space-y-0.5">
            {KNOWN_PLUGIN_PERMISSIONS.filter(permission => requestedPermissions.includes(permission)).map(permission => (
              <li key={permission}>{describePluginPermission(permission)}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
};

export default PluginsPanel;
