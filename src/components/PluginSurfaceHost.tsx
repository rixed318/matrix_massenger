import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { pluginHost } from '../services/pluginHost';
import {
  registerSurfaceInstance,
  subscribeSurfaces,
  type PluginSurfaceDescriptor,
  type PluginSurfaceLocation,
  type PluginSurfaceRenderMessage,
} from '../services/pluginUiRegistry';

interface PluginSurfaceHostProps {
  location: PluginSurfaceLocation;
  roomId?: string | null;
  context?: Record<string, unknown>;
  className?: string;
}

interface FrameMessage {
  type: string;
  surfaceId?: string;
  action?: string;
  payload?: unknown;
}

const IFRAME_SANDBOX = 'allow-scripts allow-same-origin allow-forms allow-popups';

const extractFrameAncestors = (csp: string): string[] | null => {
  const directives = csp
    .split(';')
    .map(part => part.trim())
    .filter(Boolean);
  const entry = directives.find(part => part.toLowerCase().startsWith('frame-ancestors'));
  if (!entry) {
    return null;
  }
  const tokens = entry.slice('frame-ancestors'.length).trim().split(/\s+/).filter(Boolean);
  return tokens.length > 0 ? tokens : null;
};

const isFrameAllowedByCsp = (csp: string, url: string): boolean => {
  const tokens = extractFrameAncestors(csp);
  if (!tokens) {
    return true;
  }
  if (tokens.includes("'none'")) {
    return false;
  }
  if (tokens.includes('*')) {
    return true;
  }
  const hostOrigin = typeof window !== 'undefined' ? window.location.origin : '';
  let surfaceOrigin = '';
  try {
    surfaceOrigin = new URL(url, hostOrigin || undefined).origin;
  } catch (error) {
    console.warn('[plugin-ui] Failed to resolve surface origin for CSP validation', error);
  }
  if (hostOrigin && tokens.includes(hostOrigin)) {
    return true;
  }
  if (tokens.includes("'self'")) {
    return Boolean(hostOrigin && surfaceOrigin && hostOrigin === surfaceOrigin);
  }
  return false;
};

const normaliseOrigin = (url: string): string => {
  try {
    const parsed = new URL(url, typeof window !== 'undefined' ? window.location.href : undefined);
    if (parsed.protocol === 'data:' || parsed.protocol === 'about:' || parsed.protocol === 'blob:') {
      return '*';
    }
    return parsed.origin;
  } catch (error) {
    console.warn('[plugin-ui] Failed to parse surface URL', error);
    return '*';
  }
};

