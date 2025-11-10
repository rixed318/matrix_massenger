import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
    DEFAULT_LOCATION,
    MAP_ZOOM_DEFAULT,
    MAP_ZOOM_MAX,
    MAP_ZOOM_MIN,
    formatCoordinate,
    sanitizeZoom,
} from '../utils/location';

interface LocationPickerDialogProps {
    isOpen: boolean;
    initialPosition?: { latitude: number; longitude: number } | null;
    accuracy?: number | null;
    isLocating?: boolean;
    error?: string | null;
    onClose: () => void;
    onConfirm: (payload: { latitude: number; longitude: number; zoom: number; description?: string; accuracy?: number }) => void;
}

declare global {
    interface Window {
        L?: any;
    }
}

const LEAFLET_SCRIPT_URL = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
const LEAFLET_STYLESHEET_URL = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';

let leafletLoader: Promise<any> | null = null;

const ensureLeaflet = (): Promise<any> => {
    if (typeof window === 'undefined') {
        return Promise.reject(new Error('Leaflet can only be loaded in a browser environment.'));
    }

    if (window.L) {
        return Promise.resolve(window.L);
    }

    if (leafletLoader) {
        return leafletLoader;
    }

    leafletLoader = new Promise((resolve, reject) => {
        const existingScript = document.querySelector<HTMLScriptElement>(`script[src="${LEAFLET_SCRIPT_URL}"]`);
        const existingStylesheet = document.querySelector<HTMLLinkElement>(`link[href="${LEAFLET_STYLESHEET_URL}"]`);

        if (!existingStylesheet) {
            const link = document.createElement('link');
            link.rel = 'stylesheet';
            link.href = LEAFLET_STYLESHEET_URL;
            document.head.appendChild(link);
        }

        if (existingScript && window.L) {
            resolve(window.L);
            return;
        }

        const script = existingScript ?? document.createElement('script');
        script.src = LEAFLET_SCRIPT_URL;
        script.async = true;
        script.onload = () => {
            if (window.L) {
                resolve(window.L);
            } else {
                reject(new Error('Leaflet script loaded but no global L found.'));
            }
        };
        script.onerror = () => reject(new Error('Failed to load Leaflet script'));
        if (!existingScript) {
            document.body.appendChild(script);
        }
    }).catch(error => {
        leafletLoader = null;
        throw error;
    });

    return leafletLoader;
};

