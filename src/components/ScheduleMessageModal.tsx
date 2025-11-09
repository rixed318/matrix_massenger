import React, { useState } from 'react';
import type { DraftAttachment, DraftContent } from '../types';

interface ScheduleMessageModalProps {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: (sendAt: number) => void;
    messageContent: DraftContent | null;
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

const ScheduleMessageModal: React.FC<ScheduleMessageModalProps> = ({ isOpen, onClose, onConfirm, messageContent }) => {
    const now = new Date();
    // Set default to 5 minutes in the future
    now.setMinutes(now.getMinutes() + 5);
    // Format for datetime-local input (YYYY-MM-DDTHH:mm)
    const defaultDateTime = now.toISOString().slice(0, 16);

    const [dateTime, setDateTime] = useState(defaultDateTime);

    if (!isOpen) return null;

    const handleConfirm = () => {
        const selectedDate = new Date(dateTime);
        if (selectedDate.getTime() > Date.now()) {
            onConfirm(selectedDate.getTime());
        } else {
            // TODO: Show an error to the user
            alert("Please select a time in the future.");
        }
    };
    
    // Get min value for date time input to prevent selecting past dates
    const minDateTime = new Date().toISOString().slice(0, 16);

    const attachments = messageContent?.attachments ?? [];
    const hasFormatted = typeof messageContent?.formatted === 'string' && messageContent.formatted.trim().length > 0;

    return (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 animate-fade-in-fast" onClick={onClose}>
            <div className="bg-gray-800 rounded-lg shadow-xl w-full max-w-md animate-slide-up" onClick={e => e.stopPropagation()}>
                <div className="p-6 border-b border-gray-700">
                    <h2 className="text-xl font-bold">Schedule Message</h2>
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
                            value={dateTime}
                            min={minDateTime}
                            onChange={(e) => setDateTime(e.target.value)}
                            className="appearance-none block w-full px-3 py-2 border border-gray-700 bg-gray-900 text-white placeholder-gray-500 rounded-md focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                        />
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
