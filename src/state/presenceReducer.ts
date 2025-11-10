export interface PresenceEventContent {
    presence?: string;
    status_msg?: string;
    currently_active?: boolean;
    last_active_ago?: number;
    last_active_ts?: number;
    avatar_url?: string;
    displayname?: string;
    user_id?: string;
    [key: string]: unknown;
}

export type PresenceMap = Map<string, PresenceEventContent>;

export type PresenceAction =
    | { type: 'replace'; userId: string; content: PresenceEventContent }
    | { type: 'bulk'; updates: Array<{ userId: string; content: PresenceEventContent }> }
    | { type: 'remove'; userId: string }
    | { type: 'clear' };

const mergePresence = (
    existing: PresenceEventContent | undefined,
    incoming: PresenceEventContent,
): PresenceEventContent => {
    if (!existing) {
        return { ...incoming };
    }

    return {
        ...existing,
        ...incoming,
    };
};

export const presenceReducer = (state: PresenceMap, action: PresenceAction): PresenceMap => {
    switch (action.type) {
        case 'replace': {
            const next = new Map(state);
            next.set(action.userId, mergePresence(state.get(action.userId), action.content));
            return next;
        }
        case 'bulk': {
            if (action.updates.length === 0) return state;
            const next = new Map(state);
            for (const update of action.updates) {
                next.set(update.userId, mergePresence(state.get(update.userId), update.content));
            }
            return next;
        }
        case 'remove': {
            if (!state.has(action.userId)) return state;
            const next = new Map(state);
            next.delete(action.userId);
            return next;
        }
        case 'clear': {
            if (state.size === 0) return state;
            return new Map();
        }
        default:
            return state;
    }
};

export const buildPresenceMap = (
    updates: Array<{ userId: string; content: PresenceEventContent }>,
): PresenceMap => {
    const map: PresenceMap = new Map();
    for (const update of updates) {
        map.set(update.userId, { ...update.content });
    }
    return map;
};
