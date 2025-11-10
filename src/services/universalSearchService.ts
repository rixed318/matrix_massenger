import { searchMessages, type SearchMessagesOptions, type SearchResultItem } from './searchService';
import { getAccountStore } from './accountManager';

export interface UniversalSearchResultItem extends SearchResultItem {
    accountKey: string;
    accountUserId: string;
    accountDisplayName: string;
    accountAvatarUrl?: string | null;
    homeserverName: string;
}

export interface UniversalAccountCursor {
    nextBatch?: string;
    remaining: UniversalSearchResultItem[];
}

export interface UniversalSearchCursor {
    accounts: Record<string, UniversalAccountCursor>;
}

export interface UniversalSearchOptions extends Omit<SearchMessagesOptions, 'nextBatch' | 'limit'> {
    /**
     * Maximum number of results to return across all accounts.
     * Defaults to the same value as the single-account search (20).
     */
    limit?: number;
    /**
     * Optional cursor returned from the previous universal search request.
     */
    cursor?: UniversalSearchCursor | null;
    /**
     * Restrict the search to the provided account keys.
     */
    includedAccountKeys?: string[];
}

export interface UniversalSearchResponse {
    results: UniversalSearchResultItem[];
    highlights: string[];
    cursor?: UniversalSearchCursor | null;
}

const deriveHomeserverName = (userId: string, homeserverUrl: string): string => {
    const [, domain] = userId.split(':');
    if (domain) {
        return domain;
    }

    try {
        const url = new URL(homeserverUrl);
        return url.hostname;
    } catch {
        return homeserverUrl.replace(/^https?:\/\//, '').replace(/\/+$/, '');
    }
};

const toUniversalItem = (
    item: SearchResultItem,
    accountKey: string,
    accountRuntime: {
        userId: string;
        displayName?: string | null;
        avatarUrl?: string | null;
        homeserverUrl: string;
    },
): UniversalSearchResultItem => ({
    ...item,
    accountKey,
    accountUserId: accountRuntime.userId,
    accountDisplayName: accountRuntime.displayName ?? accountRuntime.userId,
    accountAvatarUrl: accountRuntime.avatarUrl ?? null,
    homeserverName: deriveHomeserverName(accountRuntime.userId, accountRuntime.homeserverUrl),
});

const getSortValue = (item: UniversalSearchResultItem): number => {
    const ts = item.event.getTs?.();
    if (typeof ts === 'number' && Number.isFinite(ts)) {
        return ts;
    }
    return typeof item.rank === 'number' ? item.rank : 0;
};

const shouldIncludeAccount = (accountKey: string, allowed?: string[]): boolean => {
    if (!allowed || allowed.length === 0) return true;
    return allowed.includes(accountKey);
};

export const searchUniversalMessages = async ({
    cursor,
    includedAccountKeys,
    limit = 20,
    ...options
}: UniversalSearchOptions): Promise<UniversalSearchResponse> => {
    const accountStore = getAccountStore();
    const { accounts } = accountStore.getState();
    const accountEntries = Object.entries(accounts).filter(([key]) => shouldIncludeAccount(key, includedAccountKeys));

    if (accountEntries.length === 0) {
        return { results: [], highlights: [], cursor: null };
    }

    const perAccountState: Record<string, { available: UniversalSearchResultItem[]; nextBatch?: string }> = {};

    for (const [accountKey, runtime] of accountEntries) {
        const accountCursor = cursor?.accounts?.[accountKey];
        let available = accountCursor ? [...accountCursor.remaining] : [];
        let nextBatchToken = accountCursor?.nextBatch;

        const needsInitialFetch = !accountCursor;
        const needsMoreResults = available.length < limit && Boolean(nextBatchToken);

        if (needsInitialFetch || needsMoreResults) {
            const response = await searchMessages(runtime.client, {
                ...options,
                limit,
                nextBatch: needsInitialFetch ? undefined : nextBatchToken,
            });

            const decorated = response.results.map(result =>
                toUniversalItem(result, accountKey, {
                    userId: runtime.creds.user_id,
                    displayName: runtime.displayName,
                    avatarUrl: runtime.avatarUrl,
                    homeserverUrl: runtime.creds.homeserver_url,
                }),
            );

            available = [...available, ...decorated];
            nextBatchToken = response.nextBatch;
        }

        perAccountState[accountKey] = {
            available,
            nextBatch: nextBatchToken,
        };
    }

    const allResults = accountEntries.flatMap(([accountKey]) => perAccountState[accountKey].available.map(item => ({ accountKey, item })));

    allResults.sort((a, b) => getSortValue(b.item) - getSortValue(a.item));

    const taken = allResults.slice(0, limit);
    const consumedCounts = new Map<string, number>();
    const highlights = new Set<string>();

    taken.forEach(({ accountKey, item }) => {
        consumedCounts.set(accountKey, (consumedCounts.get(accountKey) ?? 0) + 1);
        item.highlights?.forEach(highlight => highlights.add(highlight));
    });

    const nextCursorAccounts: Record<string, UniversalAccountCursor> = {};

    for (const [accountKey] of accountEntries) {
        const state = perAccountState[accountKey];
        const consumed = consumedCounts.get(accountKey) ?? 0;
        const remaining = state.available.slice(consumed);

        if (remaining.length > 0 || state.nextBatch) {
            nextCursorAccounts[accountKey] = {
                remaining,
                nextBatch: state.nextBatch,
            };
        }
    }

    return {
        results: taken.map(({ item }) => item),
        highlights: Array.from(highlights),
        cursor: Object.keys(nextCursorAccounts).length > 0 ? { accounts: nextCursorAccounts } : null,
    };
};

export default searchUniversalMessages;