const LocationPickerDialog: React.FC<LocationPickerDialogProps> = ({
    isOpen,
    initialPosition,
    accuracy,
    isLocating = false,
    error,
    onClose,
    onConfirm,
}) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const mapInstanceRef = useRef<any>(null);
    const markerRef = useRef<any>(null);
    const [leafletReady, setLeafletReady] = useState(false);
    const [description, setDescription] = useState('');
    const [zoom, setZoom] = useState<number>(MAP_ZOOM_DEFAULT);
    const [shouldRecenter, setShouldRecenter] = useState(false);
    const [position, setPosition] = useState<{ latitude: number; longitude: number }>(DEFAULT_LOCATION);
    const [loadError, setLoadError] = useState<string | null>(null);

    const effectiveAccuracy = useMemo(() => {
        if (typeof accuracy === 'number' && accuracy > 0) {
            return Math.round(accuracy);
        }
        return undefined;
    }, [accuracy]);

    useEffect(() => {
        if (!isOpen) {
            return undefined;
        }

        let cancelled = false;
        setLoadError(null);
        setLeafletReady(false);

        ensureLeaflet()
            .then(L => {
                if (cancelled) {
                    return;
                }
                setLeafletReady(true);
                const container = containerRef.current;
                if (!container) {
                    return;
                }

                const currentPosition = initialPosition ?? DEFAULT_LOCATION;
                setPosition(currentPosition);
                const startZoom = sanitizeZoom(zoom);
                setZoom(startZoom);

                const map = L.map(container).setView([currentPosition.latitude, currentPosition.longitude], startZoom);
                mapInstanceRef.current = map;

                L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                    attribution: '© OpenStreetMap contributors',
                    maxZoom: MAP_ZOOM_MAX,
                    minZoom: MAP_ZOOM_MIN,
                }).addTo(map);

                const marker = L.marker([currentPosition.latitude, currentPosition.longitude], { draggable: true });
                marker.addTo(map);
                markerRef.current = marker;

                marker.on('dragend', () => {
                    const latLng = marker.getLatLng();
                    setPosition({ latitude: latLng.lat, longitude: latLng.lng });
                });

                map.on('click', (event: { latlng: { lat: number; lng: number } }) => {
                    const latLng = event.latlng;
                    setPosition({ latitude: latLng.lat, longitude: latLng.lng });
                });

                map.on('zoomend', () => {
                    const currentZoom = map.getZoom();
                    setZoom(sanitizeZoom(currentZoom));
                });

                setShouldRecenter(false);
            })
            .catch(err => {
                console.error('Failed to load Leaflet', err);
                if (!cancelled) {
                    setLoadError(err instanceof Error ? err.message : String(err));
                }
            });

        return () => {
            cancelled = true;
            markerRef.current = null;
            if (mapInstanceRef.current) {
                mapInstanceRef.current.off();
                mapInstanceRef.current.remove();
                mapInstanceRef.current = null;
            }
        };
    }, [isOpen]);

    useEffect(() => {
        if (!isOpen) {
            return;
        }
        setDescription('');
        setZoom(MAP_ZOOM_DEFAULT);
        setShouldRecenter(true);
        if (initialPosition) {
            setPosition(initialPosition);
        } else {
            setPosition(DEFAULT_LOCATION);
        }
    }, [isOpen, initialPosition]);

    useEffect(() => {
        if (!leafletReady || !mapInstanceRef.current || !markerRef.current) {
            return;
        }
        markerRef.current.setLatLng([position.latitude, position.longitude]);
        if (shouldRecenter) {
            mapInstanceRef.current.setView([position.latitude, position.longitude], sanitizeZoom(zoom));
            setShouldRecenter(false);
        }
    }, [leafletReady, position, shouldRecenter, zoom]);

    useEffect(() => {
        if (!leafletReady || !mapInstanceRef.current) {
            return;
        }
        const currentZoom = mapInstanceRef.current.getZoom();
        const nextZoom = sanitizeZoom(zoom);
        if (currentZoom !== nextZoom) {
            mapInstanceRef.current.setZoom(nextZoom);
        }
    }, [leafletReady, zoom]);

    if (!isOpen) {
        return null;
    }

    const handleConfirm = () => {
        if (!position) {
            return;
        }
        onConfirm({
            latitude: position.latitude,
            longitude: position.longitude,
            zoom: sanitizeZoom(zoom),
            description: description.trim() ? description.trim() : undefined,
            accuracy: effectiveAccuracy,
        });
    };

    const disableConfirm = !position || Number.isNaN(position.latitude) || Number.isNaN(position.longitude);

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" role="dialog" aria-modal="true" onClick={onClose}>
            <div className="bg-bg-primary rounded-xl shadow-2xl w-full max-w-2xl overflow-hidden border border-border-secondary" onClick={event => event.stopPropagation()}>
                <header className="px-6 py-4 border-b border-border-secondary flex items-center justify-between">
                    <div>
                        <h2 className="text-lg font-semibold text-text-primary">Поделиться локацией</h2>
                        <p className="text-xs text-text-secondary">Переместите маркер или нажмите на карту, чтобы выбрать место.</p>
                    </div>
                    <button
                        type="button"
                        className="text-text-secondary hover:text-text-primary"
                        onClick={onClose}
                        aria-label="Закрыть диалог"
                    >
                        ✕
                    </button>
                </header>
                <div className="px-6 pt-4 space-y-3">
                    {(isLocating || leafletReady === false) && !loadError && (
                        <div className="text-sm text-text-secondary">
                            {isLocating ? 'Определяем вашу текущую позицию…' : 'Загружаем карту…'}
                        </div>
                    )}
                    {(error || loadError) && (
                        <div className="text-sm text-status-error bg-status-error/10 border border-status-error/30 px-3 py-2 rounded-md">
                            {error || loadError}
                        </div>
                    )}
                    <div className="rounded-xl overflow-hidden border border-border-secondary">
                        <div ref={containerRef} className="w-full h-80 bg-bg-secondary" />
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <label className="flex flex-col text-xs text-text-secondary gap-1">
                            Описание (опционально)
                            <input
                                type="text"
                                value={description}
                                onChange={event => setDescription(event.target.value)}
                                placeholder="Например, офис или точка встречи"
                                className="px-3 py-2 rounded-md bg-bg-secondary border border-border-secondary text-text-primary focus:outline-none focus:ring-1 focus:ring-text-accent"
                            />
                        </label>
                        <div className="flex flex-col gap-1 text-xs text-text-secondary">
                            Точность и координаты
                            <div className="rounded-md border border-border-secondary bg-bg-secondary px-3 py-2 text-sm text-text-primary space-y-1">
                                <div>Широта: {formatCoordinate(position.latitude)}</div>
                                <div>Долгота: {formatCoordinate(position.longitude)}</div>
                                {typeof effectiveAccuracy === 'number' && (
                                    <div>Точность: ±{effectiveAccuracy} м</div>
                                )}
                            </div>
                        </div>
                    </div>
                    <div className="space-y-1">
                        <label className="flex items-center justify-between text-xs text-text-secondary">
                            Масштаб карты
                            <span className="text-text-primary text-sm">{sanitizeZoom(zoom)}</span>
                        </label>
                        <input
                            type="range"
                            min={MAP_ZOOM_MIN}
                            max={MAP_ZOOM_MAX}
                            value={sanitizeZoom(zoom)}
                            onChange={event => {
                                const next = Number(event.target.value);
                                setZoom(sanitizeZoom(next));
                                setShouldRecenter(true);
                            }}
                            className="w-full"
                        />
                    </div>
                </div>
                <footer className="px-6 py-4 border-t border-border-secondary flex justify-end gap-3 bg-bg-secondary/50">
                    <button
                        type="button"
                        className="px-4 py-2 rounded-md text-sm text-text-secondary hover:text-text-primary"
                        onClick={onClose}
                    >
                        Отмена
                    </button>
                    <button
                        type="button"
                        className="px-4 py-2 rounded-md text-sm bg-accent text-text-inverted disabled:bg-accent/40 disabled:text-text-inverted/70"
                        onClick={handleConfirm}
                        disabled={disableConfirm}
                    >
                        Отправить локацию
                    </button>
                </footer>
            </div>
        </div>
    );
};

export default LocationPickerDialog;
