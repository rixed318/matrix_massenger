import React, { useState } from 'react';

interface CreateRoomModalProps {
    isOpen: boolean;
    onClose: () => void;
    onCreate: (options: { name: string, topic?: string, isPublic: boolean, isEncrypted: boolean }) => void;
}

const CreateRoomModal: React.FC<CreateRoomModalProps> = ({ isOpen, onClose, onCreate }) => {
    const [name, setName] = useState('');
    const [topic, setTopic] = useState('');
    const [isPublic, setIsPublic] = useState(false);
    const [isEncrypted, setIsEncrypted] = useState(true);
    const [isCreating, setIsCreating] = useState(false);

    if (!isOpen) return null;

    const handleCreate = async () => {
        if (!name.trim()) return;
        setIsCreating(true);
        await onCreate({ name: name.trim(), topic: topic.trim(), isPublic, isEncrypted });
        // Reset state for next time
        setIsCreating(false);
        setName('');
        setTopic('');
        setIsPublic(false);
        setIsEncrypted(true);
    };

    return (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 animate-fade-in-fast" onClick={onClose}>
            <div className="bg-gray-800 rounded-lg shadow-xl w-full max-w-md animate-slide-up" onClick={e => e.stopPropagation()}>
                <div className="p-6 border-b border-gray-700">
                    <h2 className="text-xl font-bold">Create a new room</h2>
                </div>
                <div className="p-6 space-y-6">
                    <div>
                        <label htmlFor="roomName" className="block text-sm font-medium text-gray-300 mb-1">
                            Room Name <span className="text-red-400">*</span>
                        </label>
                        <input
                            type="text"
                            id="roomName"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            className="appearance-none block w-full px-3 py-2 border border-gray-700 bg-gray-900 text-white placeholder-gray-500 rounded-md focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                            placeholder="e.g. #general"
                        />
                    </div>
                     <div>
                        <label htmlFor="roomTopic" className="block text-sm font-medium text-gray-300 mb-1">
                            Topic (optional)
                        </label>
                        <input
                            type="text"
                            id="roomTopic"
                            value={topic}
                            onChange={(e) => setTopic(e.target.value)}
                            className="appearance-none block w-full px-3 py-2 border border-gray-700 bg-gray-900 text-white placeholder-gray-500 rounded-md focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                            placeholder="What is this room about?"
                        />
                    </div>
                    <div className="space-y-3">
                        <div className="relative flex items-start">
                            <div className="flex items-center h-5">
                                <input
                                id="public"
                                name="visibility"
                                type="checkbox"
                                checked={isPublic}
                                onChange={(e) => setIsPublic(e.target.checked)}
                                className="focus:ring-indigo-500 h-4 w-4 text-indigo-600 border-gray-600 rounded bg-gray-900"
                                />
                            </div>
                            <div className="ml-3 text-sm">
                                <label htmlFor="public" className="font-medium text-gray-300">Make this room public</label>
                                <p className="text-gray-400">Public rooms can be discovered by anyone.</p>
                            </div>
                        </div>
                         <div className="relative flex items-start">
                            <div className="flex items-center h-5">
                                <input
                                id="encrypted"
                                name="encryption"
                                type="checkbox"
                                checked={isEncrypted}
                                onChange={(e) => setIsEncrypted(e.target.checked)}
                                className="focus:ring-indigo-500 h-4 w-4 text-indigo-600 border-gray-600 rounded bg-gray-900"
                                />
                            </div>
                            <div className="ml-3 text-sm">
                                <label htmlFor="encrypted" className="font-medium text-gray-300">Enable end-to-end encryption</label>
                                <p className="text-gray-400">Recommended for private conversations.</p>
                            </div>
                        </div>
                    </div>
                </div>
                <div className="bg-gray-700/50 px-6 py-4 flex justify-end gap-3 rounded-b-lg">
                    <button
                        onClick={onClose}
                        className="py-2 px-4 border border-gray-600 rounded-md text-sm font-medium text-gray-200 hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-500 focus:ring-offset-gray-800"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleCreate}
                        disabled={!name.trim() || isCreating}
                        className="py-2 px-4 border border-transparent rounded-md text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 focus:ring-offset-gray-800 disabled:bg-indigo-400 disabled:cursor-not-allowed"
                    >
                        {isCreating ? 'Creating...' : 'Create Room'}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default CreateRoomModal;
