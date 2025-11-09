import { MatrixClient, MatrixEvent } from '../types';
import { SearchOrderBy, SearchKey } from 'matrix-js-sdk';
import {
    searchLocalMessages as searchLocalIndex,
    type LocalSearchQuery,
    type IndexedMessageMetadata,
} from './mediaIndexService';

export interface SearchMessagesOptions {
    searchTerm: string;
    roomId?: string;
    limit?: number;
    nextBatch?: string;
    beforeLimit?: number;
    afterLimit?: number;
    keys?: SearchKey[];
    senders?: string[];
    messageTypes?: string[];
    dateRange?: SearchDateRange;
    hasMedia?: boolean;
}

export interface SearchDateRange {
    from?: string | number | Date;
    to?: string | number | Date;
}

export interface SearchResultContext {
    before: MatrixEvent[];
    after: MatrixEvent[];
}

export interface SearchResultItem {
    event: MatrixEvent;
    roomId: string;
    rank: number;
    context: SearchResultContext;
    highlights: string[];
}

export interface SearchMessagesResponse {
    count: number;
    highlights: string[];
    nextBatch?: string;
    results: SearchResultItem[];
}

interface RawSearchResult {
    rank: number;
    result: { room_id: string };
    context?: {
        events_before?: any[];
        events_after?: any[];
    };
    highlight?: string[];
}

const normalizeDateToTimestamp = (value?: string | number | Date): number | undefined => {
    if (value === undefined || value === null) return undefined;
    if (typeof value === 'number') return value;
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? undefined : value.getTime();

    const timestamp = Date.parse(value);
    return Number.isNaN(timestamp) ? undefined : timestamp;
};

const mapEvents = (mapper: ReturnType<MatrixClient['getEventMapper']>, events?: any[]): MatrixEvent[] => {
    if (!events) return [];
    return events.map(event => mapper(event)).filter((event): event is MatrixEvent => Boolean(event));
};

export const searchMessages = async (
    client: MatrixClient,
    {
        searchTerm,
        roomId,
        limit = 20,
        nextBatch,
        beforeLimit = 1,
        afterLimit = 1,
        keys = ['content.body'] as SearchKey[],
        senders,
        messageTypes,
        dateRange,
        hasMedia,
    }: SearchMessagesOptions,
): Promise<SearchMessagesResponse> => {
    const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
    const shouldUseLocalOnly = searchTerm?.startsWith('smart:');
    const localQuery = buildLocalQuery({
        searchTerm,
        roomId,
        limit,
        senders,
        dateRange,
        hasMedia,
        messageTypes,
    });
    if (offline || shouldUseLocalOnly) {
        return runLocalFallback(client, localQuery, searchTerm);
    }

    const effectiveKeys = keys.length > 0 ? keys : (['content.body'] as SearchKey[]);
    const filter: Record<string, unknown> = {
        limit,
    };

    if (roomId) {
        filter.rooms = [roomId];
    }

    if (Array.isArray(senders) && senders.length > 0) {
        filter.senders = senders;
    }

    if (Array.isArray(messageTypes) && messageTypes.length > 0) {
        filter.types = messageTypes;
    }

    if (hasMedia) {
        filter.contains_url = true;
    }

    if (dateRange) {
        const range: Record<string, number> = {};
        const fromTs = normalizeDateToTimestamp(dateRange.from);
        const toTs = normalizeDateToTimestamp(dateRange.to);

        if (typeof fromTs === 'number') {
            range.from = fromTs;
        }

        if (typeof toTs === 'number') {
            range.to = toTs;
        }

        if (Object.keys(range).length > 0) {
            filter.range = range;
        }
    }

    const body = {
        search_categories: {
            room_events: {
                search_term: searchTerm,
                order_by: SearchOrderBy.Recent,
                event_context: {
                    before_limit: beforeLimit,
                    after_limit: afterLimit,
                    include_profile: true,
                },
                include_state: false,
                keys: effectiveKeys,
                filter,
            },
        },
    };

    try {
        const response = await client.search({ body, next_batch: nextBatch });
    const roomEvents = response.search_categories.room_events;
    const eventMapper = client.getEventMapper();

    const results = (roomEvents.results || []).map((raw: RawSearchResult) => {
        const event = eventMapper(raw.result) as MatrixEvent;
        const before = mapEvents(eventMapper, raw.context?.events_before);
        const after = mapEvents(eventMapper, raw.context?.events_after);
        const highlights = Array.isArray(raw.highlight) ? raw.highlight : [];

        return {
            event,
            roomId: raw.result.room_id,
            rank: raw.rank,
            context: { before, after },
            highlights,
        } as SearchResultItem;
    });

    const categoryHighlights = roomEvents.highlights || [];
    const combinedHighlights = Array.from(
        new Set([
            ...categoryHighlights,
            ...results.flatMap(result => result.highlights || []),
        ].filter(Boolean)),
    );

    return {
        count: roomEvents.count || 0,
        highlights: combinedHighlights,
        nextBatch: roomEvents.next_batch,
        results,
    };
    } catch (error) {
        console.warn('Falling back to local search index', error);
        return runLocalFallback(client, localQuery, searchTerm);
    }
};

