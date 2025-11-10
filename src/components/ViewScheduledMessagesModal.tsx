import React, { useEffect, useMemo, useState } from 'react';
import {
    DraftContent,
    ScheduledMessage,
    ScheduledMessageScheduleUpdate,
    ScheduledMessageUpdatePayload,
} from '@matrix-messenger/core';
import { format, formatDistanceToNowStrict } from 'date-fns';
import {
    formatDateTimeInputValue,
    formatTimezoneLabel,
    getSupportedTimezones,
    zonedDateTimeToUtc,
} from '../utils/timezone';

interface ViewScheduledMessagesModalProps {
    isOpen: boolean;
    onClose: () => void;
    messages: ScheduledMessage[];
    onDelete: (id: string) => void;
    onSendNow: (id: string) => void;
    onUpdate: (id: string, update: ScheduledMessageUpdatePayload) => Promise<void>;
    onBulkReschedule: (ids: string[], schedule: ScheduledMessageScheduleUpdate) => Promise<void>;
    onBulkSend: (ids: string[]) => Promise<void>;
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

const resolveAttachmentPreview = (attachment: ScheduledMessage['content']['attachments'][number]): string | null => {
    return attachment.thumbnailUrl
        ?? attachment.dataUrl
        ?? attachment.tempUrl
        ?? attachment.url
        ?? null;
};

const cloneDraftContent = (content: DraftContent): DraftContent => ({
    plain: content.plain,
    formatted: content.formatted,
    msgtype: content.msgtype,
    attachments: content.attachments.map(attachment => ({
        ...attachment,
        waveform: attachment.waveform ? [...attachment.waveform] : undefined,
    })),
});

const MIN_LEAD_MS = 60_000;
const DEFAULT_LEAD_MS = 5 * 60_000;

const ViewScheduledMessagesModal: React.FC<ViewScheduledMessagesModalProps> = ({
    isOpen,
    onClose,
    messages,
    onDelete,
    onSendNow,
    onUpdate,
    onBulkReschedule,
    onBulkSend,
}) => {
    if (!isOpen) return null;

    const timezoneOptions = useMemo(() => getSupportedTimezones(), []);
    const defaultTimezone = useMemo(
        () => Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC',
        [],
    );

    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [isBulkPanelOpen, setIsBulkPanelOpen] = useState(false);
    const [bulkTimezone, setBulkTimezone] = useState(defaultTimezone);
    const [bulkDateInput, setBulkDateInput] = useState(() =>
        formatDateTimeInputValue(Date.now() + DEFAULT_LEAD_MS, defaultTimezone),
    );
    const [bulkError, setBulkError] = useState<string | null>(null);
    const [isBulkSaving, setIsBulkSaving] = useState(false);

    const [editingId, setEditingId] = useState<string | null>(null);
    const [editDraft, setEditDraft] = useState<DraftContent | null>(null);
    const [editTimezone, setEditTimezone] = useState(defaultTimezone);
    const [editDateInput, setEditDateInput] = useState(() =>
        formatDateTimeInputValue(Date.now() + DEFAULT_LEAD_MS, defaultTimezone),
    );
    const [editError, setEditError] = useState<string | null>(null);
    const [isSavingEdit, setIsSavingEdit] = useState(false);

    const resetEditing = () => {
        setEditingId(null);
        setEditDraft(null);
        setEditError(null);
        setIsSavingEdit(false);
    };

    const toggleSelection = (id: string) => {
        setSelectedIds(prev => {
            const next = new Set(prev);
            if (next.has(id)) {
                next.delete(id);
            } else {
                next.add(id);
            }
            return next;
        });
    };

    const clearSelection = () => {
        setSelectedIds(new Set());
        setIsBulkPanelOpen(false);
        setBulkError(null);
    };

    useEffect(() => {
        if (!isOpen) {
            clearSelection();
            resetEditing();
        }
    }, [isOpen]);

    const handleOpenBulkPanel = () => {
        setIsBulkPanelOpen(prev => !prev);
        setBulkError(null);
        setBulkDateInput(formatDateTimeInputValue(Date.now() + DEFAULT_LEAD_MS, bulkTimezone));
    };

    const handleBulkTimezoneChange = (value: string) => {
        const zoned = zonedDateTimeToUtc(bulkDateInput, bulkTimezone);
        const baseUtc = zoned ? zoned.utc : Date.now() + DEFAULT_LEAD_MS;
        setBulkTimezone(value);
        setBulkDateInput(formatDateTimeInputValue(baseUtc, value));
    };

    const handleBulkApply = async () => {
        if (selectedIds.size === 0) {
            return;
        }
        const zoned = zonedDateTimeToUtc(bulkDateInput, bulkTimezone);
        if (!zoned) {
            setBulkError('Укажите корректную дату и время.');
            return;
        }
        if (zoned.utc < Date.now() + MIN_LEAD_MS) {
            setBulkError('Выберите время хотя бы на минуту вперёд.');
            return;
        }

        setIsBulkSaving(true);
        setBulkError(null);
        try {
            await onBulkReschedule(Array.from(selectedIds), {
                sendAtUtc: zoned.utc,
                timezoneOffset: zoned.offsetMinutes,
                timezoneId: bulkTimezone,
            });
            clearSelection();
        } catch (error) {
            setBulkError(error instanceof Error ? error.message : 'Не удалось перенести сообщения');
        } finally {
            setIsBulkSaving(false);
        }
    };

    const handleBulkSend = async () => {
        if (selectedIds.size === 0) {
            return;
        }
        setIsBulkSaving(true);
        setBulkError(null);
        try {
            await onBulkSend(Array.from(selectedIds));
            clearSelection();
        } catch (error) {
            setBulkError(error instanceof Error ? error.message : 'Не удалось запустить отправку');
        } finally {
            setIsBulkSaving(false);
        }
    };

    const handleSendNowSingle = (id: string) => {
        onSendNow(id);
        setSelectedIds(prev => {
            if (!prev.has(id)) return prev;
            const next = new Set(prev);
            next.delete(id);
            return next;
        });
    };

    const handleDeleteSingle = (id: string) => {
        onDelete(id);
        setSelectedIds(prev => {
            if (!prev.has(id)) return prev;
            const next = new Set(prev);
            next.delete(id);
            return next;
        });
        if (editingId === id) {
            resetEditing();
        }
    };

    const openEditing = (message: ScheduledMessage) => {
        setEditingId(message.id);
        setEditDraft(cloneDraftContent(message.content));
        const timezone = message.timezoneId ?? defaultTimezone;
        setEditTimezone(timezone);
        const baseUtc = message.sendAtUtc
            ?? (typeof message.timezoneOffset === 'number'
                ? message.sendAt + message.timezoneOffset * 60_000
                : message.sendAt);
        setEditDateInput(formatDateTimeInputValue(baseUtc, timezone));
        setEditError(null);
        setIsSavingEdit(false);
    };

    const handleEditTextChange = (value: string) => {
        setEditDraft(prev => (prev ? { ...prev, plain: value, formatted: undefined } : prev));
    };

    const handleRemoveAttachment = (id: string) => {
        setEditDraft(prev => (prev ? { ...prev, attachments: prev.attachments.filter(att => att.id !== id) } : prev));
    };

    const handleEditTimezoneChange = (value: string) => {
        const zoned = zonedDateTimeToUtc(editDateInput, editTimezone);
        const baseUtc = zoned ? zoned.utc : Date.now() + DEFAULT_LEAD_MS;
        setEditTimezone(value);
        setEditDateInput(formatDateTimeInputValue(baseUtc, value));
    };

    const handleEditDateChange = (value: string) => {
        setEditDateInput(value);
    };

    const handleEditSave = async () => {
        if (!editingId || !editDraft) {
            return;
        }
        if (!editDraft.plain.trim() && editDraft.attachments.length === 0) {
            setEditError('Добавьте текст или вложение к сообщению.');
            return;
        }
        const zoned = zonedDateTimeToUtc(editDateInput, editTimezone);
        if (!zoned) {
            setEditError('Укажите корректную дату и время.');
            return;
        }
        if (zoned.utc < Date.now() + MIN_LEAD_MS) {
            setEditError('Выберите время хотя бы на минуту вперёд.');
            return;
        }

        setIsSavingEdit(true);
        setEditError(null);
        try {
            await onUpdate(editingId, {
                content: editDraft,
                schedule: {
                    sendAtUtc: zoned.utc,
                    timezoneOffset: zoned.offsetMinutes,
                    timezoneId: editTimezone,
                },
            });
            resetEditing();
        } catch (error) {
            setEditError(error instanceof Error ? error.message : 'Не удалось сохранить изменения');
        } finally {
            setIsSavingEdit(false);
        }
    };

    const editMinDateTime = formatDateTimeInputValue(Date.now() + MIN_LEAD_MS, editTimezone);
    const bulkMinDateTime = formatDateTimeInputValue(Date.now() + MIN_LEAD_MS, bulkTimezone);

    const sortedMessages = [...messages].sort(
        (a, b) => (a.sendAtUtc ?? a.sendAt) - (b.sendAtUtc ?? b.sendAt),
    );

    return (
        <div
            className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 animate-fade-in-fast"
            onClick={onClose}
        >
            <div
                className="relative bg-gray-800 rounded-lg shadow-xl w-full max-w-lg h-[70vh] flex flex-col animate-slide-up"
                onClick={e => e.stopPropagation()}
            >
                <div className="p-6 border-b border-gray-700">
                    <h2 className="text-xl font-bold">Scheduled Messages</h2>
                </div>
                {selectedIds.size > 0 && (
                    <div className="px-6 py-3 border-b border-gray-700 bg-gray-900/50 flex flex-wrap items-center justify-between gap-3">
                        <div className="text-sm text-gray-200">
                            Выбрано {selectedIds.size}
                        </div>
                        <div className="flex items-center gap-2">
                            <button
                                type="button"
                                onClick={handleOpenBulkPanel}
                                className="px-3 py-1 text-xs rounded-md bg-indigo-600 text-white hover:bg-indigo-500"
                            >
                                Перенести
                            </button>
                            <button
                                type="button"
                                onClick={handleBulkSend}
                                className="px-3 py-1 text-xs rounded-md bg-emerald-600 text-white hover:bg-emerald-500"
                                disabled={isBulkSaving}
                            >
                                Отправить сейчас
                            </button>
                            <button
                                type="button"
                                onClick={clearSelection}
                                className="px-3 py-1 text-xs rounded-md bg-gray-700 text-gray-200 hover:bg-gray-600"
                            >
                                Очистить
                            </button>
                        </div>
                    </div>
                )}
                {isBulkPanelOpen && selectedIds.size > 0 && (
                    <div className="px-6 py-4 border-b border-gray-700 bg-gray-900/60 space-y-3">
                        <div>
                            <label className="block text-xs text-gray-300 mb-1" htmlFor="bulkSchedule">Новое время отправки</label>
                            <input
                                id="bulkSchedule"
                                type="datetime-local"
                                value={bulkDateInput}
                                min={bulkMinDateTime}
                                onChange={event => setBulkDateInput(event.target.value)}
                                className="w-full px-3 py-2 rounded-md border border-gray-700 bg-gray-900 text-white text-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
                            />
                        </div>
                        <div>
                            <label className="block text-xs text-gray-300 mb-1" htmlFor="bulkTimezone">Часовой пояс</label>
                            <select
                                id="bulkTimezone"
                                value={bulkTimezone}
                                onChange={event => handleBulkTimezoneChange(event.target.value)}
                                className="w-full px-3 py-2 rounded-md border border-gray-700 bg-gray-900 text-white text-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
                            >
                                {timezoneOptions.map(option => (
                                    <option key={option} value={option}>
                                        {formatTimezoneLabel(option)}
                                    </option>
                                ))}
                            </select>
                        </div>
                        {bulkError && (
                            <p className="text-xs text-red-400">{bulkError}</p>
                        )}
                        <div className="flex justify-end gap-2">
                            <button
                                type="button"
                                onClick={handleBulkApply}
                                className="px-3 py-1 text-xs rounded-md bg-indigo-600 text-white hover:bg-indigo-500 disabled:opacity-60"
                                disabled={isBulkSaving}
                            >
                                Применить
                            </button>
                        </div>
                    </div>
                )}
                <div className="flex-1 overflow-y-auto p-4 space-y-3">
                    {sortedMessages.length > 0 ? (
                        sortedMessages.map(message => {
                            const scheduledTimestamp = message.sendAtUtc ?? message.sendAt;
                            const isRetrying = message.status === 'retrying';
                            const nextAttempt =
                                isRetrying && message.nextRetryAt ? message.nextRetryAt : undefined;
                            const attempts = message.attempts ?? 0;

                            const countdown = scheduledTimestamp > Date.now()
                                ? formatDistanceToNowStrict(new Date(scheduledTimestamp))
                                : 'просрочено';
                            const isSelected = selectedIds.has(message.id);

                            return (
                                <div key={message.id} className="p-3 bg-gray-900/50 rounded-md space-y-2">
                                    <div className="flex items-center justify-between">
                                        <label className="flex items-center gap-2 text-xs text-gray-300">
                                            <input
                                                type="checkbox"
                                                checked={isSelected}
                                                onChange={() => toggleSelection(message.id)}
                                                className="accent-indigo-500"
                                            />
                                            Выбрать
                                        </label>
                                        <button
                                            type="button"
                                            onClick={() => openEditing(message)}
                                            className="text-xs text-indigo-300 hover:text-indigo-200"
                                        >
                                            Редактировать
                                        </button>
                                    </div>
                                    <p className="text-white break-words whitespace-pre-wrap">
                                        {message.content.plain?.trim()
                                            || (message.content.attachments.length > 0
                                                ? 'Attachments only'
                                                : 'No text content')}
                                    </p>
                                    {message.content.attachments.length > 0 && (
                                        <div className="space-y-2">
                                            {message.content.attachments.map(attachment => {
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
                                    <div className="flex flex-wrap items-center gap-2 text-xs">
                                        <span
                                            className={`px-2 py-0.5 rounded-full ${
                                                isRetrying
                                                    ? 'bg-amber-500/20 text-amber-300'
                                                    : 'bg-emerald-500/20 text-emerald-300'
                                            }`}
                                        >
                                            {isRetrying ? 'Retrying' : 'Scheduled'}
                                        </span>
                                        {attempts > 0 && (
                                            <span className="px-2 py-0.5 rounded-full bg-gray-700 text-gray-200">
                                                {attempts} {attempts === 1 ? 'attempt' : 'attempts'}
                                            </span>
                                        )}
                                    </div>
                                    <div className="text-sm text-indigo-300 font-medium">
                                        Scheduled for{' '}
                                        {format(new Date(scheduledTimestamp), "MMM d, yyyy 'at' h:mm a")}
                                    </div>
                                    <div className="text-xs text-gray-300">
                                        ⏳ Осталось: {countdown}
                                    </div>
                                    {nextAttempt && (
                                        <div className="text-xs text-amber-300">
                                            Next retry at{' '}
                                            {format(new Date(nextAttempt), "MMM d, yyyy 'at' h:mm a")}
                                        </div>
                                    )}
                                    {message.lastError && (
                                        <div className="text-xs text-red-300">
                                            Last error: {message.lastError}
                                        </div>
                                    )}
                                    <div className="flex items-center justify-between pt-2 border-t border-gray-700/50">
                                        <div className="flex items-center gap-2">
                                            <button
                                                onClick={() => handleSendNowSingle(message.id)}
                                                className="text-sm text-gray-300 hover:text-white hover:underline"
                                            >
                                                Send Now
                                            </button>
                                            <button
                                                onClick={() => handleDeleteSingle(message.id)}
                                                className="p-1 rounded-full text-gray-400 hover:text-red-400 hover:bg-gray-700"
                                            >
                                                <svg
                                                    xmlns="http://www.w3.org/2000/svg"
                                                    className="h-4 w-4"
                                                    viewBox="0 0 20 20"
                                                    fill="currentColor"
                                                >
                                                    <path
                                                        fillRule="evenodd"
                                                        d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z"
                                                        clipRule="evenodd"
                                                    />
                                                </svg>
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            );
                        })
                    ) : (
                        <p className="text-gray-400 text-center pt-8">
                            No messages scheduled for this room.
                        </p>
                    )}
                </div>
                <div className="bg-gray-700/50 px-6 py-4 flex justify-end rounded-b-lg">
                    <button
                        onClick={onClose}
                        className="py-2 px-4 border border-gray-600 rounded-md text-sm font-medium text-gray-200 hover:bg-gray-700"
                    >
                        Close
                    </button>
                </div>
                {editingId && editDraft && (
                    <div className="absolute inset-0 bg-black/50 backdrop-blur-sm flex items-end justify-center p-4">
                        <div className="bg-gray-900 rounded-lg shadow-xl border border-gray-700 w-full max-w-lg p-4 space-y-4">
                            <h3 className="text-lg font-semibold text-white">Редактировать отложенное сообщение</h3>
                            <div>
                                <label htmlFor="editText" className="block text-xs text-gray-300 mb-1">Текст сообщения</label>
                                <textarea
                                    id="editText"
                                    value={editDraft.plain}
                                    onChange={event => handleEditTextChange(event.target.value)}
                                    rows={3}
                                    className="w-full px-3 py-2 rounded-md border border-gray-700 bg-gray-900 text-white text-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
                                />
                            </div>
                            {editDraft.attachments.length > 0 && (
                                <div className="space-y-2">
                                    <p className="text-xs text-gray-300">Вложения:</p>
                                    {editDraft.attachments.map(attachment => {
                                        const preview = resolveAttachmentPreview(attachment);
                                        const isVisual = attachment.kind === 'image' || attachment.kind === 'gif' || attachment.kind === 'sticker';
                                        const duration = formatDuration(attachment.duration);
                                        return (
                                            <div
                                                key={attachment.id}
                                                className="flex items-center gap-3 p-2 bg-gray-800/60 border border-gray-700 rounded-md"
                                            >
                                                {isVisual && preview ? (
                                                    <img src={preview} alt={attachment.name} className="w-12 h-12 rounded object-cover border border-gray-700" />
                                                ) : (
                                                    <div className="w-10 h-10 rounded-md bg-gray-800 border border-gray-700 flex items-center justify-center text-gray-300">
                                                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                                                            <path d="M4 3a2 2 0 00-2 2v10a2 2 0 002 2h6.586A2 2 0 0012 16.586l3.586-3.586A2 2 0 0016 11.414V5a2 2 0 00-2-2H4zm6 11V9l4 4h-4z" />
                                                        </svg>
                                                    </div>
                                                )}
                                                <div className="flex-1 min-w-0">
                                                    <p className="text-xs text-white truncate" title={attachment.name}>{attachment.name}</p>
                                                    <p className="text-[11px] text-gray-400">
                                                        {formatFileSize(attachment.size)}
                                                        {attachment.mimeType ? ` • ${attachment.mimeType}` : ''}
                                                        {duration ? ` • ${duration}` : ''}
                                                    </p>
                                                </div>
                                                <button
                                                    type="button"
                                                    onClick={() => handleRemoveAttachment(attachment.id)}
                                                    className="text-xs text-red-300 hover:text-red-200"
                                                >
                                                    Удалить
                                                </button>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                    <label htmlFor="editDate" className="block text-xs text-gray-300 mb-1">Время отправки</label>
                                    <input
                                        id="editDate"
                                        type="datetime-local"
                                        value={editDateInput}
                                        min={editMinDateTime}
                                        onChange={event => handleEditDateChange(event.target.value)}
                                        className="w-full px-3 py-2 rounded-md border border-gray-700 bg-gray-900 text-white text-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
                                    />
                                </div>
                                <div>
                                    <label htmlFor="editTimezone" className="block text-xs text-gray-300 mb-1">Часовой пояс</label>
                                    <select
                                        id="editTimezone"
                                        value={editTimezone}
                                        onChange={event => handleEditTimezoneChange(event.target.value)}
                                        className="w-full px-3 py-2 rounded-md border border-gray-700 bg-gray-900 text-white text-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
                                    >
                                        {timezoneOptions.map(option => (
                                            <option key={option} value={option}>
                                                {formatTimezoneLabel(option)}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                            </div>
                            {editError && <p className="text-xs text-red-400">{editError}</p>}
                            <div className="flex justify-end gap-2">
                                <button
                                    type="button"
                                    onClick={resetEditing}
                                    className="px-3 py-1 text-xs rounded-md bg-gray-700 text-gray-200 hover:bg-gray-600"
                                >
                                    Отмена
                                </button>
                                <button
                                    type="button"
                                    onClick={handleEditSave}
                                    className="px-3 py-1 text-xs rounded-md bg-indigo-600 text-white hover:bg-indigo-500 disabled:opacity-60"
                                    disabled={isSavingEdit}
                                >
                                    Сохранить
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default ViewScheduledMessagesModal;
