import React, { useState } from 'react';

interface CreatePollModalProps {
    isOpen: boolean;
    onClose: () => void;
    onCreate: (question: string, options: string[], threadRootId?: string) => void | Promise<void>;
    threadRootId?: string;
}

const CreatePollModal: React.FC<CreatePollModalProps> = ({ isOpen, onClose, onCreate, threadRootId }) => {
    const [question, setQuestion] = useState('');
    const [options, setOptions] = useState(['', '']);
    const [isCreating, setIsCreating] = useState(false);

    if (!isOpen) return null;

    const handleOptionChange = (index: number, value: string) => {
        const newOptions = [...options];
        newOptions[index] = value;
        setOptions(newOptions);
    };

    const addOption = () => {
        setOptions([...options, '']);
    };

    const removeOption = (index: number) => {
        if (options.length > 2) {
            const newOptions = options.filter((_, i) => i !== index);
            setOptions(newOptions);
        }
    };

    const handleCreate = async () => {
        const trimmedQuestion = question.trim();
        const trimmedOptions = options.map(opt => opt.trim()).filter(opt => opt !== '');

        if (!trimmedQuestion || trimmedOptions.length < 2) {
            // Basic validation
            return;
        }

        setIsCreating(true);
        try {
            await onCreate(trimmedQuestion, trimmedOptions, threadRootId);
            // Reset state for next time
            setQuestion('');
            setOptions(['', '']);
        } finally {
            setIsCreating(false);
        }
    };

    return (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 animate-fade-in-fast" onClick={onClose}>
            <div className="bg-gray-800 rounded-lg shadow-xl w-full max-w-lg animate-slide-up" onClick={e => e.stopPropagation()}>
                <div className="p-6 border-b border-gray-700">
                    <h2 className="text-xl font-bold">Create a Poll</h2>
                </div>
                <div className="p-6 space-y-6 max-h-[60vh] overflow-y-auto">
                    {threadRootId && (
                        <div className="p-3 rounded-md bg-indigo-900/30 border border-indigo-700/40 text-sm text-indigo-200">
                            This poll will be posted in the current thread.
                        </div>
                    )}
                    <div>
                        <label htmlFor="pollQuestion" className="block text-sm font-medium text-gray-300 mb-1">
                            Question <span className="text-red-400">*</span>
                        </label>
                        <input
                            type="text"
                            id="pollQuestion"
                            value={question}
                            onChange={(e) => setQuestion(e.target.value)}
                            className="appearance-none block w-full px-3 py-2 border border-gray-700 bg-gray-900 text-white placeholder-gray-500 rounded-md focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                            placeholder="e.g. What should we have for lunch?"
                        />
                    </div>
                    <div className="space-y-3">
                         <label className="block text-sm font-medium text-gray-300 mb-1">
                            Options <span className="text-red-400">*</span> (at least 2)
                        </label>
                        {options.map((option, index) => (
                            <div key={index} className="flex items-center gap-2">
                                <input
                                    type="text"
                                    value={option}
                                    onChange={(e) => handleOptionChange(index, e.target.value)}
                                    className="flex-1 appearance-none block w-full px-3 py-2 border border-gray-700 bg-gray-900 text-white placeholder-gray-500 rounded-md focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                                    placeholder={`Option ${index + 1}`}
                                />
                                {options.length > 2 && (
                                    <button onClick={() => removeOption(index)} className="p-2 text-gray-400 hover:text-red-400 rounded-full hover:bg-gray-700">
                                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                                            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM7 9a1 1 0 000 2h6a1 1 0 100-2H7z" clipRule="evenodd" />
                                        </svg>
                                    </button>
                                )}
                            </div>
                        ))}
                        <button onClick={addOption} className="text-sm text-indigo-400 hover:text-indigo-300 font-medium">
                            + Add Option
                        </button>
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
                        disabled={question.trim().length === 0 || options.filter(o => o.trim()).length < 2 || isCreating}
                        className="py-2 px-4 border border-transparent rounded-md text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 focus:ring-offset-gray-800 disabled:bg-indigo-400 disabled:cursor-not-allowed"
                    >
                        {isCreating ? 'Creating...' : 'Create Poll'}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default CreatePollModal;
