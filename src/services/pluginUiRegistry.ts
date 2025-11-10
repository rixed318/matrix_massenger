export const PLUGIN_SURFACE_LOCATIONS = ['chat.panel', 'chat.composer'] as const;

export type PluginSurfaceLocation = typeof PLUGIN_SURFACE_LOCATIONS[number];

export interface PluginSurfaceDefinition {
  id: string;
  entry: string;
  location: PluginSurfaceLocation;
  label?: string;
  description?: string;
  csp?: string;
}

export interface PluginSurfaceDescriptor extends PluginSurfaceDefinition {
  pluginId: string;
  pluginName: string;
  pluginDescription?: string;
}

export interface PluginSurfaceRenderMessage {
  pluginId: string;
  surfaceId: string;
  payload: unknown;
  timestamp: number;
}

export type PluginSurfaceListener = (surfaces: PluginSurfaceDescriptor[]) => void;
export type PluginSurfaceRenderListener = (message: PluginSurfaceRenderMessage) => void;

const surfacesByPlugin = new Map<string, PluginSurfaceDescriptor[]>();
const locationListeners = new Map<PluginSurfaceLocation, Set<PluginSurfaceListener>>();
const surfaceRenderListeners = new Map<string, Set<PluginSurfaceRenderListener>>();
const lastRenderPayload = new Map<string, PluginSurfaceRenderMessage>();

const surfaceKey = (pluginId: string, surfaceId: string): string => `${pluginId}::${surfaceId}`;

const notifyLocation = (location: PluginSurfaceLocation) => {
  const listeners = locationListeners.get(location);
  if (!listeners || listeners.size === 0) {
    return;
  }
  const payload = getSurfacesForLocation(location);
  listeners.forEach(listener => {
    try {
      listener(payload);
    } catch (error) {
      console.warn('[plugin-ui] Failed to deliver surface update', error);
    }
  });
};

const disposeSurfaceState = (pluginId: string, descriptors: PluginSurfaceDescriptor[]) => {
  for (const descriptor of descriptors) {
    const key = surfaceKey(pluginId, descriptor.id);
    surfaceRenderListeners.delete(key);
    lastRenderPayload.delete(key);
    notifyLocation(descriptor.location);
  }
};

export interface PluginManifestSurfaceMeta {
  id: string;
  name: string;
  description?: string;
}

export const registerPluginSurfaces = (
  manifest: PluginManifestSurfaceMeta,
  surfaces: PluginSurfaceDefinition[],
): void => {
  const existing = surfacesByPlugin.get(manifest.id);
  if (existing) {
    disposeSurfaceState(manifest.id, existing);
    surfacesByPlugin.delete(manifest.id);
  }
  if (!surfaces || surfaces.length === 0) {
    return;
  }
  const descriptors = surfaces.map<PluginSurfaceDescriptor>(surface => ({
    pluginId: manifest.id,
    pluginName: manifest.name,
    pluginDescription: manifest.description,
    ...surface,
  }));
  surfacesByPlugin.set(manifest.id, descriptors);
  const touched = new Set<PluginSurfaceLocation>(descriptors.map(item => item.location));
  touched.forEach(location => notifyLocation(location));
};

export const unregisterPluginSurfaces = (pluginId: string): void => {
  const existing = surfacesByPlugin.get(pluginId);
  if (!existing) {
    return;
  }
  surfacesByPlugin.delete(pluginId);
  disposeSurfaceState(pluginId, existing);
};

export const getSurfacesForLocation = (location: PluginSurfaceLocation): PluginSurfaceDescriptor[] => {
  const result: PluginSurfaceDescriptor[] = [];
  for (const descriptors of surfacesByPlugin.values()) {
    for (const descriptor of descriptors) {
      if (descriptor.location === location) {
        result.push(descriptor);
      }
    }
  }
  return result;
};

export const subscribeSurfaces = (
  location: PluginSurfaceLocation,
  listener: PluginSurfaceListener,
): (() => void) => {
  let listeners = locationListeners.get(location);
  if (!listeners) {
    listeners = new Set();
    locationListeners.set(location, listeners);
  }
  listeners.add(listener);
  // deliver current state immediately
  try {
    listener(getSurfacesForLocation(location));
  } catch (error) {
    console.warn('[plugin-ui] Failed to deliver initial surface state', error);
  }
  return () => {
    const bucket = locationListeners.get(location);
    bucket?.delete(listener);
    if (bucket && bucket.size === 0) {
      locationListeners.delete(location);
    }
  };
};

export const registerSurfaceInstance = (
  pluginId: string,
  surfaceId: string,
  listener: PluginSurfaceRenderListener,
  options: { replayLast?: boolean } = {},
): (() => void) => {
  const key = surfaceKey(pluginId, surfaceId);
  let listeners = surfaceRenderListeners.get(key);
  if (!listeners) {
    listeners = new Set();
    surfaceRenderListeners.set(key, listeners);
  }
  listeners.add(listener);
  if (options.replayLast !== false) {
    const last = lastRenderPayload.get(key);
    if (last) {
      try {
        listener(last);
      } catch (error) {
        console.warn('[plugin-ui] Failed to replay surface payload', error);
      }
    }
  }
  return () => {
    const bucket = surfaceRenderListeners.get(key);
    bucket?.delete(listener);
    if (bucket && bucket.size === 0) {
      surfaceRenderListeners.delete(key);
    }
  };
};

export const dispatchSurfaceRender = (message: PluginSurfaceRenderMessage): void => {
  const key = surfaceKey(message.pluginId, message.surfaceId);
  lastRenderPayload.set(key, message);
  const listeners = surfaceRenderListeners.get(key);
  if (!listeners || listeners.size === 0) {
    return;
  }
  listeners.forEach(listener => {
    try {
      listener(message);
    } catch (error) {
      console.warn('[plugin-ui] Failed to deliver render payload', error);
    }
  });
};
