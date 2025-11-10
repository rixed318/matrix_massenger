import { beforeEach, afterEach, describe, expect, test, vi } from 'vitest';
import {
  bindOutboxToClient,
  enqueueOutbox,
  flushOutbox,
  serializeOutboxAttachment,
  getOutboxPending,
  onOutboxEvent,
  OutboxEvent,
} from '../../src/services/matrixService';

class FakeIDBRequest<T> {
  public result!: T;
  public onsuccess: ((event: any) => void) | null = null;
  public onerror: ((event: any) => void) | null = null;
  public onupgradeneeded: ((event: any) => void) | null = null;
}

type StoreRecord = {
  map: Map<string, any>;
  keyPath?: string;
};

const cloneValue = <T>(value: T): T => {
  const sc: ((value: unknown) => unknown) | undefined = (globalThis as any).structuredClone;
  if (typeof sc === 'function') {
    return sc(value) as T;
  }
  return JSON.parse(JSON.stringify(value));
};

class FakeObjectStore {
  constructor(private readonly record: StoreRecord, private readonly tx: FakeTransaction) {}

  put(value: any, key?: string) {
    const storeKey = key ?? (this.record.keyPath ? value?.[this.record.keyPath] : undefined);
    if (storeKey === undefined) {
      throw new Error('Missing key for put');
    }
    this.record.map.set(String(storeKey), cloneValue(value));
    this.tx.markDone();
  }

  delete(key: string) {
    this.record.map.delete(String(key));
    this.tx.markDone();
  }

  getAll() {
    const request = new FakeIDBRequest<any[]>();
    queueMicrotask(() => {
      request.result = Array.from(this.record.map.values()).map(value => cloneValue(value));
      request.onsuccess?.({ target: { result: request.result } });
    });
    return request;
  }

  get(key: string) {
    const request = new FakeIDBRequest<any | undefined>();
    queueMicrotask(() => {
      const value = this.record.map.get(String(key));
      request.result = value === undefined ? undefined : cloneValue(value);
      request.onsuccess?.({ target: { result: request.result } });
    });
    return request;
  }

  openKeyCursor() {
    const request = new FakeIDBRequest<any>();
    const keys = Array.from(this.record.map.keys());
    let index = 0;
    const iterate = () => {
      if (index >= keys.length) {
        request.onsuccess?.({ target: { result: null } });
        return;
      }
      const cursor = {
        key: keys[index],
        continue: () => {
          index += 1;
          queueMicrotask(iterate);
        },
      };
      request.onsuccess?.({ target: { result: cursor } });
    };
    queueMicrotask(iterate);
    return request;
  }
}

class FakeTransaction {
  public oncomplete: ((event: any) => void) | null = null;
  public onerror: ((event: any) => void) | null = null;
  public error: any = null;
  private completed = false;

  constructor(private readonly store: StoreRecord) {}

  objectStore() {
    return new FakeObjectStore(this.store, this);
  }

  markDone() {
    if (this.completed) return;
    this.completed = true;
    queueMicrotask(() => {
      this.oncomplete?.({ target: { result: undefined } });
    });
  }
}

class FakeIDBDatabase {
  public version: number;
  public objectStoreNames = {
    contains: (name: string) => this.stores.has(name),
  };
  private stores = new Map<string, StoreRecord>();

  constructor(version: number) {
    this.version = version;
  }

  createObjectStore(name: string, options?: { keyPath?: string }) {
    if (!this.stores.has(name)) {
      this.stores.set(name, { map: new Map(), keyPath: options?.keyPath });
    }
    return {} as any;
  }

  transaction(name: string) {
    const store = this.stores.get(name);
    if (!store) {
      throw new Error(`Store ${name} not found`);
    }
    return new FakeTransaction(store);
  }

  close() {}
}

class MemoryIndexedDB {
  private databases = new Map<string, FakeIDBDatabase>();

  open(name: string, version = 1) {
    let db = this.databases.get(name);
    const request = new FakeIDBRequest<FakeIDBDatabase>();
    let needsUpgrade = false;
    if (!db) {
      db = new FakeIDBDatabase(version);
      this.databases.set(name, db);
      needsUpgrade = true;
    } else if (version > db.version) {
      db.version = version;
      needsUpgrade = true;
    }
    request.result = db;
    queueMicrotask(() => {
      if (needsUpgrade) {
        request.onupgradeneeded?.({ target: { result: db } });
      }
      request.onsuccess?.({ target: { result: db } });
    });
    return request;
  }

