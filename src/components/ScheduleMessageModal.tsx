import React, { useEffect, useMemo, useState } from 'react';
import type { DraftAttachment, DraftContent } from '../types';
import {
    computeLocalTimestamp,
    formatDateTimeInputValue,
    formatTimezoneLabel,
    getSupportedTimezones,
    parseDateTimeInput,
    zonedDateTimeToUtc,
} from '../utils/timezone';

const DEFAULT_LEAD_MINUTES = 5;
const MIN_LEAD_MS = 60_000;
const EVENING_HOUR = 19;

interface ScheduleSelection {
    sendAtUtc: number;
    timezoneOffset: number;
    timezoneId: string;
    localTimestamp: number;
}

interface ScheduleMessageModalProps {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: (selection: ScheduleSelection) => void;
    messageContent: DraftContent | null;
    title?: string;
    initialSchedule?: {
        sendAtUtc?: number;
        sendAt?: number;
        timezoneOffset?: number;
        timezoneId?: string;
    };
}

const formatFileSize = (size: number): string => {
    if (!Number.isFinite(size) || size <= 0) {
        return '—';
    }
    if (size >= 1024 * 1024) {
        return `${(size / (1024 * 1024)).toFixed(1)} MB`;
    }
    if (size >= 1024) {
        return `${(size / 1024).toFixed(1)} KB`;
    }
    return `${size} B`;
};

const formatDuration = (duration?: number): string | null => {
    if (typeof duration !== 'number' || Number.isNaN(duration) || duration <= 0) {
        return null;
    }
    const seconds = duration > 1000 ? Math.round(duration / 1000) : Math.round(duration);
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
};

const resolveAttachmentPreview = (attachment: DraftAttachment): string | null => {
    return attachment.thumbnailUrl
        ?? attachment.dataUrl
        ?? attachment.tempUrl
        ?? attachment.url
        ?? null;
};

