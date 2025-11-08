import React, { useState } from 'react';

interface InviteUserModalProps {
    isOpen: boolean;
    onClose: () => void;
    onInvite: (userId: string) => Promise<void>;
    roomName: string;
}

const InviteUserModal: React.FC<InviteUserModalProps> = ({ isOpen, onClose, onInvite, roomName }) => {
    const [userId, setUserId] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    if (!isOpen) return null;

    const handleInvite = async () => {
        if (!userId.trim() || !userId.startsWith('@') || !userId.includes(':')) {
            setError('Please enter a valid Matrix ID (e.g., @username:matrix.org)');
            return;
        }
        setError(null);
        setIsLoading(true);
        try {
            await onInvite(userId.trim());
        } catch (err: any) {
            setError(err.message || 'Failed to send invitation. The user may not exist or you may not have permission.');
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 animate-fade-in-fast" onClick={onClose}>
            <div className="bg-gray-800 rounded-lg shadow-xl w-full max-w-md animate-slide-up" onClick={e => e.stopPropagation()}>
                <div className="p-6 border-b border-gray-700">
                    <h2 className="text-xl font-bold">Invite to {roomName}</h2>
                </div>
                <div className="p-6 space-y-4">
                    <div>
                        <label htmlFor="userId" className="block text-sm font-medium text-gray-300 mb-1">
                            User ID
                        </label>
                        <input
                            type="text"
                            id="userId"
                            value={userId}
                            onChange={(e) => setUserId(e.target.value)}
                            className="appearance-none block w-full px-3 py-2 border border-gray-700 bg-gray-900 text-white placeholder-gray-500 rounded-md focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                            placeholder="@username:matrix.org"
                        />
                    </div>
                    {error && <p className="text-red-400 text-sm">{error}</p>}
                </div>
                <div className="bg-gray-700/50 px-6 py-4 flex justify-end gap-3 rounded-b-lg">
                    <button
                        onClick={onClose}
                        className="py-2 px-4 border border-gray-600 rounded-md text-sm font-medium text-gray-200 hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-500 focus:ring-offset-gray-800"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleInvite}
                        disabled={!userId.trim() || isLoading}
                        className="py-2 px-4 border border-transparent rounded-md text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 focus:ring-offset-gray-800 disabled:bg-indigo-400 disabled:cursor-not-allowed"
                    >
                        {isLoading ? 'Inviting...' : 'Invite'}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default InviteUserModal;