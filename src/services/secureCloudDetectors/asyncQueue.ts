export interface QueueTaskOptions {
    cacheKey?: string;
    cacheTtlMs?: number;
}

interface QueueEntry<T> {
    task: () => Promise<T>;
    resolve: (value: T | PromiseLike<T>) => void;
    reject: (reason?: unknown) => void;
    cacheKey?: string;
    cacheTtlMs?: number;
}

interface CacheEntry<T> {
    value: T;
    expiresAt?: number;
}

/**
 * AsyncProcessingQueue coordinates expensive inference tasks so that
 * heavy models run sequentially or with limited concurrency. It also
 * deduplicates work for identical inputs and caches results during the
 * configured TTL to avoid redundant processing.
 */
export class AsyncProcessingQueue {
    private readonly queue: QueueEntry<unknown>[] = [];
    private running = 0;
    private readonly cache = new Map<string, CacheEntry<unknown>>();
    private readonly inflight = new Map<string, Promise<unknown>>();

    public constructor(private readonly concurrency = 1) {}

    public enqueue<T>(task: () => Promise<T>, options: QueueTaskOptions = {}): Promise<T> {
        const cacheKey = options.cacheKey;
        if (cacheKey) {
            const cached = this.cache.get(cacheKey);
            if (cached && (!cached.expiresAt || cached.expiresAt > Date.now())) {
                return Promise.resolve(cached.value as T);
            }
            const inflight = this.inflight.get(cacheKey);
            if (inflight) {
                return inflight as Promise<T>;
            }
        }

        return new Promise<T>((resolve, reject) => {
            this.queue.push({ task, resolve, reject, cacheKey, cacheTtlMs: options.cacheTtlMs });
            this.flush();
        });
    }

    public clearCache(): void {
        this.cache.clear();
    }

    private flush(): void {
        while (this.running < this.concurrency && this.queue.length > 0) {
            const entry = this.queue.shift();
            if (!entry) {
                return;
            }
            this.processEntry(entry);
        }
    }

    private processEntry(entry: QueueEntry<unknown>): void {
        this.running += 1;
        const { task, resolve, reject, cacheKey, cacheTtlMs } = entry;

        let promise: Promise<unknown>;
        try {
            promise = task();
        } catch (error) {
            this.running -= 1;
            reject(error);
            this.flush();
            return;
        }

        if (cacheKey) {
            this.inflight.set(cacheKey, promise);
        }

        promise
            .then(result => {
                if (cacheKey) {
                    const cacheEntry: CacheEntry<unknown> = { value: result };
                    if (cacheTtlMs && Number.isFinite(cacheTtlMs)) {
                        cacheEntry.expiresAt = Date.now() + (cacheTtlMs as number);
                    }
                    this.cache.set(cacheKey, cacheEntry);
                    this.inflight.delete(cacheKey);
                }
                resolve(result);
            })
            .catch(error => {
                if (cacheKey) {
                    this.inflight.delete(cacheKey);
                }
                reject(error);
            })
            .finally(() => {
                this.running = Math.max(0, this.running - 1);
                this.flush();
            });
    }
}

export const createProcessingQueue = (concurrency = 1): AsyncProcessingQueue => {
    const maxConcurrency = Number.isFinite(concurrency) && concurrency > 0 ? Math.floor(concurrency) : 1;
    return new AsyncProcessingQueue(maxConcurrency);
};
