import {
  createCachedLoader,
  type CachedLoader,
} from "../../common/cache/cached-loader";

/**
 * Per-replica keyed cache for generated overviews (design D6).
 *
 * Each key gets its own createCachedLoader, which gives concurrent identical
 * requests one shared ai call (single-flight) and never keeps a failure. An
 * entry is replaced, not reloaded, once its TTL passes: a loader's `load`
 * closure carries the request that created it (its reference time and
 * candidates), and a later request must not be answered with that stale input.
 *
 * Bounded by key count; when full, the oldest-inserted key goes. Replicas do
 * not share entries — there is no shared cache, and adding one would put
 * Atlas ops on the hot path.
 */

export const OVERVIEW_CACHE_TTL_MS = 30 * 60 * 1000;
export const OVERVIEW_CACHE_MAX_KEYS = 500;

interface Entry<T> {
  loader: CachedLoader<T>;
  createdAt: number;
}

export class OverviewCache<T> {
  private readonly entries = new Map<string, Entry<T>>();

  constructor(
    private readonly ttlMs: number = OVERVIEW_CACHE_TTL_MS,
    private readonly maxKeys: number = OVERVIEW_CACHE_MAX_KEYS,
  ) {}

  /**
   * Returns the value for `key`, running `load` only when no live entry holds
   * one. `cached` is false only for the caller whose request created the entry;
   * a caller that joined an in-flight load or read a stored value gets true.
   * A failed load drops the entry, so the next caller starts afresh.
   */
  async get(
    key: string,
    load: () => Promise<T>,
  ): Promise<{ value: T; cached: boolean }> {
    const now = Date.now();
    let entry = this.entries.get(key);
    let cached = true;
    if (!entry || now - entry.createdAt >= this.ttlMs) {
      this.entries.delete(key);
      if (this.entries.size >= this.maxKeys) {
        const oldest = this.entries.keys().next().value;
        if (oldest !== undefined) this.entries.delete(oldest);
      }
      entry = {
        loader: createCachedLoader({
          name: "notices.overview",
          ttlMs: this.ttlMs,
          load,
        }),
        createdAt: now,
      };
      this.entries.set(key, entry);
      cached = false;
    }

    const live = entry;
    try {
      return { value: await live.loader.get(), cached };
    } catch (err: unknown) {
      if (this.entries.get(key) === live) this.entries.delete(key);
      throw err;
    }
  }

  get size(): number {
    return this.entries.size;
  }
}
