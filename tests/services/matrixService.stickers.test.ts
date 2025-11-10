import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __resetStickerLibraryForTests,
  bindStickerPackWatcher,
  getStickerLibraryState,
  registerLocalStickerPacks,
  setStickerPackEnabled,
  toggleStickerFavorite,
} from '../../src/services/matrixService';
import type { MatrixClient, MatrixEvent } from '../../src/types';

class MemoryStorage {
  private store = new Map<string, string>();
  getItem(key: string) {
    return this.store.has(key) ? this.store.get(key)! : null;
  }
  setItem(key: string, value: string) {
    this.store.set(key, value);
  }
  removeItem(key: string) {
    this.store.delete(key);
  }
  clear() {
    this.store.clear();
  }
}

describe('sticker library', () => {
  beforeEach(() => {
    (globalThis as any).localStorage = new MemoryStorage();
    __resetStickerLibraryForTests();
  });

  it('registers local sticker packs and exposes them via library state', () => {
    registerLocalStickerPacks([
      {
        id: 'local.test-pack',
        name: 'Test Pack',
        description: 'Example pack',
        source: 'local',
        stickers: [
          { id: 's1', body: 'Wave', url: 'https://example.org/wave.svg', info: { mimetype: 'image/svg+xml' } },
        ],
      },
    ]);

    const state = getStickerLibraryState();
    const pack = state.packs.find(p => p.id === 'local.test-pack');
    expect(pack).toBeTruthy();
    expect(pack?.stickers).toHaveLength(1);
    expect(state.enabledPackIds).toContain('local.test-pack');
  });

  it('toggles pack availability and favorites', () => {
    registerLocalStickerPacks([
      {
        id: 'local.toggle-pack',
        name: 'Toggle Pack',
        source: 'local',
        stickers: [
          { id: 's1', body: 'Wave', url: 'https://example.org/wave.svg', info: { mimetype: 'image/svg+xml' } },
        ],
      },
    ]);

    setStickerPackEnabled('local.toggle-pack', false);
    let state = getStickerLibraryState();
    expect(state.packs.find(p => p.id === 'local.toggle-pack')?.isEnabled).toBe(false);

    toggleStickerFavorite('local.toggle-pack', 's1');
    state = getStickerLibraryState();
    expect(state.favorites).toContain('local.toggle-pack/s1');
  });

  it('ingests sticker packs from account data events', () => {
    const listeners: Record<string, (event: MatrixEvent) => void> = {};
    const client: Partial<MatrixClient> = {
      getRooms: () => [],
      on: vi.fn((event: string, handler: any) => {
        listeners[event] = handler;
      }),
      removeListener: vi.fn(),
      getUserId: () => '@user:example.org',
      mxcUrlToHttp: vi.fn(() => 'https://cdn.example.org/sticker.png'),
    };

    bindStickerPackWatcher(client as MatrixClient);

    const accountEvent: MatrixEvent = {
      getType: () => 'm.stickerpack',
      getContent: () => ({
        stickers: [
          {
            id: 'remote-sticker',
            body: 'Remote',
            url: 'mxc://example.org/remote',
            info: { mimetype: 'image/png' },
          },
        ],
      }),
    } as unknown as MatrixEvent;

    listeners['accountData']?.(accountEvent);

    const state = getStickerLibraryState();
    const remotePack = state.packs.find(pack => pack.source === 'account_data');
    expect(remotePack).toBeTruthy();
    expect(remotePack?.stickers[0].body).toBe('Remote');
  });
});
