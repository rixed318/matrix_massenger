import React from 'react';
import { ScheduledMessage } from '../types';
import { format } from 'date-fns';

interface ViewScheduledMessagesModalProps {
    isOpen: boolean;
    onClose: () => void;
    messages: ScheduledMessage[];
    onDelete: (id: string) => void;
    onSendNow: (id: string) => void;
}

const ViewScheduledMessagesModal: React.FC<ViewScheduledMessagesModalProps> = ({
    isOpen,
    onClose,
    messages,
    onDelete,
    onSendNow,
}) => {
    if (!isOpen) return null;

    const sortedMessages = [...messages].sort(
        (a, b) => (a.sendAtUtc ?? a.sendAt) - (b.sendAtUtc ?? b.sendAt),
    );

    return (
        <div
            className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 animate-fade-in-fast"
            onClick={onClose}
        >
            <div
                className="bg-gray-800 rounded-lg shadow-xl w-full max-w-lg h-[70vh] flex flex-col animate-slide-up"
                onClick={e => e.stopPropagation()}
            >
                <div className="p-6 border-b border-gray-700">
                    <h2 className="text-xl font-bold">Scheduled Messages</h2>
                </div>
                <div className="flex-1 overflow-y-auto p-4 space-y-3">
                    {sortedMessages.length > 0 ? (
                        sortedMessages.map(message => {
                            const scheduledTimestamp = message.sendAtUtc ?? message.sendAt;
                            const isRetrying = message.status === 'retrying';
                            const nextAttempt =
                                isRetrying && message.nextRetryAt ? message.nextRetryAt : undefined;
                            const attempts = message.attempts ?? 0;

                            return (
                                <div key={message.id} className="p-3 bg-gray-900/50 rounded-md space-y-2">
                                    <p className="text-white break-words whitespace-pre-wrap">{message.content}</p>
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
                                                onClick={() => onSendNow(message.id)}
                                                className="text-sm text-gray-300 hover:text-white hover:underline"
                                            >
                                                Send Now
                                            </button>
                                            <button
                                                onClick={() => onDelete(message.id)}
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
            </div>
        </div>
    );
};

export default ViewScheduledMessagesModal;
