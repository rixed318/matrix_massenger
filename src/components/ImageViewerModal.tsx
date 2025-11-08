import React, { useEffect } from 'react';

interface ImageViewerModalProps {
    imageUrl: string;
    onClose: () => void;
}

const ImageViewerModal: React.FC<ImageViewerModalProps> = ({ imageUrl, onClose }) => {
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                onClose();
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => {
            window.removeEventListener('keydown', handleKeyDown);
        };
    }, [onClose]);

    return (
        <div 
            className="fixed inset-0 bg-bg-secondary/80 flex items-center justify-center z-50 p-4 animate-fade-in"
            onClick={onClose}
        >
            <div className="relative max-w-full max-h-full" onClick={e => e.stopPropagation()}>
                <img 
                    src={imageUrl} 
                    alt="Full size view" 
                    className="max-w-full max-h-[90vh] object-contain"
                />
            </div>
             <button
                onClick={onClose}
                className="absolute top-4 right-4 text-text-primary text-4xl hover:text-text-secondary"
                aria-label="Close image viewer"
            >
                &times;
            </button>
        </div>
    );
};

// Add fade-in animation to tailwind config or a global css file if you have one.
// For now, let's add it directly to index.css
const style = document.createElement('style');
style.innerHTML = `
    @keyframes fadeIn {
        from { opacity: 0; }
        to { opacity: 1; }
    }
    .animate-fade-in {
        animation: fadeIn 0.2s ease-in-out;
    }
`;
document.head.appendChild(style);


export default ImageViewerModal;