const PluginSurfaceFrame: React.FC<{
  descriptor: PluginSurfaceDescriptor;
  location: PluginSurfaceLocation;
  context: Record<string, unknown>;
}> = ({ descriptor, location, context }) => {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [cspStatus, setCspStatus] = useState<'pending' | 'allowed' | 'blocked'>('pending');
  const [error, setError] = useState<string | null>(null);
  const [src, setSrc] = useState<string>('about:blank');
  const [frameLoaded, setFrameLoaded] = useState(false);
  const [handshakeComplete, setHandshakeComplete] = useState(false);
  const targetOrigin = useMemo(() => normaliseOrigin(descriptor.entry), [descriptor.entry]);

  useEffect(() => {
    let cancelled = false;
    setFrameLoaded(false);
    setHandshakeComplete(false);
    setError(null);
    setSrc('about:blank');
    setCspStatus('pending');
    const verify = async () => {
      if (typeof fetch === 'undefined') {
        const allowed = descriptor.csp ? isFrameAllowedByCsp(descriptor.csp, descriptor.entry) : true;
        setCspStatus(allowed ? 'allowed' : 'blocked');
        setSrc(allowed ? descriptor.entry : 'about:blank');
        if (!allowed) {
          setError('Поверхность заблокирована политикой безопасности плагина');
        }
        return;
      }
      try {
        const response = await fetch(descriptor.entry, { method: 'HEAD', mode: 'cors' });
        const headerPolicy = response.headers.get('content-security-policy');
        const policy = headerPolicy ?? descriptor.csp ?? null;
        if (policy && !isFrameAllowedByCsp(policy, descriptor.entry)) {
          if (!cancelled) {
            setCspStatus('blocked');
            setError('Поверхность заблокирована политикой Content-Security-Policy (frame-ancestors)');
          }
          return;
        }
        if (!cancelled) {
          setCspStatus('allowed');
          setSrc(descriptor.entry);
        }
      } catch (err) {
        console.warn('[plugin-ui] Failed to verify CSP for surface', descriptor.id, err);
        if (cancelled) {
          return;
        }
        if (descriptor.csp && isFrameAllowedByCsp(descriptor.csp, descriptor.entry)) {
          setCspStatus('allowed');
          setSrc(descriptor.entry);
          return;
        }
        setCspStatus('blocked');
        setError('Не удалось проверить Content-Security-Policy поверхности плагина');
      }
    };
    void verify();
    return () => {
      cancelled = true;
    };
  }, [descriptor.entry, descriptor.id]);

  useEffect(() => {
    if (cspStatus !== 'allowed') {
      return undefined;
    }
    return registerSurfaceInstance(descriptor.pluginId, descriptor.id, (message: PluginSurfaceRenderMessage) => {
      const frame = iframeRef.current;
      if (!frame?.contentWindow) {
        return;
      }
      try {
        frame.contentWindow.postMessage(
          {
            type: 'ui.render',
            pluginId: descriptor.pluginId,
            surfaceId: descriptor.id,
            payload: message.payload,
            context,
            timestamp: message.timestamp,
          },
          targetOrigin,
        );
      } catch (err) {
        console.warn('[plugin-ui] Failed to forward render payload to surface', descriptor.id, err);
      }
    });
  }, [cspStatus, context, descriptor.id, descriptor.pluginId, targetOrigin]);

  const emitRenderRequest = useCallback(() => {
    if (cspStatus !== 'allowed') {
      return;
    }
    void pluginHost.emit('ui.render', {
      pluginId: descriptor.pluginId,
      surfaceId: descriptor.id,
      location,
      context,
    });
  }, [cspStatus, context, descriptor.id, descriptor.pluginId, location]);

  useEffect(() => {
    if (!frameLoaded && !handshakeComplete) {
      return;
    }
    emitRenderRequest();
  }, [emitRenderRequest, frameLoaded, handshakeComplete]);

  useEffect(() => {
    const listener = (event: MessageEvent<FrameMessage>) => {
      const frame = iframeRef.current;
      if (!frame || event.source !== frame.contentWindow) {
        return;
      }
      if (targetOrigin !== '*' && event.origin !== targetOrigin && event.origin !== 'null') {
        return;
      }
      const data = event.data;
      if (!data || typeof data !== 'object' || data.surfaceId !== descriptor.id) {
        return;
      }
      if (data.type === 'ui.ready') {
        setHandshakeComplete(true);
        emitRenderRequest();
        return;
      }
      if (data.type === 'ui.action' && typeof data.action === 'string') {
        void pluginHost.emit('ui.action', {
          pluginId: descriptor.pluginId,
          surfaceId: descriptor.id,
          action: data.action,
          payload: data.payload,
          location,
          context,
        });
      }
    };
    window.addEventListener('message', listener);
    return () => window.removeEventListener('message', listener);
  }, [context, descriptor.id, descriptor.pluginId, emitRenderRequest, location, targetOrigin]);

  if (cspStatus === 'blocked') {
    return (
      <div className="rounded-md border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-200">
        <div className="font-semibold">{descriptor.label ?? descriptor.pluginName}</div>
        <div className="mt-1 text-xs text-red-100/80">{error ?? 'Эта поверхность плагина заблокирована настройками CSP.'}</div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-neutral-700/60 bg-neutral-900/60 shadow-sm overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-neutral-700/60 bg-neutral-900/80 px-3 py-2">
        <div>
          <div className="text-sm font-semibold text-neutral-100">{descriptor.label ?? descriptor.pluginName}</div>
          {descriptor.description && (
            <div className="text-xs text-neutral-400">{descriptor.description}</div>
          )}
        </div>
        <span className="text-[11px] uppercase tracking-wide text-neutral-500">{descriptor.pluginName}</span>
      </div>
      <div className="relative">
        {cspStatus === 'pending' && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-neutral-900/80 text-xs text-neutral-400">
            Проверка политики безопасности…
          </div>
        )}
        <iframe
          ref={iframeRef}
          title={descriptor.label ?? descriptor.id}
          src={cspStatus === 'allowed' ? src : 'about:blank'}
          sandbox={IFRAME_SANDBOX}
          allow="accelerometer; clipboard-read; clipboard-write;"
          className="h-64 w-full border-0"
          onLoad={() => setFrameLoaded(true)}
        />
      </div>
    </div>
  );
};

const PluginSurfaceHost: React.FC<PluginSurfaceHostProps> = ({ location, roomId, context, className = '' }) => {
  const [surfaces, setSurfaces] = useState<PluginSurfaceDescriptor[]>([]);

  const handleUpdate = useCallback((next: PluginSurfaceDescriptor[]) => {
    const sorted = [...next].sort((a, b) => {
      const byName = a.pluginName.localeCompare(b.pluginName);
      if (byName !== 0) {
        return byName;
      }
      return a.id.localeCompare(b.id);
    });
    setSurfaces(sorted);
  }, []);

  useEffect(() => subscribeSurfaces(location, handleUpdate), [location, handleUpdate]);

  const contextValue = useMemo(() => {
    const value: Record<string, unknown> = { location };
    if (roomId) {
      value.roomId = roomId;
    }
    if (context) {
      Object.assign(value, context);
    }
    return value;
  }, [context, location, roomId]);

  if (surfaces.length === 0) {
    return null;
  }

  return (
    <div className={`flex flex-col gap-4 ${className}`.trim()}>
      {surfaces.map(surface => (
        <PluginSurfaceFrame
          key={`${surface.pluginId}:${surface.id}`}
          descriptor={surface}
          location={location}
          context={contextValue}
        />
      ))}
    </div>
  );
};

export default PluginSurfaceHost;
