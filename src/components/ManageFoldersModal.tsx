import React, { useState, useEffect } from 'react';
import { Folder, Room as UIRoom } from '../types';
import Avatar from './Avatar';

interface ManageFoldersModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSave: (folders: Folder[]) => void;
    initialFolders: Folder[];
    allRooms: UIRoom[];
}

const ManageFoldersModal: React.FC<ManageFoldersModalProps> = ({ isOpen, onClose, onSave, initialFolders, allRooms }) => {
    const [folders, setFolders] = useState<Folder[]>([]);
    const [editingFolder, setEditingFolder] = useState<Folder | null>(null);
    const [newFolderName, setNewFolderName] = useState('');
    
    useEffect(() => {
        // Deep copy to avoid mutating parent state directly
        setFolders(JSON.parse(JSON.stringify(initialFolders)));
    }, [initialFolders, isOpen]);

    if (!isOpen) return null;

    const handleAddNewFolder = () => {
        if (!newFolderName.trim()) return;
        const newFolder: Folder = {
            id: `folder_${Date.now()}`,
            name: newFolderName.trim(),
            roomIds: [],
        };
        setFolders([...folders, newFolder]);
        setNewFolderName('');
    };

    const handleDeleteFolder = (folderId: string) => {
        setFolders(folders.filter(f => f.id !== folderId));
    };

    const handleSaveEdits = () => {
        if (!editingFolder) return;
        const updatedFolders = folders.map(f => f.id === editingFolder.id ? editingFolder : f);
        setFolders(updatedFolders);
        setEditingFolder(null);
    };

    const handleRoomToggle = (roomId: string) => {
        if (!editingFolder) return;
        const newRoomIds = editingFolder.roomIds.includes(roomId)
            ? editingFolder.roomIds.filter(id => id !== roomId)
            : [...editingFolder.roomIds, roomId];
        setEditingFolder({ ...editingFolder, roomIds: newRoomIds });
    };

    const renderMainView = () => (
        <>
            <div className="p-6 space-y-4 max-h-[50vh] overflow-y-auto">
                <h3 className="text-lg font-semibold">Your Folders</h3>
                <div className="space-y-2">
                    {folders.map(folder => (
                        <div key={folder.id} className="flex items-center justify-between p-2 bg-gray-900/50 rounded-md">
                            <span className="font-medium">{folder.name}</span>
                            <div className="flex items-center gap-2">
                                <button onClick={() => setEditingFolder(folder)} className="text-sm text-indigo-400 hover:underline">Edit</button>
                                <button onClick={() => handleDeleteFolder(folder.id)} className="p-1 rounded-full text-gray-400 hover:text-red-400 hover:bg-gray-700">
                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" /></svg>
                                </button>
                            </div>
                        </div>
                    ))}
                    {folders.length === 0 && <p className="text-gray-400 text-sm">You have no folders yet.</p>}
                </div>
                <div className="flex items-center gap-2 pt-4 border-t border-gray-700">
                    <input
                        type="text"
                        value={newFolderName}
                        onChange={(e) => setNewFolderName(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleAddNewFolder()}
                        placeholder="New folder name"
                        className="flex-1 appearance-none block w-full px-3 py-2 border border-gray-700 bg-gray-900 text-white placeholder-gray-500 rounded-md focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                    />
                    <button onClick={handleAddNewFolder} className="py-2 px-4 border border-transparent rounded-md text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50" disabled={!newFolderName.trim()}>Add</button>
                </div>
            </div>
            <div className="bg-gray-700/50 px-6 py-4 flex justify-end gap-3 rounded-b-lg">
                <button onClick={onClose} className="py-2 px-4 border border-gray-600 rounded-md text-sm font-medium text-gray-200 hover:bg-gray-700">Cancel</button>
                <button onClick={() => onSave(folders)} className="py-2 px-4 border border-transparent rounded-md text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700">Save Changes</button>
            </div>
        </>
    );

    const renderEditView = () => (
        <>
            <div className="p-6 space-y-4 max-h-[50vh] overflow-y-auto">
                <input
                    type="text"
                    value={editingFolder!.name}
                    onChange={(e) => setEditingFolder({ ...editingFolder!, name: e.target.value })}
                    className="appearance-none block w-full px-3 py-2 border border-gray-700 bg-gray-900 text-white placeholder-gray-500 rounded-md focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                />
                <h4 className="text-md font-semibold pt-2 border-t border-gray-700">Included Chats</h4>
                <div className="space-y-2">
                    {allRooms.map(room => (
                        <label key={room.roomId} className="flex items-center p-2 bg-gray-900/50 rounded-md cursor-pointer hover:bg-gray-900">
                            <input
                                type="checkbox"
                                checked={editingFolder!.roomIds.includes(room.roomId)}
                                onChange={() => handleRoomToggle(room.roomId)}
                                className="focus:ring-indigo-500 h-4 w-4 text-indigo-600 border-gray-600 rounded bg-gray-900"
                            />
                            <Avatar name={room.name} imageUrl={room.avatarUrl} size="sm" />
                            <span className="ml-3 text-sm font-medium">{room.name}</span>
                        </label>
                    ))}
                </div>
            </div>
            <div className="bg-gray-700/50 px-6 py-4 flex justify-end gap-3 rounded-b-lg">
                <button onClick={() => setEditingFolder(null)} className="py-2 px-4 border border-gray-600 rounded-md text-sm font-medium text-gray-200 hover:bg-gray-700">Back</button>
                <button onClick={handleSaveEdits} className="py-2 px-4 border border-transparent rounded-md text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700">Done</button>
            </div>
        </>
    );

    return (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 animate-fade-in-fast" onClick={onClose}>
            <div className="bg-gray-800 rounded-lg shadow-xl w-full max-w-md flex flex-col animate-slide-up" onClick={e => e.stopPropagation()}>
                <div className="p-6 border-b border-gray-700">
                    <h2 className="text-xl font-bold">{editingFolder ? `Editing "${editingFolder.name}"` : 'Manage Folders'}</h2>
                </div>
                {editingFolder ? renderEditView() : renderMainView()}
            </div>
        </div>
    );
};

export default ManageFoldersModal;
