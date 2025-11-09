import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

interface MiniAppHostProps {
    appId: string;
    url: string;
    title?: string;
    description?: string;
    sandbox?: string[] | string | false;
    allow?: string;
    height?: number | string;
    className?: string;
    frameClassName?: string;
    allowPopout?: boolean;
    onReady?: () => void;
    onMessage?: (event: MessageEvent) => void;
    onClose?: () => void;
}

const DEFAULT_SANDBOX = 'allow-same-origin allow-scripts allow-forms allow-popups';

const isTauriRuntime = (): boolean => typeof window !== 'undefined' && Boolean((window as any).__TAURI__);

const MiniAppHost: React.FC<MiniAppHostProps> = ({
    appId,
    url,
    title,
    description,
    sandbox,
    allow,
    height,
    className = '',
    frameClassName = '',
    allowPopout = true,
    onReady,
    onMessage,
    onClose,
}) => {
    const iframeRef = useRef<HTMLIFrameElement>(null);
    const [isReady, setIsReady] = useState(false);
    const [tauriSupported, setTauriSupported] = useState(false);
    const [popoutError, setPopoutError] = useState<string | null>(null);

    const containerStyle = useMemo<React.CSSProperties>(() => {
        if (height === undefined) {
            return {};
        }
        if (typeof height === 'number') {
            return { height: `${height}px` };
        }
        return { height };
    }, [height]);

    const sandboxAttribute = useMemo(() => {
        if (sandbox === false) {
            return undefined;
        }
        if (Array.isArray(sandbox)) {
            return sandbox.join(' ');
        }
        if (typeof sandbox === 'string') {
            return sandbox;
        }
        return DEFAULT_SANDBOX;
    }, [sandbox]);

    useEffect(() => {
        let mounted = true;
        if (!isTauriRuntime()) {
            setTauriSupported(false);
            return () => {
                mounted = false;
            };
        }

        import('@tauri-apps/api/webviewWindow')
            .then(() => {
                if (mounted) {
                    setTauriSupported(true);
                }
            })
            .catch(() => {
                if (mounted) {
                    setTauriSupported(false);
                }
            });

        return () => {
            mounted = false;
        };
    }, []);

    useEffect(() => {
        if (!onMessage) {
            return undefined;
        }
        const handler = (event: MessageEvent) => {
            if (!iframeRef.current) {
                return;
            }
            if (event.source !== iframeRef.current.contentWindow) {
                return;
            }
            onMessage(event);
        };
        window.addEventListener('message', handler);
        return () => window.removeEventListener('message', handler);
    }, [onMessage]);

    const handleLoad = useCallback(() => {
        setIsReady(true);
        setPopoutError(null);
        onReady?.();
    }, [onReady]);

    const openInDesktopWindow = useCallback(async () => {
        if (!tauriSupported || !allowPopout) {
            return;
        }
        setPopoutError(null);
        try {
            const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow');
            const label = `miniapp-${appId}-${Date.now()}`;
            const view = new WebviewWindow(label, {
                url,
                title: title ?? appId,
                width: 420,
                height: 720,
                resizable: true,
            });
            view.once('tauri://error', event => {
                const errorMessage = typeof event === 'string'
                    ? event
                    : (event as { payload?: string })?.payload ?? 'Unknown window error';
                setPopoutError(errorMessage);
            });
        } catch (error) {
            setPopoutError(error instanceof Error ? error.message : String(error));
        }
    }, [allowPopout, appId, tauriSupported, title, url]);

    return (
        <section className={`border border-border-primary rounded-lg bg-bg-primary shadow-sm flex flex-col ${className}`}>
            <header className="px-4 py-3 border-b border-border-primary flex items-center justify-between gap-3">
                <div className="min-w-0">
                    <h2 className="text-base font-semibold text-text-primary truncate">{title ?? 'Mini app'}</h2>
                    {description && (
                        <p className="text-xs text-text-secondary truncate" title={description}>
                            {description}
                        </p>
                    )}
                </div>
                <div className="flex items-center gap-2">
                    {tauriSupported && allowPopout && (
                        <button
                            type="button"
                            onClick={openInDesktopWindow}
                            className="text-xs px-3 py-1.5 rounded-md bg-bg-secondary hover:bg-bg-tertiary text-text-primary"
                        >
                            Open window
                        </button>
                    )}
                    {onClose && (
                        <button
                            type="button"
                            onClick={onClose}
                            className="h-8 w-8 flex items-center justify-center rounded-md bg-bg-secondary hover:bg-bg-tertiary text-text-secondary"
                            aria-label="Close mini-app"
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                                <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                            </svg>
                        </button>
                    )}
                </div>
            </header>

            <div className="relative flex-1 min-h-[320px]" style={containerStyle}>
                {!isReady && (
                    <div className="absolute inset-0 flex items-center justify-center text-sm text-text-secondary bg-bg-primary/60 z-10">
                        Loading mini-app…
                    </div>
                )}
                <iframe
                    ref={iframeRef}
                    src={url}
                    title={title ?? appId}
                    sandbox={sandboxAttribute}
                    allow={allow}
                    onLoad={handleLoad}
                    className={`w-full h-full border-none rounded-b-lg bg-white transition-opacity duration-200 ${
                        isReady ? 'opacity-100' : 'opacity-0'
                    } ${frameClassName}`}
                />
            </div>

            {popoutError && (
                <div className="px-4 py-2 text-xs text-error bg-error/10 border-t border-border-primary">
                    Unable to open a dedicated window: {popoutError}
                </div>
            )}
        </section>
    );
};

export default MiniAppHost;