interface BuildLocalQueryOptions extends Pick<SearchMessagesOptions, 'searchTerm' | 'roomId' | 'limit' | 'senders' | 'dateRange' | 'hasMedia' | 'messageTypes'> {}

const mediaTypeMap: Record<string, string> = {
    'm.image': 'image',
    'm.video': 'video',
    'm.file': 'file',
    'm.audio': 'file',
    'm.text': 'link',
};

const buildLocalQuery = ({ searchTerm, roomId, limit, senders, dateRange, hasMedia, messageTypes }: BuildLocalQueryOptions): LocalSearchQuery => {
    const query: LocalSearchQuery = {
        term: searchTerm,
        roomId,
        limit,
        senders,
        hasMedia,
    };
    if (dateRange) {
        const fromTs = normalizeDateToTimestamp(dateRange.from);
        const toTs = normalizeDateToTimestamp(dateRange.to);
        query.fromTs = fromTs;
        query.toTs = toTs;
    }
    if (Array.isArray(messageTypes) && messageTypes.length) {
        const mapped = messageTypes
            .map(type => mediaTypeMap[type])
            .filter((type): type is string => Boolean(type));
        if (mapped.length) {
            query.mediaTypes = Array.from(new Set(mapped));
            query.hasMedia = true;
        }
    }
    return query;
};

const runLocalFallback = async (
    client: MatrixClient,
    query: LocalSearchQuery,
    searchTerm: string,
): Promise<SearchMessagesResponse> => {
    const hits = await searchLocalIndex(query, client.getUserId?.());
    const results = hits
        .map(hit => mapLocalHit(client, hit, searchTerm))
        .filter((result): result is SearchResultItem => Boolean(result));
    const highlightSet = new Set<string>();
    results.forEach(result => result.highlights.forEach(item => highlightSet.add(item)));
    return {
        count: results.length,
        highlights: Array.from(highlightSet),
        results,
    };
};

const mapLocalHit = (
    client: MatrixClient,
    hit: IndexedMessageMetadata,
    term: string,
): SearchResultItem | null => {
    const room = client.getRoom?.(hit.roomId);
    const event = room?.findEventById?.(hit.eventId);
    if (!event) return null;
    const highlights = buildHighlights(hit, term);
    return {
        event,
        roomId: hit.roomId,
        rank: hit.timestamp,
        context: { before: [], after: [] },
        highlights,
    };
};

const buildHighlights = (hit: IndexedMessageMetadata, term: string): string[] => {
    const tokens = new Set<string>();
    if (term?.startsWith('smart:')) {
        if (term === 'smart:important') {
            hit.tags.forEach(tag => tokens.add(tag));
            hit.reactions.forEach(reaction => tokens.add(reaction));
        }
        if (term === 'smart:mentions') {
            hit.tokens.filter(token => token.startsWith('@')).forEach(token => tokens.add(token));
        }
    } else if (term && term.trim()) {
        tokens.add(term.trim());
    }
    return Array.from(tokens);
};
