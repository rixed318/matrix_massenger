import React from 'react';
import { Reaction } from '../types';

interface ReactionsDisplayProps {
    reactions: Record<string, Reaction>;
    onReaction: (emoji: string, reaction?: Reaction) => void;
}

const ReactionsDisplay: React.FC<ReactionsDisplayProps> = ({ reactions, onReaction }) => {
    return (
        <div className="flex items-center gap-1 mt-1">
            {Object.entries(reactions).map(([emoji, reactionData]) => (
                <button
                    key={emoji}
                    onClick={() => onReaction(emoji, reactionData)}
                    className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-xs transition-colors ${
                        reactionData.isOwn 
                        ? 'bg-accent/50 border border-accent text-text-inverted' 
                        : 'bg-bg-primary/80 border border-border-primary text-text-secondary hover:bg-bg-tertiary'
                    }`}
                    aria-label={`${reactionData.count} people reacted with ${emoji}`}
                >
                    <span>{emoji}</span>
                    <span className="font-semibold">{reactionData.count}</span>
                </button>
            ))}
        </div>
    );
};

export default ReactionsDisplay;