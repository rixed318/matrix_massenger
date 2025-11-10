export const DEFAULT_LOCATION = {
    latitude: 55.751244,
    longitude: 37.618423,
};

export const MAP_ZOOM_DEFAULT = 15;
export const MAP_ZOOM_MIN = 2;
export const MAP_ZOOM_MAX = 18;
export const STATIC_MAP_WIDTH = 640;
export const STATIC_MAP_HEIGHT = 360;

const clampZoom = (zoom: number): number => {
    if (!Number.isFinite(zoom)) {
        return MAP_ZOOM_DEFAULT;
    }
    return Math.max(MAP_ZOOM_MIN, Math.min(MAP_ZOOM_MAX, Math.round(zoom)));
};

const toFixedCoordinate = (value: number): number => {
    if (!Number.isFinite(value)) {
        return 0;
    }
    return Number(value.toFixed(6));
};

export const buildGeoUri = (latitude: number, longitude: number, accuracy?: number): string => {
    const lat = toFixedCoordinate(latitude);
    const lon = toFixedCoordinate(longitude);
    const parts = [`geo:${lat},${lon}`];
    if (typeof accuracy === 'number' && Number.isFinite(accuracy) && accuracy > 0) {
        parts.push(`;u=${Math.round(accuracy)}`);
    }
    return parts.join('');
};

export interface ParsedGeoUri {
    latitude: number;
    longitude: number;
    accuracy?: number;
}

export const parseGeoUri = (value: string | null | undefined): ParsedGeoUri | null => {
    if (!value || !value.startsWith('geo:')) {
        return null;
    }
    const withoutPrefix = value.substring(4);
    const [coordsPart, ...paramParts] = withoutPrefix.split(';');
    const [latRaw, lonRaw] = coordsPart.split(',');
    const latitude = Number(latRaw);
    const longitude = Number(lonRaw);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
        return null;
    }
    const parsed: ParsedGeoUri = {
        latitude,
        longitude,
    };
    for (const part of paramParts) {
        if (part.startsWith('u=')) {
            const accuracy = Number(part.substring(2));
            if (Number.isFinite(accuracy) && accuracy > 0) {
                parsed.accuracy = accuracy;
            }
        }
    }
    return parsed;
};

export const buildStaticMapUrl = (
    latitude: number,
    longitude: number,
    zoom: number = MAP_ZOOM_DEFAULT,
    width: number = STATIC_MAP_WIDTH,
    height: number = STATIC_MAP_HEIGHT,
): string => {
    const lat = toFixedCoordinate(latitude);
    const lon = toFixedCoordinate(longitude);
    const safeZoom = clampZoom(zoom);
    const safeWidth = Math.max(160, Math.min(2048, Math.round(width)));
    const safeHeight = Math.max(160, Math.min(2048, Math.round(height)));
    const marker = `${lat},${lon},lightblue1`;
    return `https://staticmap.openstreetmap.de/staticmap.php?center=${lat},${lon}&zoom=${safeZoom}&size=${safeWidth}x${safeHeight}&markers=${marker}`;
};

export const buildExternalNavigationUrl = (
    latitude: number,
    longitude: number,
    zoom: number = MAP_ZOOM_DEFAULT,
): string => {
    const lat = toFixedCoordinate(latitude);
    const lon = toFixedCoordinate(longitude);
    const safeZoom = clampZoom(zoom);
    return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=${safeZoom}/${lat}/${lon}`;
};

export const formatCoordinate = (value: number): string => {
    if (!Number.isFinite(value)) {
        return '0.00000';
    }
    return value.toFixed(5);
};

export const zoomToLatitudeDelta = (zoom: number): number => {
    const safeZoom = clampZoom(zoom);
    return 360 / Math.pow(2, safeZoom);
};

export const zoomToLongitudeDelta = (zoom: number, latitude: number): number => {
    const latDelta = zoomToLatitudeDelta(zoom);
    const latRad = (latitude * Math.PI) / 180;
    const cosLat = Math.cos(latRad);
    if (Math.abs(cosLat) < 1e-6) {
        return latDelta;
    }
    return latDelta / cosLat;
};

export const sanitizeZoom = (zoom: number | undefined): number => clampZoom(typeof zoom === 'number' ? zoom : MAP_ZOOM_DEFAULT);
