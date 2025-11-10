import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAccountStore } from '../services/accountManager';

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
    const containerRef = useRef<HTMLDivElement>(null);
    const [hasLoaded, setHasLoaded] = useState(false);
    const [isMiniAppReady, setIsMiniAppReady] = useState(false);
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

    const activeUserId = useAccountStore(
        useCallback(state => {
            const key = state.activeKey;
            return key ? state.accounts[key]?.creds.user_id ?? null : null;
        }, []),
    );

    const language = useMemo(() => {
        if (typeof navigator === 'undefined') {
            return 'en';
        }
        return navigator.language || navigator.languages?.[0] || 'en';
    }, []);

    const resolveTheme = useCallback(() => {
        if (typeof document === 'undefined') {
            return '';
        }
        return document.documentElement.className || '';
    }, []);

    const [currentTheme, setCurrentTheme] = useState(resolveTheme);

    useEffect(() => {
        if (typeof MutationObserver === 'undefined' || typeof document === 'undefined') {
            return undefined;
        }
        const observer = new MutationObserver(() => {
            setCurrentTheme(resolveTheme());
        });
        observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
        return () => observer.disconnect();
    }, [resolveTheme]);

    const [viewport, setViewport] = useState<{ width: number; height: number }>({ width: 0, height: 0 });

    const allowedOrigins = useMemo(() => {
        if (typeof window === 'undefined') {
            return [] as string[];
        }
        try {
            const parsed = new URL(url, window.location.href);
            if (parsed.protocol === 'data:' || parsed.protocol === 'about:' || parsed.protocol === 'blob:') {
                return ['null'];
            }
            return [parsed.origin];
        } catch (error) {
            console.warn('Unable to resolve mini-app origin', error);
            return [] as string[];
        }
    }, [url]);

    const targetOrigin = useMemo(() => (allowedOrigins[0] ? allowedOrigins[0] : '*'), [allowedOrigins]);

    const postMiniAppMessage = useCallback(
        (type: string, payload?: unknown) => {
            const frame = iframeRef.current;
            if (!frame?.contentWindow) {
                return;
            }
            frame.contentWindow.postMessage(
                {
                    appId,
                    type,
                    payload,
                },
                targetOrigin,
            );
        },
        [appId, targetOrigin],
    );

    const readViewport = useCallback(() => {
        const element = containerRef.current;
        if (!element) {
            return { width: 0, height: 0 };
        }
        const rect = element.getBoundingClientRect();
        return {
            width: Math.round(rect.width),
            height: Math.round(rect.height),
        };
    }, []);

    const sendInitialContext = useCallback(() => {
        const currentViewport = readViewport();
        postMiniAppMessage('web_app_init', {
            theme: currentTheme,
            language,
            viewport: currentViewport,
            userId: activeUserId,
        });
    }, [activeUserId, currentTheme, language, postMiniAppMessage, readViewport]);

    const sendThemeUpdate = useCallback(() => {
        postMiniAppMessage('web_app_theme_changed', {
            theme: currentTheme,
        });
    }, [currentTheme, postMiniAppMessage]);

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
        const element = containerRef.current;
        if (!element) {
            return undefined;
        }

        const updateViewport = () => {
            const rect = element.getBoundingClientRect();
            setViewport({ width: Math.round(rect.width), height: Math.round(rect.height) });
        };

        if (typeof ResizeObserver === 'undefined') {
            updateViewport();
            if (typeof window !== 'undefined') {
                window.addEventListener('resize', updateViewport);
                return () => window.removeEventListener('resize', updateViewport);
            }
            return undefined;
        }

        const observer = new ResizeObserver(entries => {
            const entry = entries[0];
            if (!entry) {
                return;
            }
            const { width, height: entryHeight } = entry.contentRect;
            setViewport(previous => {
                const height = entryHeight;
                if (Math.round(previous.width) === Math.round(width) && Math.round(previous.height) === Math.round(height)) {
                    return previous;
                }
                return {
                    width: Math.round(width),
                    height: Math.round(height),
                };
            });
        });

        observer.observe(element);
        updateViewport();
        return () => observer.disconnect();
    }, [height]);

    useEffect(() => {
        if (!hasLoaded) {
            return;
        }
        sendInitialContext();
    }, [hasLoaded, sendInitialContext]);

    useEffect(() => {
        if (!hasLoaded) {
            return;
        }
        sendThemeUpdate();
    }, [currentTheme, hasLoaded, sendThemeUpdate]);

    useEffect(() => {
        if (!hasLoaded || viewport.width === 0 || viewport.height === 0) {
            return;
        }
        postMiniAppMessage('viewport_changed', viewport);
    }, [hasLoaded, postMiniAppMessage, viewport]);

    useEffect(() => {
        const handleMessage = (event: MessageEvent) => {
            const frame = iframeRef.current;
            if (!frame?.contentWindow || event.source !== frame.contentWindow) {
                return;
            }
            if (allowedOrigins.length > 0 && !allowedOrigins.includes(event.origin)) {
                return;
            }

            const rawData = event.data;
            let type: string | undefined;
            let payload: any;

            if (typeof rawData === 'string') {
                try {
                    const parsed = JSON.parse(rawData);
                    type = parsed?.type ?? parsed?.eventType;
                    payload = parsed?.payload ?? parsed?.data;
                } catch (error) {
                    console.warn('Failed to parse message from mini-app', error);
                    return;
                }
            } else if (typeof rawData === 'object' && rawData !== null) {
                type = (rawData as any).type ?? (rawData as any).eventType;
                payload = (rawData as any).payload ?? (rawData as any).data;
            }

            switch (type) {
                case 'web_app_ready':
                    setIsMiniAppReady(true);
                    onReady?.();
                    postMiniAppMessage('viewport_changed', readViewport());
                    break;
                case 'web_app_request_theme':
                    sendThemeUpdate();
                    break;
                case 'web_app_expand':
                    postMiniAppMessage('web_app_expanded', readViewport());
                    break;
                case 'web_app_close':
                    onClose?.();
                    break;
                case 'web_app_open_link': {
                    const targetUrl: string | undefined = payload?.url;
                    if (!targetUrl) {
                        break;
                    }
                    const promptMessage: string = payload?.confirmText
                        ?? 'Открыть внешнюю ссылку в новом окне?';
                    const shouldOpen = window.confirm(promptMessage);
                    if (shouldOpen) {
                        window.open(targetUrl, '_blank', 'noopener');
                    }
                    break;
                }
                case 'web_app_open_popup': {
                    const title: string | undefined = payload?.title;
                    const message: string = payload?.message ?? '';
                    const buttons: Array<{ id?: string; text?: string }> = Array.isArray(payload?.buttons)
                        ? payload.buttons
                        : [];

                    let selectedButtonId: string | null = null;
                    if (buttons.length <= 1) {
                        const button = buttons[0];
                        const displayText = title ? `${title}\n\n${message}` : message;
                        window.alert(displayText);
                        selectedButtonId = button?.id ?? null;
                    } else {
                        const primary = buttons[0];
                        const secondary = buttons[1];
                        const displayText = title ? `${title}\n\n${message}` : message;
                        const confirmed = window.confirm(displayText);
                        const chosen = confirmed ? primary : secondary;
                        selectedButtonId = chosen?.id ?? null;
                    }

                    postMiniAppMessage('web_app_popup_closed', {
                        buttonId: selectedButtonId,
                    });
                    break;
                }
                default:
                    break;
            }

            onMessage?.(event);
        };

        window.addEventListener('message', handleMessage);
        return () => window.removeEventListener('message', handleMessage);
    }, [allowedOrigins, onClose, onMessage, onReady, postMiniAppMessage, readViewport, sendThemeUpdate]);

    useEffect(() => {
        setIsMiniAppReady(false);
        setHasLoaded(false);
    }, [url]);

    const handleLoad = useCallback(() => {
        setHasLoaded(true);
        setIsMiniAppReady(false);
        setPopoutError(null);
    }, []);

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

            <div
                ref={containerRef}
                className={`relative flex-1 ${height === undefined ? 'min-h-[320px]' : ''}`.trim()}
                style={containerStyle}
            >
                {!isMiniAppReady && (
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
                        isMiniAppReady ? 'opacity-100' : 'opacity-0'
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
