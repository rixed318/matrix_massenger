
import React from 'react';

interface AvatarProps {
    name: string;
    imageUrl: string | null;
    size?: 'sm' | 'md';
}

const Avatar: React.FC<AvatarProps> = ({ name, imageUrl, size = 'md' }) => {
    const getInitials = (name: string) => {
        if (!name) return '?';
        const words = name.split(' ');
        if (words.length > 1) {
            return (words[0][0] + words[1][0]).toUpperCase();
        }
        return name.substring(0, 2).toUpperCase();
    };

    const sizeClasses = size === 'sm' ? 'h-10 w-10 text-sm' : 'h-12 w-12 text-lg';
    
    // A simple hash function to get a color from a string
    const stringToColor = (str: string) => {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            hash = str.charCodeAt(i) + ((hash << 5) - hash);
        }
        let color = '#';
        for (let i = 0; i < 3; i++) {
            const value = (hash >> (i * 8)) & 0xFF;
            color += ('00' + value.toString(16)).substr(-2);
        }
        return color;
    }

    if (imageUrl) {
        return <img src={imageUrl} alt={name} className={`${sizeClasses} rounded-full object-cover flex-shrink-0`} />;
    }

    return (
        <div 
            className={`${sizeClasses} rounded-full flex items-center justify-center font-bold text-white flex-shrink-0`}
            style={{ backgroundColor: stringToColor(name || '?') }}
        >
            {getInitials(name)}
        </div>
    );
};

export default Avatar;
