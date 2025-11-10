import { AnimatedReactionDefinition, AnimatedReactionTrigger, ConfigureAnimatedReactionsPayload } from '../types/animatedReactions';

const PREFERENCE_STORAGE_KEY = 'matrix-animated-reactions';

type PreferenceListener = (enabled: boolean) => void;

const preferenceListeners = new Set<PreferenceListener>();

const readStoredPreference = (): boolean => {
    if (typeof window === 'undefined') {
        return true;
    }
    try {
        const raw = window.localStorage.getItem(PREFERENCE_STORAGE_KEY);
        if (raw === null) {
            return true;
        }
        return raw === '1' || raw === 'true';
    } catch (_) {
        return true;
    }
};

let animatedReactionsEnabled = readStoredPreference();

const notifyPreferenceListeners = () => {
    for (const listener of preferenceListeners) {
        try {
            listener(animatedReactionsEnabled);
        } catch (error) {
            console.warn('Animated reactions listener failed', error);
        }
    }
};

export const isAnimatedReactionsEnabled = (): boolean => animatedReactionsEnabled;

export const setAnimatedReactionsEnabled = (enabled: boolean): void => {
    animatedReactionsEnabled = Boolean(enabled);
    if (typeof window !== 'undefined') {
        try {
            window.localStorage.setItem(PREFERENCE_STORAGE_KEY, animatedReactionsEnabled ? '1' : '0');
        } catch (_) {
            /* ignore */
        }
    }
    notifyPreferenceListeners();
};

export const onAnimatedReactionsPreferenceChange = (listener: PreferenceListener): (() => void) => {
    preferenceListeners.add(listener);
    try {
        listener(animatedReactionsEnabled);
    } catch (error) {
        console.warn('Animated reactions listener failed', error);
    }
    return () => {
        preferenceListeners.delete(listener);
    };
};

const builtinDefinitions: AnimatedReactionDefinition[] = [
    {
        id: 'builtin.pop',
        keyframes: [
            { transform: 'scale(1)', offset: 0 },
            { transform: 'scale(1.2)', offset: 0.35 },
            { transform: 'scale(0.94)', offset: 0.65 },
            { transform: 'scale(1)', offset: 1 },
        ],
        options: { duration: 320, easing: 'ease-out', fill: 'forwards' },
    },
];

const pluginDefinitions = new Map<string, AnimatedReactionDefinition[]>();

type SerializableKeyframe = NonNullable<AnimatedReactionDefinition['keyframes']>[number];

const sanitizeKeyframe = (frame: SerializableKeyframe): Keyframe => {
    const { offset, easing, ...rest } = frame ?? {};
    const payload: Keyframe = { ...rest } as Keyframe;
    if (typeof offset === 'number') {
        payload.offset = offset;
    }
    if (typeof easing === 'string') {
        payload.easing = easing;
    }
    return payload;
};

const normalizeDefinition = (definition: AnimatedReactionDefinition): AnimatedReactionDefinition | null => {
    if (!definition || typeof definition !== 'object') {
        return null;
    }
    const id = typeof definition.id === 'string' && definition.id.trim().length > 0
        ? definition.id.trim()
        : `animation:${Math.random().toString(36).slice(2)}`;
    const normalized: AnimatedReactionDefinition = { id };
    if (definition.match) {
        const emojis = Array.isArray(definition.match.emojis)
            ? definition.match.emojis.filter((emoji): emoji is string => typeof emoji === 'string' && emoji.length > 0)
            : undefined;
        const regex = typeof definition.match.regex === 'string' && definition.match.regex.length > 0
            ? definition.match.regex
            : undefined;
        const triggers = Array.isArray(definition.match.triggers)
            ? definition.match.triggers.filter((trigger): trigger is AnimatedReactionTrigger => trigger === 'increment' || trigger === 'self')
            : undefined;
        normalized.match = {};
        if (emojis && emojis.length > 0) {
            normalized.match.emojis = Array.from(new Set(emojis));
        }
        if (regex) {
            normalized.match.regex = regex;
        }
        if (triggers && triggers.length > 0) {
            normalized.match.triggers = Array.from(new Set(triggers));
        }
        if (!normalized.match.emojis && !normalized.match.regex && !normalized.match.triggers) {
            delete normalized.match;
        }
    }
    if (Array.isArray(definition.keyframes) && definition.keyframes.length > 0) {
        normalized.keyframes = definition.keyframes
            .map(frame => sanitizeKeyframe(frame))
            .filter(frame => Object.keys(frame).length > 0);
    }
    if (definition.options) {
        normalized.options = {
            duration: typeof definition.options.duration === 'number' ? definition.options.duration : undefined,
            easing: typeof definition.options.easing === 'string' ? definition.options.easing : undefined,
            fill: definition.options.fill,
            direction: definition.options.direction,
            iterations: typeof definition.options.iterations === 'number' ? definition.options.iterations : undefined,
            delay: typeof definition.options.delay === 'number' ? definition.options.delay : undefined,
        };
    }
    if (typeof definition.cssClass === 'string' && definition.cssClass.trim().length > 0) {
        normalized.cssClass = definition.cssClass.trim();
    }
    if (!normalized.keyframes && !normalized.cssClass) {
        return null;
    }
    return normalized;
};

