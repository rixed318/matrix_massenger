import React, { useCallback, useEffect, useRef } from 'react';
import { Reaction } from '@matrix-messenger/core';
import { triggerReactionAnimation } from '../services/animatedReactions';

interface ReactionsDisplayProps {
    reactions: Record<string, Reaction>;
    onReaction: (emoji: string, reaction?: Reaction) => void;
}

const ReactionsDisplay: React.FC<ReactionsDisplayProps> = ({ reactions, onReaction }) => {
    const buttonRefs = useRef<Record<string, HTMLButtonElement | null>>({});
    const previousCounts = useRef<Record<string, number>>({});

    const attachRef = useCallback((emoji: string) => (element: HTMLButtonElement | null) => {
        buttonRefs.current[emoji] = element;
    }, []);

    useEffect(() => {
        const nextCounts: Record<string, number> = {};
        Object.entries(reactions).forEach(([emoji, reactionData]) => {
            const nextCount = reactionData.count ?? 0;
            const previousCount = previousCounts.current[emoji] ?? 0;
            nextCounts[emoji] = nextCount;
            if (nextCount > previousCount) {
                const element = buttonRefs.current[emoji];
                if (element) {
                    triggerReactionAnimation(element, emoji, 'increment');
                }
            }
        });
        previousCounts.current = nextCounts;
    }, [reactions]);

    return (
        <div className="flex items-center gap-1 mt-1">
            {Object.entries(reactions).map(([emoji, reactionData]) => {
                const handleClick = () => {
                    onReaction(emoji, reactionData);
                    if (!reactionData?.isOwn) {
                        const element = buttonRefs.current[emoji];
                        if (element) {
                            triggerReactionAnimation(element, emoji, 'self');
                        }
                    }
                };

                return (
                    <button
                        key={emoji}
                        ref={attachRef(emoji)}
                        onClick={handleClick}
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
                );
            })}
        </div>
    );
};

export default ReactionsDisplay;