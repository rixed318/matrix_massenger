import { createStore } from 'zustand/vanilla';
import { useStore } from 'zustand';
import type { MatrixClient } from '../types';
import {
    Story,
    StorySyncState,
    bindStoryAccountData,
    unbindStoryAccountData,
    loadStoriesFromAccountData,
    subscribeToStoryUpdates,
    markStoryAsRead as markStoryAsReadService,
    toggleStoryReaction as toggleStoryReactionService,
} from '../services/matrixService';

interface AccountStoryState {
    stories: Story[];
    reads: StorySyncState['reads'];
    isHydrated: boolean;
    lastUpdated: number;
}

export interface StoryStoreState {
    accounts: Record<string, AccountStoryState>;
    activeKey: string | null;
    stories: Story[];
    isHydrated: boolean;
    hydrateAccount: (key: string, client: MatrixClient) => Promise<void>;
    removeAccount: (key: string) => void;
    setActiveKey: (key: string | null) => void;
    markStoryAsRead: (storyId: string) => Promise<void>;
    toggleStoryReaction: (storyId: string, emoji: string) => Promise<void>;
    refreshActiveStories: () => Promise<void>;
}

const storySubscriptions = new Map<string, () => void>();
const clientRegistry = new Map<string, MatrixClient>();

const buildAccountState = (snapshot: StorySyncState): AccountStoryState => ({
    stories: snapshot.stories,
    reads: snapshot.reads,
    isHydrated: true,
    lastUpdated: Date.now(),
});

export const storyStore = createStore<StoryStoreState>((set, get) => ({
    accounts: {},
    activeKey: null,
    stories: [],
    isHydrated: false,
    hydrateAccount: async (key, client) => {
        clientRegistry.set(key, client);
        try {
            bindStoryAccountData(client);
        } catch (error) {
            console.warn('bindStoryAccountData failed for account', key, error);
        }
        let initial: StorySyncState | null = null;
        try {
            initial = loadStoriesFromAccountData(client);
        } catch (error) {
            console.warn('Failed to load stories for account', key, error);
            initial = { stories: [], reads: {} };
        }
        set(state => {
            const accounts = {
                ...state.accounts,
                [key]: buildAccountState(initial!),
            };
            const patch: Partial<StoryStoreState> = { accounts };
            if (state.activeKey === key) {
                patch.stories = initial!.stories;
                patch.isHydrated = true;
            }
            return { ...state, ...patch };
        });
        const unsubscribe = subscribeToStoryUpdates(client, snapshot => {
            set(current => {
                const accounts = {
                    ...current.accounts,
                    [key]: buildAccountState(snapshot),
                };
                const patch: Partial<StoryStoreState> = { accounts };
                if (current.activeKey === key) {
                    patch.stories = snapshot.stories;
                    patch.isHydrated = true;
                }
                return { ...current, ...patch };
            });
        });
        const existing = storySubscriptions.get(key);
        existing?.();
        storySubscriptions.set(key, unsubscribe);
    },
    removeAccount: (key) => {
        const unsubscribe = storySubscriptions.get(key);
        if (unsubscribe) {
            try { unsubscribe(); } catch (error) { console.warn('story unsubscribe failed', error); }
            storySubscriptions.delete(key);
        }
        const client = clientRegistry.get(key);
        if (client) {
            try { unbindStoryAccountData(client); } catch (error) { console.warn('unbindStoryAccountData failed', error); }
            clientRegistry.delete(key);
        }
        set(state => {
            const { [key]: _removed, ...rest } = state.accounts;
            const patch: Partial<StoryStoreState> = { accounts: rest };
            if (state.activeKey === key) {
                patch.activeKey = null;
                patch.stories = [];
                patch.isHydrated = false;
            }
            return { ...state, ...patch };
        });
    },
    setActiveKey: (key) => {
        set(state => {
            if (state.activeKey === key) {
                return state;
            }
            const account = key ? state.accounts[key] : undefined;
            return {
                ...state,
                activeKey: key,
                stories: account?.stories ?? [],
                isHydrated: Boolean(account?.isHydrated),
            };
        });
    },
    markStoryAsRead: async (storyId) => {
        if (!storyId) {
            return;
        }
        const key = get().activeKey;
        if (!key) {
            return;
        }
        const client = clientRegistry.get(key);
        if (!client) {
            return;
        }
        try {
            await markStoryAsReadService(client, storyId);
        } catch (error) {
            console.warn('markStoryAsRead failed', error);
        }
    },
    toggleStoryReaction: async (storyId, emoji) => {
        if (!storyId || !emoji) {
            return;
        }
        const key = get().activeKey;
        if (!key) {
            return;
        }
        const client = clientRegistry.get(key);
        if (!client) {
            return;
        }
        try {
            await toggleStoryReactionService(client, storyId, emoji);
        } catch (error) {
            console.warn('toggleStoryReaction failed', error);
        }
    },
    refreshActiveStories: async () => {
        const key = get().activeKey;
        if (!key) {
            return;
        }
        const client = clientRegistry.get(key);
        if (!client) {
            return;
        }
        try {
            const snapshot = loadStoriesFromAccountData(client);
            set(state => {
                const accounts = {
                    ...state.accounts,
                    [key]: buildAccountState(snapshot),
                };
                const patch: Partial<StoryStoreState> = { accounts };
                if (state.activeKey === key) {
                    patch.stories = snapshot.stories;
                    patch.isHydrated = true;
                }
                return { ...state, ...patch };
            });
        } catch (error) {
            console.warn('Failed to refresh stories for account', key, error);
        }
    },
}));

export const useStoryStore = <T,>(selector: (state: StoryStoreState) => T): T => useStore(storyStore, selector);

export const attachStoriesToAccount = async (key: string, client: MatrixClient): Promise<void> => {
    await storyStore.getState().hydrateAccount(key, client);
};

export const detachStoriesFromAccount = (key: string): void => {
    storyStore.getState().removeAccount(key);
};

export const setActiveStoryAccount = (key: string | null): void => {
    storyStore.getState().setActiveKey(key);
};

export const markActiveStoryAsRead = async (storyId: string): Promise<void> => {
    await storyStore.getState().markStoryAsRead(storyId);
};

export const toggleActiveStoryReaction = async (storyId: string, emoji: string): Promise<void> => {
    await storyStore.getState().toggleStoryReaction(storyId, emoji);
};

export const refreshActiveStoryFeed = async (): Promise<void> => {
    await storyStore.getState().refreshActiveStories();
};
