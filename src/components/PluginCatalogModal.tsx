import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  describePluginPermission,
  disablePlugin,
  enableStoredPlugin,
  getInstalledPlugins,
  getPluginRegistry,
  installPluginFromManifest,
  type InstalledPluginState,
  type PluginManifest,
} from '../services/pluginHost';

interface PluginCatalogModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const buildWarningMessage = (manifest: PluginManifest): string => {
  const permissions = manifest.permissions?.length
    ? manifest.permissions.map(permission => `• ${describePluginPermission(permission)}`).join('\n')
    : '• Нет специальных разрешений';
  const events = manifest.requiredEvents?.length
    ? manifest.requiredEvents.map(event => `• ${event}`).join('\n')
    : '• Не подписывается на события автоматически';
  return `Плагин «${manifest.name}» запрашивает следующие права:\n\nРазрешения:\n${permissions}\n\nСобытия:\n${events}\n\nУстановить плагин?`;
};

const PluginCatalogModal: React.FC<PluginCatalogModalProps> = ({ isOpen, onClose }) => {
  const [catalog, setCatalog] = useState<PluginManifest[]>([]);
  const [installed, setInstalled] = useState<Record<string, InstalledPluginState>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [registry, installedPlugins] = await Promise.all([
        getPluginRegistry(),
        getInstalledPlugins(),
      ]);
      setCatalog(registry);
      setInstalled(installedPlugins.reduce<Record<string, InstalledPluginState>>((acc, item) => {
        acc[item.id] = item;
        return acc;
      }, {}));
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      void refresh();
    }
  }, [isOpen, refresh]);

  const handleInstall = useCallback(async (manifest: PluginManifest) => {
    if (typeof window !== 'undefined') {
      const warning = buildWarningMessage(manifest);
      if (!window.confirm(warning)) {
        return;
      }
    }
    setBusyId(manifest.id);
    try {
      await installPluginFromManifest(manifest);
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusyId(null);
    }
  }, [refresh]);

  const handleEnable = useCallback(async (pluginId: string) => {
    setBusyId(pluginId);
    try {
      await enableStoredPlugin(pluginId);
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusyId(null);
    }
  }, [refresh]);

  const handleDisable = useCallback(async (pluginId: string) => {
    setBusyId(pluginId);
    try {
      await disablePlugin(pluginId);
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusyId(null);
    }
  }, [refresh]);

  const installedIds = useMemo(() => new Set(Object.keys(installed)), [installed]);

  if (!isOpen) {
    return null;
  }

  return (
    <div className="fixed inset-0 bg-bg-secondary/60 flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="bg-bg-primary rounded-lg shadow-xl w-full max-w-3xl max-h-[80vh] overflow-hidden"
        onClick={event => event.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-border-primary flex items-center justify-between">
          <div>
            <h3 className="text-xl font-semibold text-text-primary">Каталог плагинов</h3>
            <p className="text-sm text-text-secondary">Устанавливайте интеграции из зарегистрированного каталога.</p>
          </div>
          <button onClick={onClose} className="p-2 rounded-md hover:bg-bg-tertiary" aria-label="Закрыть каталог">
            ✕
          </button>
        </div>
        <div className="px-6 py-4 space-y-4 overflow-y-auto max-h-[calc(80vh-120px)]">
          {loading && <div className="text-sm text-text-secondary">Загрузка каталога…</div>}
          {error && !loading && <div className="text-sm text-red-400">{error}</div>}

          {!loading && catalog.length === 0 && (
            <div className="text-sm text-text-secondary">Каталог пуст.</div>
          )}

          {catalog.map(manifest => {
            const state = installed[manifest.id];
            const isInstalled = installedIds.has(manifest.id);
            const isEnabled = Boolean(state?.enabled);
            const permissions = manifest.permissions ?? [];
            const events = manifest.requiredEvents ?? [];
            const surfaces = manifest.surfaces ?? [];
            const capabilities = manifest.capabilities ?? [];

            return (
              <div key={manifest.id} className="border border-border-primary rounded-lg p-4 space-y-3">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h4 className="text-base font-semibold text-text-primary">{manifest.name}</h4>
                    <div className="text-xs text-text-secondary space-x-2">
                      {manifest.version && <span>v{manifest.version}</span>}
                      <span className="text-text-tertiary">{manifest.id}</span>
                    </div>
                  </div>
                  {isInstalled && (
                    <span className="text-xs px-2 py-1 rounded-full bg-bg-tertiary text-text-secondary">
                      {isEnabled ? 'Установлен' : 'Отключён'}
                    </span>
                  )}
                </div>
                {manifest.description && (
                  <p className="text-sm text-text-secondary">{manifest.description}</p>
                )}
                <div className="grid gap-3 text-xs text-text-secondary sm:grid-cols-2">
                  <div className="space-y-1">
                    <div className="text-sm font-semibold text-text-primary">Разрешения</div>
                    {permissions.length > 0 ? (
                      <ul className="space-y-1">
                        {permissions.map(permission => (
                          <li key={permission} className="flex items-start gap-2">
                            <span className="mt-1 h-1.5 w-1.5 rounded-full bg-accent" aria-hidden="true" />
                            <span>{describePluginPermission(permission)}</span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <div className="text-text-secondary/80">Нет специальных разрешений</div>
                    )}
                  </div>
                  <div className="space-y-1">
                    <div className="text-sm font-semibold text-text-primary">Поверхности UI</div>
                    {surfaces.length > 0 ? (
                      <ul className="space-y-1">
                        {surfaces.map(surface => (
                          <li key={surface.id} className="rounded border border-border-secondary/60 bg-bg-secondary/40 p-2">
                            <div className="font-medium text-text-secondary">{surface.label ?? surface.id}</div>
                            <div className="text-text-secondary/70">Расположение: {surface.location}</div>
                            {surface.description && (
                              <div className="text-text-secondary/60">{surface.description}</div>
                            )}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <div className="text-text-secondary/80">Нет встроенных поверхностей.</div>
                    )}
                  </div>
                </div>
                <div className="text-xs text-text-secondary space-y-1">
                  <div>
                    <span className="font-semibold text-text-primary">События:</span>{' '}
                    {events.length > 0 ? events.join(', ') : 'Не подписывается автоматически'}
                  </div>
                  {capabilities.length > 0 && (
                    <div>
                      <span className="font-semibold text-text-primary">Возможности:</span>{' '}
                      {capabilities.join(', ')}
                    </div>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2 pt-2">
                  {!isInstalled && (
                    <button
                      type="button"
                      className="px-3 py-1 rounded-md bg-accent text-text-inverted text-sm disabled:opacity-60"
                      onClick={() => handleInstall(manifest)}
                      disabled={busyId === manifest.id}
                    >
                      Установить
                    </button>
                  )}
                  {isInstalled && !isEnabled && (
                    <button
                      type="button"
                      className="px-3 py-1 rounded-md border border-border-primary text-sm text-text-secondary hover:text-text-primary"
                      onClick={() => handleEnable(manifest.id)}
                      disabled={busyId === manifest.id}
                    >
                      Включить
                    </button>
                  )}
                  {isInstalled && isEnabled && (
                    <button
                      type="button"
                      className="px-3 py-1 rounded-md border border-border-primary text-sm text-text-secondary hover:text-text-primary"
                      onClick={() => handleDisable(manifest.id)}
                      disabled={busyId === manifest.id}
                    >
                      Отключить
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default PluginCatalogModal;
