export type AnimatedReactionTrigger = 'increment' | 'self';

export interface AnimatedReactionMatch {
    emojis?: string[];
    regex?: string;
    triggers?: AnimatedReactionTrigger[];
}

export type SerializableKeyframe = {
    offset?: number;
    easing?: string;
    [property: string]: string | number | undefined;
};

export interface AnimatedReactionDefinition {
    id: string;
    match?: AnimatedReactionMatch;
    keyframes?: SerializableKeyframe[];
    options?: {
        duration?: number;
        easing?: string;
        fill?: 'none' | 'forwards' | 'backwards' | 'both' | 'auto';
        direction?: 'normal' | 'reverse' | 'alternate' | 'alternate-reverse';
        iterations?: number;
        delay?: number;
    };
    cssClass?: string;
}

export interface ConfigureAnimatedReactionsPayload {
    definitions?: AnimatedReactionDefinition[];
    append?: boolean;
    clear?: boolean;
}
