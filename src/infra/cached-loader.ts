import config from "./config";
import logger from "./logger";

/**
 * WHY: single-flight, so an expiry never becomes a burst of identical loads, and failures are never
 * cached. Inside `staleWindowMs` an expired value is served while a reload runs, and outlives a failed
 * one (logged, retried once per TTL). The value is shared: callers treat it as read-only.
 */

export interface CachedLoaderOptions<T> {
  name: string;
  ttlMs: number;
  load: () => Promise<T>;
  staleWindowMs?: number;
  // WHY: for a load that costs more than staleness does on a laptop (an LLM call, a production fetch).
  keepWhenCacheOff?: boolean;
}

export interface CachedLoader<T> {
  get(): Promise<T>;
  clear(): void;
}

interface LoaderState<T> {
  readonly opts: CachedLoaderOptions<T>;
  readonly name: string;
  readonly ttlMs: number;
  readonly load: () => Promise<T>;
  readonly staleWindowMs: number;
  value: { data: T; loadedAt: number } | null;
  freshUntil: number;
  inFlight: Promise<T> | null;
  // WHY: bumped by clear(), so a load that started before it cannot store its result.
  generation: number;
}

function staleUntil<T>(s: LoaderState<T>): number {
  return s.value && s.staleWindowMs > 0 ? s.value.loadedAt + s.ttlMs + s.staleWindowMs : 0;
}

function storeLoaded<T>(s: LoaderState<T>, gen: number, data: T): T {
  if (gen === s.generation) {
    const now = Date.now();
    s.value = { data, loadedAt: now };
    s.freshUntil = now + s.ttlMs;
  }
  return data;
}

function serveStaleOrThrow<T>(s: LoaderState<T>, gen: number, err: unknown): T {
  const now = Date.now();
  const until = staleUntil(s);
  if (gen !== s.generation || !s.value || !(now < until)) throw err;
  s.freshUntil = Math.min(now + s.ttlMs, until);
  logger.warn(
    { event: "cache.reload_failed", cache: s.name, err, ageMs: now - s.value.loadedAt },
    "Cache reload failed, serving the last good value",
  );
  return s.value.data;
}

function reload<T>(s: LoaderState<T>): Promise<T> {
  const gen = s.generation;
  const attempt: Promise<T> = Promise.resolve()
    .then(s.load)
    .then(
      (data) => storeLoaded(s, gen, data),
      (err: unknown) => serveStaleOrThrow(s, gen, err),
    )
    .finally(() => {
      if (s.inFlight === attempt) s.inFlight = null;
    });
  s.inFlight = attempt;
  return attempt;
}

function get<T>(s: LoaderState<T>): Promise<T> {
  // WHY: read per call, so a test can flip CACHE.
  if (!config.cache.enabled && !s.opts.keepWhenCacheOff) {
    return Promise.resolve().then(s.load);
  }
  const now = Date.now();
  if (s.value && now < s.freshUntil) return Promise.resolve(s.value.data);
  if (s.value && now < staleUntil(s)) {
    // WHY: unawaited: a failure inside the window logs itself; one that ends past it surfaces on the
    // next get(), which waits for its own reload.
    if (!s.inFlight) reload(s).catch(() => undefined);
    return Promise.resolve(s.value.data);
  }
  return s.inFlight ?? reload(s);
}

function clear<T>(s: LoaderState<T>): void {
  s.generation += 1;
  s.value = null;
  s.freshUntil = 0;
  s.inFlight = null;
}

export function createCachedLoader<T>(opts: CachedLoaderOptions<T>): CachedLoader<T> {
  const { name, ttlMs, load } = opts;
  const staleWindowMs = opts.staleWindowMs ?? 0;
  if (!(ttlMs > 0)) {
    throw new Error(`[cache] ${name}: ttlMs must be > 0, got ${ttlMs}`);
  }
  if (!(staleWindowMs >= 0)) {
    throw new Error(`[cache] ${name}: staleWindowMs must be >= 0, got ${staleWindowMs}`);
  }
  const state: LoaderState<T> = {
    opts,
    name,
    ttlMs,
    load,
    staleWindowMs,
    value: null,
    freshUntil: 0,
    inFlight: null,
    generation: 0,
  };
  return {
    get: (): Promise<T> => get(state),
    clear: (): void => clear(state),
  };
}