const matchesDefinition = (
    definition: AnimatedReactionDefinition,
    emoji: string,
    trigger: AnimatedReactionTrigger,
): boolean => {
    if (!definition.match) {
        return true;
    }
    if (definition.match.triggers && definition.match.triggers.length > 0 && !definition.match.triggers.includes(trigger)) {
        return false;
    }
    if (definition.match.emojis && definition.match.emojis.length > 0) {
        if (definition.match.emojis.includes(emoji)) {
            return true;
        }
    }
    if (definition.match.regex) {
        try {
            const re = new RegExp(definition.match.regex, 'u');
            if (re.test(emoji)) {
                return true;
            }
        } catch (error) {
            console.warn('Invalid animated reaction regex', definition.match.regex, error);
        }
    }
    return !definition.match.emojis;
};

const getAllDefinitions = (): AnimatedReactionDefinition[] => {
    const pluginEntries: AnimatedReactionDefinition[] = [];
    for (const defs of pluginDefinitions.values()) {
        pluginEntries.push(...defs);
    }
    return [...builtinDefinitions, ...pluginEntries];
};

const applyCssClassAnimation = (element: HTMLElement, cssClass: string, duration?: number) => {
    element.classList.add(cssClass);
    const timeout = typeof duration === 'number' && duration > 0 ? duration : 400;
    setTimeout(() => {
        element.classList.remove(cssClass);
    }, timeout);
};

const runKeyframeAnimation = (element: HTMLElement, definition: AnimatedReactionDefinition) => {
    if (!definition.keyframes || definition.keyframes.length === 0) {
        return;
    }
    if (typeof element.animate === 'function') {
        try {
            element.animate(definition.keyframes.map(frame => sanitizeKeyframe(frame)), {
                duration: definition.options?.duration ?? 320,
                easing: definition.options?.easing,
                fill: definition.options?.fill ?? 'forwards',
                direction: definition.options?.direction,
                iterations: definition.options?.iterations ?? 1,
                delay: definition.options?.delay ?? 0,
            });
        } catch (error) {
            console.warn('Failed to run animated reaction', error);
        }
    } else {
        element.classList.add('animate-bounce');
        setTimeout(() => element.classList.remove('animate-bounce'), 400);
    }
};

export const triggerReactionAnimation = (
    element: HTMLElement | null,
    emoji: string,
    trigger: AnimatedReactionTrigger,
): void => {
    if (!animatedReactionsEnabled || !element) {
        return;
    }
    const definitions = getAllDefinitions().filter(definition => matchesDefinition(definition, emoji, trigger));
    for (const definition of definitions) {
        if (definition.keyframes && definition.keyframes.length > 0) {
            runKeyframeAnimation(element, definition);
        }
        if (definition.cssClass) {
            applyCssClassAnimation(element, definition.cssClass, definition.options?.duration);
        }
    }
};

export const configurePluginAnimatedReactions = (
    pluginId: string,
    payload: ConfigureAnimatedReactionsPayload | null | undefined,
): { count: number } => {
    if (!pluginId) {
        return { count: 0 };
    }
    if (!payload || payload.clear) {
        pluginDefinitions.delete(pluginId);
        return { count: 0 };
    }
    const definitions = Array.isArray(payload.definitions)
        ? payload.definitions
            .map(item => normalizeDefinition(item))
            .filter((item): item is AnimatedReactionDefinition => Boolean(item))
        : [];
    if (payload.append && pluginDefinitions.has(pluginId)) {
        const existing = pluginDefinitions.get(pluginId) ?? [];
        pluginDefinitions.set(pluginId, [...existing, ...definitions]);
    } else {
        pluginDefinitions.set(pluginId, definitions);
    }
    return { count: pluginDefinitions.get(pluginId)?.length ?? 0 };
};

export const clearPluginAnimatedReactions = (pluginId: string): void => {
    pluginDefinitions.delete(pluginId);
};
