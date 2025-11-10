import { Room } from '../types';

type RoomSearchSource = 'name' | 'alias' | 'message' | 'account';

interface RoomSearchIndexToken {
  source: RoomSearchSource;
  value: string;
  weight: number;
}

export interface RoomSearchable {
  roomId: string;
  name: string;
  canonicalAlias?: string | null;
  lastMessagePreview?: string | null;
  accountBadge?: string | null;
}

export interface RoomSearchResult {
  roomId: string;
  score: number;
  source: RoomSearchSource;
}

const normalise = (value: string): string => value.trim().toLowerCase();

const createTokens = (item: RoomSearchable): RoomSearchIndexToken[] => {
  const tokens: RoomSearchIndexToken[] = [];
  const push = (source: RoomSearchSource, value?: string | null, weight = 0) => {
    if (!value) {
      return;
    }
    const normalised = normalise(value);
    if (!normalised) {
      return;
    }
    tokens.push({ source, value: normalised, weight });
  };

  push('name', item.name, 0);
  push('alias', item.canonicalAlias, 0.1);
  push('message', item.lastMessagePreview, 0.25);
  push('account', item.accountBadge, 0.2);

  return tokens;
};

const scoreToken = (token: RoomSearchIndexToken, query: string): number | null => {
  const position = token.value.indexOf(query);
  if (position === -1) {
    return null;
  }
  let score = token.weight + position / (token.value.length + 1);
  if (token.value === query) {
    score -= 0.2;
  } else if (token.value.startsWith(query)) {
    score -= 0.1;
  } else {
    const parts = token.value.split(/\s+/).filter(Boolean);
    if (parts.some(part => part.startsWith(query))) {
      score -= 0.05;
    }
  }
  return Math.max(score, 0);
};

interface RoomSearchEntry {
  item: RoomSearchable;
  tokens: RoomSearchIndexToken[];
}

export class RoomSearchIndex {
  private readonly entries: RoomSearchEntry[];

  constructor(items: RoomSearchable[]) {
    this.entries = items.map(item => ({
      item,
      tokens: createTokens(item),
    }));
  }

  search(rawQuery: string, limit = 10): RoomSearchResult[] {
    const query = normalise(rawQuery);
    if (!query) {
      return [];
    }

    const results: RoomSearchResult[] = [];

    this.entries.forEach(entry => {
      let bestScore: number | null = null;
      let bestSource: RoomSearchSource | null = null;

      entry.tokens.forEach(token => {
        const score = scoreToken(token, query);
        if (score === null) {
          return;
        }
        if (bestScore === null || score < bestScore) {
          bestScore = score;
          bestSource = token.source;
        }
      });

      if (bestScore !== null && bestSource) {
        results.push({
          roomId: entry.item.roomId,
          score: bestScore,
          source: bestSource,
        });
      }
    });

    return results
      .sort((a, b) => a.score - b.score)
      .slice(0, limit);
  }
}

export const buildSearchIndexFromRooms = (
  rooms: Room[],
  accountBadge?: string | null,
): RoomSearchIndex => {
  const items: RoomSearchable[] = rooms.map(room => ({
    roomId: room.roomId,
    name: room.name,
    canonicalAlias: room.canonicalAlias ?? undefined,
    lastMessagePreview: room.lastMessage?.content.body ?? room.lastMessage?.content.formatted_body ?? undefined,
    accountBadge: accountBadge ?? null,
  }));

  return new RoomSearchIndex(items);
};
