import React, { useState } from 'react';

interface ScheduleMessageModalProps {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: (sendAt: number, threadRootId?: string) => void;
    messageContent: string;
    threadRootId?: string;
}

const ScheduleMessageModal: React.FC<ScheduleMessageModalProps> = ({ isOpen, onClose, onConfirm, messageContent, threadRootId }) => {
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
            onConfirm(selectedDate.getTime(), threadRootId);
        } else {
            // TODO: Show an error to the user
            alert("Please select a time in the future.");
        }
    };
    
    // Get min value for date time input to prevent selecting past dates
    const minDateTime = new Date().toISOString().slice(0, 16);

    return (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 animate-fade-in-fast" onClick={onClose}>
            <div className="bg-gray-800 rounded-lg shadow-xl w-full max-w-md animate-slide-up" onClick={e => e.stopPropagation()}>
                <div className="p-6 border-b border-gray-700">
                    <h2 className="text-xl font-bold">Schedule Message</h2>
                </div>
                <div className="p-6 space-y-6">
                    {threadRootId && (
                        <div className="p-3 rounded-md bg-indigo-900/30 border border-indigo-700/40 text-sm text-indigo-200">
                            This message will be scheduled inside the active thread.
                        </div>
                    )}
                    <div>
                        <p className="text-sm text-gray-400 mb-1">Message:</p>
                        <p className="p-3 bg-gray-900/50 rounded-md text-white truncate">{messageContent}</p>
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
