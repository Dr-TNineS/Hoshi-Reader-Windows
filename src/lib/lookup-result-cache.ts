export interface LookupResultCacheRequest<T> {
  promise: Promise<T[]>;
  cacheHit: boolean;
}

export class LookupResultCache<T> {
  readonly #entries = new Map<string, Promise<T[]>>();

  constructor(readonly maxEntries = 32) {
    if (!Number.isInteger(maxEntries) || maxEntries < 1) {
      throw new Error("Lookup cache capacity must be a positive integer.");
    }
  }

  get(text: string, loader: (normalizedText: string) => Promise<T[]>): LookupResultCacheRequest<T> {
    const key = text.trim();
    if (!key) return { promise: loader(key), cacheHit: false };

    const cached = this.#entries.get(key);
    if (cached) {
      this.#entries.delete(key);
      this.#entries.set(key, cached);
      return { promise: cached, cacheHit: true };
    }

    const promise = Promise.resolve()
      .then(() => loader(key))
      .catch((error) => {
        if (this.#entries.get(key) === promise) this.#entries.delete(key);
        throw error;
      });
    this.#entries.set(key, promise);
    this.#evictOverflow();
    return { promise, cacheHit: false };
  }

  clear() {
    this.#entries.clear();
  }

  get size(): number {
    return this.#entries.size;
  }

  #evictOverflow() {
    while (this.#entries.size > this.maxEntries) {
      const oldestKey = this.#entries.keys().next().value;
      if (oldestKey === undefined) return;
      this.#entries.delete(oldestKey);
    }
  }
}