  deleteDatabase(name: string) {
    this.databases.delete(name);
  }

  _reset() {
    this.databases.clear();
  }
}

const createFakeClient = () => {
  return {
    on: vi.fn(),
    removeListener: vi.fn(),
    uploadContent: vi.fn(),
    sendEvent: vi.fn().mockResolvedValue({ event_id: '$event' }),
    getAccessToken: vi.fn().mockReturnValue('token'),
    getHomeserverUrl: vi.fn().mockReturnValue('https://matrix.example'),
  };
};

describe('matrixService outbox queue', () => {
  let unsubscribe: (() => void) | undefined;
  let events: OutboxEvent[];
  let client: ReturnType<typeof createFakeClient>;

  beforeEach(() => {
    const idb = new MemoryIndexedDB();
    (globalThis as any).indexedDB = idb as any;
    (indexedDB as any)._reset?.();
    (globalThis as any).navigator = { onLine: true } as any;
    (globalThis as any).window = {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as any;
    events = [];
    unsubscribe = onOutboxEvent(ev => events.push(ev));
    client = createFakeClient();
    bindOutboxToClient(client as any);
  });

  afterEach(() => {
    unsubscribe?.();
    vi.restoreAllMocks();
    (globalThis as any).fetch = undefined;
  });

  test('uploads chunked attachments and emits progress', async () => {
    const data = new Uint8Array(600_000);
    const blob = new Blob([data.buffer], { type: 'application/octet-stream' });
    const attachment = await serializeOutboxAttachment(blob, { name: 'sample.bin', contentPath: 'url' });
    expect(attachment.mode).toBe('chunks');
    await enqueueOutbox('!room:test', 'm.room.message', { body: 'file', msgtype: 'm.file' }, { attachments: [attachment] });

    const chunkCount = attachment.mode === 'chunks' ? attachment.chunkCount : 1;
    const fetchSpy = vi.fn(async () =>
      new Response(JSON.stringify({ content_uri: 'mxc://server/uploaded' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    (globalThis as any).fetch = fetchSpy;

    await flushOutbox();

    expect(fetchSpy).toHaveBeenCalledTimes(chunkCount);
    expect(client.sendEvent).toHaveBeenCalledWith('!room:test', 'm.room.message', expect.objectContaining({ body: 'file' }));
    const sentEvent = events.find(ev => ev.kind === 'sent');
    expect(sentEvent).toBeTruthy();
    const progressEvent = events.find(ev => ev.kind === 'progress' && ev.progress);
    expect(progressEvent?.progress?.totalBytes).toBeGreaterThan(0);
    const pending = await getOutboxPending();
    expect(pending).toHaveLength(0);
  });

  test('resumes failed chunk upload from checkpoint', async () => {
    const payload = new Uint8Array(750_000);
    const blob = new Blob([payload.buffer], { type: 'application/octet-stream' });
    const attachment = await serializeOutboxAttachment(blob, { name: 'resume.bin', contentPath: 'url' });
    await enqueueOutbox('!room:test', 'm.room.message', { body: 'resume', msgtype: 'm.file' }, { attachments: [attachment] });

    const successResponse = new Response(JSON.stringify({}), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
    const failingFetch = vi
      .fn()
      .mockResolvedValueOnce(successResponse)
      .mockRejectedValueOnce(new Error('network'));
    (globalThis as any).fetch = failingFetch;

    await flushOutbox();

    expect(client.sendEvent).not.toHaveBeenCalled();
    let pending = await getOutboxPending();
    expect(pending).toHaveLength(1);
    const storedAttachment = pending[0].attachments?.[0] as any;
    expect(storedAttachment?.checkpoint?.uploadedChunks).toBe(1);

    const resumeFetch = vi.fn(async () =>
      new Response(JSON.stringify({ content_uri: 'mxc://server/resume' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    (globalThis as any).fetch = resumeFetch;

    await flushOutbox();

    const remainingChunks = storedAttachment.mode === 'chunks'
      ? storedAttachment.chunkCount - (storedAttachment.checkpoint?.uploadedChunks ?? 0)
      : 1;
    expect(resumeFetch).toHaveBeenCalledTimes(Math.max(1, remainingChunks));
    expect(client.sendEvent).toHaveBeenCalledTimes(1);
    pending = await getOutboxPending();
    expect(pending).toHaveLength(0);
  });
});