const ScheduleMessageModal: React.FC<ScheduleMessageModalProps> = ({
    isOpen,
    onClose,
    onConfirm,
    messageContent,
    title,
    initialSchedule,
}) => {
    const timezoneGuess = useMemo(() => {
        return initialSchedule?.timezoneId
            ?? Intl.DateTimeFormat().resolvedOptions().timeZone
            ?? 'UTC';
    }, [initialSchedule?.timezoneId]);

    const [selectedTimezone, setSelectedTimezone] = useState<string>(timezoneGuess);
    const timezoneOptions = useMemo(() => getSupportedTimezones(), []);
    const [dateTimeInput, setDateTimeInput] = useState<string>('');
    const [targetUtc, setTargetUtc] = useState<number>(() => Date.now() + DEFAULT_LEAD_MINUTES * 60_000);
    const [timezoneOffset, setTimezoneOffset] = useState<number>(() => new Date().getTimezoneOffset());
    const [error, setError] = useState<string | null>(null);
    const [info, setInfo] = useState<string | null>(null);

    useEffect(() => {
        if (!isOpen) {
            return;
        }

        const baseUtc = (() => {
            if (typeof initialSchedule?.sendAtUtc === 'number') {
                return initialSchedule.sendAtUtc;
            }
            if (
                typeof initialSchedule?.sendAt === 'number'
                && typeof initialSchedule?.timezoneOffset === 'number'
            ) {
                return initialSchedule.sendAt + initialSchedule.timezoneOffset * 60_000;
            }
            return Date.now() + DEFAULT_LEAD_MINUTES * 60_000;
        })();

        const tz = initialSchedule?.timezoneId ?? timezoneGuess;
        const formatted = formatDateTimeInputValue(baseUtc, tz);
        const zoned = zonedDateTimeToUtc(formatted, tz);
        setSelectedTimezone(tz);
        setDateTimeInput(formatted);
        setTargetUtc(zoned?.utc ?? baseUtc);
        setTimezoneOffset(zoned?.offsetMinutes ?? new Date(baseUtc).getTimezoneOffset());
        setError(null);
        setInfo(null);
    }, [isOpen, initialSchedule?.sendAtUtc, initialSchedule?.sendAt, initialSchedule?.timezoneOffset, initialSchedule?.timezoneId, timezoneGuess]);

    const minDateTime = useMemo(() => {
        const now = Date.now() + MIN_LEAD_MS;
        return formatDateTimeInputValue(now, selectedTimezone);
    }, [selectedTimezone]);

    if (!isOpen) return null;

    const commitSchedule = (input: string, timezone: string) => {
        const zoned = zonedDateTimeToUtc(input, timezone);
        if (!zoned) {
            setError('Укажите корректную дату и время.');
            return false;
        }
        const { utc, offsetMinutes } = zoned;
        if (utc < Date.now() + MIN_LEAD_MS) {
            setError('Выберите время хотя бы на минуту вперёд.');
            return false;
        }
        setTargetUtc(utc);
        setTimezoneOffset(offsetMinutes);
        setError(null);
        return true;
    };

    const handleConfirm = () => {
        if (!commitSchedule(dateTimeInput, selectedTimezone)) {
            return;
        }

        const selection: ScheduleSelection = {
            sendAtUtc: targetUtc,
            timezoneOffset,
            timezoneId: selectedTimezone,
            localTimestamp: computeLocalTimestamp(targetUtc, timezoneOffset),
        };

        onConfirm(selection);
    };

    const handleDateChange = (value: string) => {
        setDateTimeInput(value);
        commitSchedule(value, selectedTimezone);
    };

    const handleTimezoneChange = (value: string) => {
        setSelectedTimezone(value);
        const formatted = formatDateTimeInputValue(targetUtc, value);
        setDateTimeInput(formatted);
        commitSchedule(formatted, value);
    };

    const applyQuickSelection = (mode: 'hour' | 'evening' | 'online') => {
        let nextUtc = targetUtc;
        if (mode === 'hour') {
            nextUtc = Math.max(Date.now(), targetUtc) + 60 * 60_000;
            setInfo(null);
        } else if (mode === 'evening') {
            const nowString = formatDateTimeInputValue(Date.now(), selectedTimezone);
            const parts = parseDateTimeInput(nowString);
            if (parts) {
                let targetDay = parts.day;
                let targetMonth = parts.month;
                let targetYear = parts.year;
                if (parts.hour >= EVENING_HOUR) {
                    const tempDate = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
                    tempDate.setUTCDate(tempDate.getUTCDate() + 1);
                    targetYear = tempDate.getUTCFullYear();
                    targetMonth = tempDate.getUTCMonth() + 1;
                    targetDay = tempDate.getUTCDate();
                }
                const input = `${targetYear.toString().padStart(4, '0')}-${targetMonth.toString().padStart(2, '0')}-${targetDay.toString().padStart(2, '0')}T${EVENING_HOUR.toString().padStart(2, '0')}:00`;
                const zoned = zonedDateTimeToUtc(input, selectedTimezone);
                if (zoned) {
                    nextUtc = zoned.utc;
                }
            }
            setInfo(null);
        } else if (mode === 'online') {
            nextUtc = Date.now() + MIN_LEAD_MS;
            setInfo('Мы будем пытаться отправить сообщение сразу после восстановления соединения.');
        }

        const formatted = formatDateTimeInputValue(nextUtc, selectedTimezone);
        setDateTimeInput(formatted);
        commitSchedule(formatted, selectedTimezone);
    };

    const attachments = messageContent?.attachments ?? [];
    const hasFormatted = typeof messageContent?.formatted === 'string' && messageContent.formatted.trim().length > 0;

    return (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 animate-fade-in-fast" onClick={onClose}>
            <div className="bg-gray-800 rounded-lg shadow-xl w-full max-w-md animate-slide-up" onClick={e => e.stopPropagation()}>
                <div className="p-6 border-b border-gray-700">
                    <h2 className="text-xl font-bold">{title ?? 'Schedule Message'}</h2>
                </div>
                <div className="p-6 space-y-6">
                    <div>
                        <p className="text-sm text-gray-400 mb-1">Message preview:</p>
                        {hasFormatted ? (
                            <div
                                className="p-3 bg-gray-900/50 rounded-md text-white text-sm whitespace-pre-wrap break-words max-h-48 overflow-y-auto"
                                dangerouslySetInnerHTML={{ __html: messageContent?.formatted ?? '' }}
                            />
                        ) : (
                            <p className="p-3 bg-gray-900/50 rounded-md text-white text-sm whitespace-pre-wrap break-words">
                                {messageContent?.plain?.trim() ? messageContent.plain : 'No message content'}
                            </p>
                        )}
                        {attachments.length > 0 && (
                            <div className="mt-3 space-y-2">
                                {attachments.map(attachment => {
                                    const preview = resolveAttachmentPreview(attachment);
                                    const isVisual = attachment.kind === 'image' || attachment.kind === 'gif' || attachment.kind === 'sticker';
                                    const duration = formatDuration(attachment.duration);
                                    return (
                                        <div
                                            key={attachment.id}
                                            className="flex items-center gap-3 p-3 bg-gray-900/40 border border-gray-700/60 rounded-md"
                                        >
                                            {isVisual ? (
                                                preview ? (
                                                    <img
                                                        src={preview}
                                                        alt={attachment.name}
                                                        className="w-14 h-14 rounded-md object-cover border border-gray-700"
                                                    />
                                                ) : (
                                                    <div className="w-14 h-14 rounded-md bg-gray-800 border border-gray-700 flex items-center justify-center text-xs text-gray-400">
                                                        No preview
                                                    </div>
                                                )
                                            ) : (
                                                <div className="w-12 h-12 rounded-md bg-gray-800 border border-gray-700 flex items-center justify-center text-gray-300">
                                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" viewBox="0 0 20 20" fill="currentColor">
                                                        <path d="M4 3a2 2 0 00-2 2v10a2 2 0 002 2h6.586A2 2 0 0012 16.586l3.586-3.586A2 2 0 0016 11.414V5a2 2 0 00-2-2H4zm6 11V9l4 4h-4z" />
                                                    </svg>
                                                </div>
                                            )}
                                            <div className="flex-1 min-w-0">
                                                <p className="text-sm text-white truncate" title={attachment.name}>{attachment.name}</p>
                                                <p className="text-xs text-gray-400">
                                                    {formatFileSize(attachment.size)}
                                                    {attachment.mimeType ? ` • ${attachment.mimeType}` : ''}
                                                    {duration ? ` • ${duration}` : ''}
                                                </p>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                    <div>
                        <label htmlFor="scheduleTime" className="block text-sm font-medium text-gray-300 mb-1">
                            Send at:
                        </label>
                        <input
                            type="datetime-local"
                            id="scheduleTime"
                            value={dateTimeInput}
                            min={minDateTime}
                            onChange={event => handleDateChange(event.target.value)}
                            className="appearance-none block w-full px-3 py-2 border border-gray-700 bg-gray-900 text-white placeholder-gray-500 rounded-md focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                        />
                        <div className="mt-3 flex flex-wrap gap-2">
                            <button
                                type="button"
                                onClick={() => applyQuickSelection('hour')}
                                className="px-3 py-1 text-xs rounded-full bg-gray-700/60 text-gray-200 hover:bg-gray-600"
                            >
                                через 1 ч
                            </button>
                            <button
                                type="button"
                                onClick={() => applyQuickSelection('evening')}
                                className="px-3 py-1 text-xs rounded-full bg-gray-700/60 text-gray-200 hover:bg-gray-600"
                            >
                                вечером
                            </button>
                            <button
                                type="button"
                                onClick={() => applyQuickSelection('online')}
                                className="px-3 py-1 text-xs rounded-full bg-gray-700/60 text-gray-200 hover:bg-gray-600"
                            >
                                при появлении онлайн
                            </button>
                        </div>
                        <label htmlFor="scheduleTimezone" className="block text-sm font-medium text-gray-300 mt-4 mb-1">
                            Timezone:
                        </label>
                        <select
                            id="scheduleTimezone"
                            value={selectedTimezone}
                            onChange={event => handleTimezoneChange(event.target.value)}
                            className="w-full bg-gray-900 border border-gray-700 text-white rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
                        >
                            {timezoneOptions.map(option => (
                                <option key={option} value={option}>
                                    {formatTimezoneLabel(option, targetUtc)}
                                </option>
                            ))}
                        </select>
                        {error && (
                            <p className="mt-2 text-sm text-red-400">{error}</p>
                        )}
                        <p className="mt-2 text-xs text-gray-400">
                            Минимальная задержка — 1 минута. Сервер Matrix всё ещё применяет rate limit, поэтому распределяйте отложенные сообщения по времени.
                        </p>
                        {info && (
                            <p className="mt-2 text-xs text-indigo-300">{info}</p>
                        )}
                    </div>
                </div>
                <div className="bg-gray-700/50 px-6 py-4 flex justify-end gap-3 rounded-b-lg">
                    <button
                        onClick={onClose}
                        className="py-2 px-4 border border-gray-600 rounded-md text-sm font-medium text-gray-200 hover:bg-gray-700"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleConfirm}
                        className="py-2 px-4 border border-transparent rounded-md text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700"
                    >
                        Schedule
                    </button>
                </div>
            </div>
        </div>
    );
};

export default ScheduleMessageModal;
