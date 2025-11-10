const getDateTimeFormat = (timeZone: string): Intl.DateTimeFormat => {
    return new Intl.DateTimeFormat('en-US', {
        timeZone,
        hour12: false,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
    });
};

export const parseDateTimeInput = (value: string) => {
    if (!value) return null;
    const [datePart, timePart] = value.split('T');
    if (!datePart || !timePart) return null;
    const [yearStr, monthStr, dayStr] = datePart.split('-');
    const [hourStr, minuteStr] = timePart.split(':');
    if (!yearStr || !monthStr || !dayStr || !hourStr || !minuteStr) {
        return null;
    }
    const year = Number(yearStr);
    const month = Number(monthStr);
    const day = Number(dayStr);
    const hour = Number(hourStr);
    const minute = Number(minuteStr);
    if (
        !Number.isFinite(year)
        || !Number.isFinite(month)
        || !Number.isFinite(day)
        || !Number.isFinite(hour)
        || !Number.isFinite(minute)
    ) {
        return null;
    }
    return { year, month, day, hour, minute };
};

const getTimeZoneOffsetMinutes = (timestamp: number, timeZone: string): number => {
    const formatter = getDateTimeFormat(timeZone);
    const parts = formatter.formatToParts(new Date(timestamp));
    const map = parts.reduce<Record<string, string>>((acc, part) => {
        acc[part.type] = part.value;
        return acc;
    }, {});
    const asUtc = Date.UTC(
        Number(map.year ?? '0'),
        Number(map.month ?? '1') - 1,
        Number(map.day ?? '1'),
        Number(map.hour ?? '0'),
        Number(map.minute ?? '0'),
        Number(map.second ?? '0'),
    );
    return Math.round((timestamp - asUtc) / 60000);
};

export const zonedDateTimeToUtc = (
    value: string,
    timeZone: string,
): { utc: number; offsetMinutes: number } | null => {
    const parts = parseDateTimeInput(value);
    if (!parts) return null;

    const initial = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, 0);
    let offset = getTimeZoneOffsetMinutes(initial, timeZone);
    let utc = initial + offset * 60000;
    let correctedOffset = getTimeZoneOffsetMinutes(utc, timeZone);
    if (correctedOffset !== offset) {
        offset = correctedOffset;
        utc = initial + offset * 60000;
    }
    return { utc, offsetMinutes: offset };
};

export const formatDateTimeInputValue = (timestamp: number, timeZone: string): string => {
    const formatter = getDateTimeFormat(timeZone);
    const parts = formatter.formatToParts(new Date(timestamp));
    const map = parts.reduce<Record<string, string>>((acc, part) => {
        acc[part.type] = part.value;
        return acc;
    }, {});
    const year = map.year ?? '0000';
    const month = map.month ?? '01';
    const day = map.day ?? '01';
    const hour = map.hour ?? '00';
    const minute = map.minute ?? '00';
    return `${year}-${month}-${day}T${hour}:${minute}`;
};

export const getSupportedTimezones = (): string[] => {
    if (typeof (Intl as any).supportedValuesOf === 'function') {
        try {
            return (Intl as any).supportedValuesOf('timeZone') as string[];
        } catch (_) {
            // ignore
        }
    }
    const guess = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return guess ? [guess] : ['UTC'];
};

const pad = (value: number): string => value >= 0 && value < 10 ? `0${value}` : String(value);

export const formatTimezoneLabel = (timeZone: string, referenceTs = Date.now()): string => {
    try {
        const offset = getTimeZoneOffsetMinutes(referenceTs, timeZone);
        const sign = offset <= 0 ? '+' : '-';
        const absMinutes = Math.abs(offset);
        const hours = Math.floor(absMinutes / 60);
        const minutes = absMinutes % 60;
        return `${timeZone} (UTC${sign}${pad(hours)}:${pad(minutes)})`;
    } catch (error) {
        console.warn('Failed to format timezone label for', timeZone, error);
        return timeZone;
    }
};

export const computeLocalTimestamp = (utcTimestamp: number, offsetMinutes: number): number => {
    return utcTimestamp - offsetMinutes * 60000;
};

