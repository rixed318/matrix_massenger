import React, { useRef, useEffect } from 'react';

const EMOJIS = ['👍', '👎', '😄', '🎉', '😕', '❤️', '🚀'];

interface ReactionPickerProps {
    onSelect: (emoji: string) => void;
    onClose: () => void;
}

const ReactionPicker: React.FC<ReactionPickerProps> = ({ onSelect, onClose }) => {
    const pickerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (pickerRef.current && !pickerRef.current.contains(event.target as Node)) {
                onClose();
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, [onClose]);

    return (
        <div ref={pickerRef} className="absolute bottom-full mb-1 flex items-center gap-1 bg-bg-secondary border border-border-primary p-1 rounded-full shadow-lg">
            {EMOJIS.map(emoji => (
                <button
                    key={emoji}
                    onClick={() => onSelect(emoji)}
                    className="text-2xl p-1 rounded-full hover:bg-bg-tertiary transition-transform transform hover:scale-125"
                    aria-label={`React with ${emoji}`}
                >
                    {emoji}
                </button>
            ))}
        </div>
    );
};

export default ReactionPicker;