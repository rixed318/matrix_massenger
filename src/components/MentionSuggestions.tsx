import React, { useMemo } from 'react';
import { MatrixUser } from '../types';
import Avatar from './Avatar';

interface MentionSuggestionsProps {
    query: string;
    members: MatrixUser[];
    onSelect: (user: MatrixUser) => void;
}

const MentionSuggestions: React.FC<MentionSuggestionsProps> = ({ query, members, onSelect }) => {
    const filteredMembers = useMemo(() => {
        if (!query) return members;
        return members.filter(member =>
            member.displayName?.toLowerCase().includes(query.toLowerCase())
        ).slice(0, 5); // Limit to 5 suggestions
    }, [query, members]);

    if (filteredMembers.length === 0) {
        return null;
    }

    return (
        <div className="absolute bottom-full left-0 right-0 mb-2 bg-gray-800 border border-gray-700 rounded-lg shadow-lg z-20 max-h-60 overflow-y-auto">
            <ul>
                {filteredMembers.map(member => (
                    <li key={member.userId}>
                        <button
                            onClick={() => onSelect(member)}
                            className="w-full text-left flex items-center p-2 hover:bg-gray-700"
                        >
                            <Avatar name={member.displayName || member.userId} imageUrl={member.avatarUrl!} size="sm" />
                            <div className="ml-3">
                                <p className="font-semibold text-sm">{member.displayName}</p>
                                <p className="text-xs text-gray-400">{member.userId}</p>
                            </div>
                        </button>
                    </li>
                ))}
            </ul>
        </div>
    );
};

export default MentionSuggestions;