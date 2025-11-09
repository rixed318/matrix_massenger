import React, { useMemo, useState } from 'react';
import type { RoomCreationOptions, RoomHistoryVisibility } from '../types';

interface CreateRoomModalProps {
    isOpen: boolean;
    onClose: () => void;
    onCreate: (options: RoomCreationOptions) => Promise<string>;
}

const historyOptions: Array<{ value: RoomHistoryVisibility; label: string; description: string }> = [
    {
        value: 'shared',
        label: 'Since invited',
        description: 'New members can read the conversation from the moment they were invited.',
    },
    {
        value: 'joined',
        label: 'Since joining',
        description: 'Only messages sent after a user joins are visible to them.',
    },
    {
        value: 'invited',
        label: 'Only while invited',
        description: 'History becomes hidden once an invitee leaves or the invite is revoked.',
    },
    {
        value: 'world_readable',
        label: 'Public archive',
        description: 'Anyone can read the full history without joining the room.',
    },
];

const CreateRoomModal: React.FC<CreateRoomModalProps> = ({ isOpen, onClose, onCreate }) => {
    const [name, setName] = useState('');
    const [topic, setTopic] = useState('');
    const [roomAliasName, setRoomAliasName] = useState('');
    const [isPublic, setIsPublic] = useState(false);
    const [isEncrypted, setIsEncrypted] = useState(true);
    const [mode, setMode] = useState<'chat' | 'channel'>('chat');
    const [historyVisibility, setHistoryVisibility] = useState<RoomHistoryVisibility>('shared');
    const [slowModeEnabled, setSlowModeEnabled] = useState(false);
    const [slowModeSeconds, setSlowModeSeconds] = useState('30');
    const [requireInvite, setRequireInvite] = useState(false);
    const [disableFederation, setDisableFederation] = useState(false);
    const [initialPost, setInitialPost] = useState('');
    const [isCreating, setIsCreating] = useState(false);

    const parsedSlowModeSeconds = useMemo(() => {
        if (!slowModeEnabled) {
            return undefined;
        }
        const numericValue = Number(slowModeSeconds);
        if (!Number.isFinite(numericValue) || numericValue < 0) {
            return NaN;
        }
        return Math.floor(numericValue);
    }, [slowModeEnabled, slowModeSeconds]);

    const isSlowModeInvalid = slowModeEnabled && Number.isNaN(parsedSlowModeSeconds as number);

    if (!isOpen) return null;

    const handleCreate = async () => {
        if (!name.trim()) return;
        if (isSlowModeInvalid) {
            return;
        }
        setIsCreating(true);
        const trimmedTopic = topic.trim();
        const trimmedAlias = roomAliasName.trim();
        const trimmedInitialPost = initialPost.trim();
        const slowModeValue = slowModeEnabled ? Math.max(0, (parsedSlowModeSeconds ?? 0)) : undefined;
        const options: RoomCreationOptions = {
            name: name.trim(),
            topic: trimmedTopic || undefined,
            roomAliasName: trimmedAlias || undefined,
            isPublic,
            isEncrypted,
            mode,
            historyVisibility,
            slowModeSeconds: slowModeValue,
            requireInvite,
            disableFederation,
            initialPost: trimmedInitialPost || undefined,
        };

        try {
            await onCreate(options);
            setName('');
            setTopic('');
            setRoomAliasName('');
            setIsPublic(false);
            setIsEncrypted(true);
            setMode('chat');
            setHistoryVisibility('shared');
            setSlowModeEnabled(false);
            setSlowModeSeconds('30');
            setRequireInvite(false);
            setDisableFederation(false);
            setInitialPost('');
            onClose();
        } catch (error) {
            console.error('Failed to create room', error);
        } finally {
            setIsCreating(false);
        }
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
                    <div>
                        <label htmlFor="roomAlias" className="block text-sm font-medium text-gray-300 mb-1">
                            Room alias (optional)
                        </label>
                        <input
                            type="text"
                            id="roomAlias"
                            value={roomAliasName}
                            onChange={(e) => setRoomAliasName(e.target.value)}
                            className="appearance-none block w-full px-3 py-2 border border-gray-700 bg-gray-900 text-white placeholder-gray-500 rounded-md focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                            placeholder="my-room"
                        />
                        <p className="mt-1 text-xs text-gray-400">Only enter the local part, without the leading # or server name.</p>
                    </div>
                    <div>
                        <span className="block text-sm font-medium text-gray-300 mb-2">Mode</span>
                        <div className="grid grid-cols-2 gap-2">
                            <button
                                type="button"
                                onClick={() => setMode('chat')}
                                className={`px-3 py-2 text-sm rounded-md border ${mode === 'chat' ? 'border-indigo-400 bg-indigo-600/20 text-white' : 'border-gray-700 text-gray-300 hover:border-indigo-500'}`}
                            >
                                Chat
                            </button>
                            <button
                                type="button"
                                onClick={() => setMode('channel')}
                                className={`px-3 py-2 text-sm rounded-md border ${mode === 'channel' ? 'border-indigo-400 bg-indigo-600/20 text-white' : 'border-gray-700 text-gray-300 hover:border-indigo-500'}`}
                            >
                                Channel
                            </button>
                        </div>
                        <p className="mt-2 text-xs text-gray-400">
                            Channels are announcement-only spaces where only moderators can send messages by default.
                        </p>
                    </div>
                    <div>
                        <label htmlFor="historyVisibility" className="block text-sm font-medium text-gray-300 mb-1">
                            History visibility
                        </label>
                        <select
                            id="historyVisibility"
                            value={historyVisibility}
                            onChange={(event) => setHistoryVisibility(event.target.value as RoomHistoryVisibility)}
                            className="block w-full px-3 py-2 border border-gray-700 bg-gray-900 text-white rounded-md focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                        >
                            {historyOptions.map(option => (
                                <option key={option.value} value={option.value}>{option.label}</option>
                            ))}
                        </select>
                        <p className="mt-2 text-xs text-gray-400">
                            {historyOptions.find(option => option.value === historyVisibility)?.description}
                        </p>
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
                        <div className="relative flex items-start">
                            <div className="flex items-center h-5">
                                <input
                                    id="requireInvite"
                                    name="requireInvite"
                                    type="checkbox"
                                    checked={requireInvite}
                                    onChange={(e) => setRequireInvite(e.target.checked)}
                                    className="focus:ring-indigo-500 h-4 w-4 text-indigo-600 border-gray-600 rounded bg-gray-900"
                                />
                            </div>
                            <div className="ml-3 text-sm">
                                <label htmlFor="requireInvite" className="font-medium text-gray-300">Require an invite to join</label>
                                <p className="text-gray-400">Only invited members will be able to join this room.</p>
                            </div>
                        </div>
                        <div className="relative flex items-start">
                            <div className="flex items-center h-5">
                                <input
                                    id="disableFederation"
                                    name="disableFederation"
                                    type="checkbox"
                                    checked={disableFederation}
                                    onChange={(e) => setDisableFederation(e.target.checked)}
                                    className="focus:ring-indigo-500 h-4 w-4 text-indigo-600 border-gray-600 rounded bg-gray-900"
                                />
                            </div>
                            <div className="ml-3 text-sm">
                                <label htmlFor="disableFederation" className="font-medium text-gray-300">Disable federation</label>
                                <p className="text-gray-400">Prevent servers outside your homeserver from joining this room.</p>
                            </div>
                        </div>
                    </div>
                    <div className="space-y-3">
                        <div className="relative flex items-start">
                            <div className="flex items-center h-5">
                                <input
                                    id="slowMode"
                                    name="slowMode"
                                    type="checkbox"
                                    checked={slowModeEnabled}
                                    onChange={(e) => setSlowModeEnabled(e.target.checked)}
                                    className="focus:ring-indigo-500 h-4 w-4 text-indigo-600 border-gray-600 rounded bg-gray-900"
                                />
                            </div>
                            <div className="ml-3 text-sm">
                                <label htmlFor="slowMode" className="font-medium text-gray-300">Enable slow mode</label>
                                <p className="text-gray-400">Limit how frequently members can send new messages.</p>
                            </div>
                        </div>
                        {slowModeEnabled && (
                            <div className="flex items-center gap-3 pl-8">
                                <label htmlFor="slowModeSeconds" className="text-sm text-gray-300">Delay (seconds)</label>
                                <input
                                    id="slowModeSeconds"
                                    type="number"
                                    min={0}
                                    step={5}
                                    value={slowModeSeconds}
                                    onChange={(e) => setSlowModeSeconds(e.target.value)}
                                    className="w-24 px-3 py-1.5 border border-gray-700 bg-gray-900 text-white rounded-md focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 text-sm"
                                />
                                {isSlowModeInvalid && (
                                    <span className="text-xs text-red-400">Enter a valid number</span>
                                )}
                            </div>
                        )}
                    </div>
                    <div>
                        <label htmlFor="initialPost" className="block text-sm font-medium text-gray-300 mb-1">
                            Initial announcement (optional)
                        </label>
                        <textarea
                            id="initialPost"
                            value={initialPost}
                            onChange={(e) => setInitialPost(e.target.value)}
                            rows={3}
                            className="appearance-none block w-full px-3 py-2 border border-gray-700 bg-gray-900 text-white placeholder-gray-500 rounded-md focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                            placeholder="Send a welcome message right after the room is created"
                        />
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
                        disabled={!name.trim() || isCreating || isSlowModeInvalid}
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
