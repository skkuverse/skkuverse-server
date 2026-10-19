import { DATASET_CACHE_TTL_MS, DATASET_STALE_WINDOW_MS } from "../shared/dataset.constants";
import { createCachedLoader } from "./cached-loader";
import type { Clock } from "./clock";
import config from "./config";
import { createLogThrottle } from "./log-throttle";
import logger from "./logger";

/**
 * WHY: the read contract every dataset reader keeps (ADR 0013 D6), in one place so it cannot drift.
 * `load` returns null when the stored dataset is missing or invalid; a reload that does so, or fails,
 * serves the last good value inside the stale window. With none, `get` throws `toUnavailable()`.
 */
export interface DatasetLoaderOptions<T> {
  name: string;
  load: () => Promise<T | null>;
  clock: Clock;
  isReadError: (err: unknown) => err is Error;
  toUnavailable: () => Error;
  readFailedEvent: string;
  logIntervalMs: number;
}

export interface DatasetLoader<T> {
  get(): Promise<T>;
}

class NoGoodDatasetError extends Error {
  constructor(name: string) {
    super(`${name}: no good value stored`);
    this.name = "NoGoodDatasetError";
  }
}

export function createDatasetLoader<T>(opts: DatasetLoaderOptions<T>): DatasetLoader<T> {
  const { name, clock, isReadError, toUnavailable } = opts;
  const readFailedThrottle = createLogThrottle(opts.logIntervalMs, () => clock.now().getTime());
  // WHY: the cached loader caches no failure; with no good value, the database sees one read per TTL, not one per request.
  let unavailableUntil = 0;
  let lastFailure: unknown = null;
  const loader = createCachedLoader<T>({
    name,
    ttlMs: DATASET_CACHE_TTL_MS,
    staleWindowMs: DATASET_STALE_WINDOW_MS,
    serveStale: "on-reload-failure",
    load: async () => {
      const loaded = await opts.load();
      if (loaded === null) throw new NoGoodDatasetError(name);
      return loaded;
    },
  });

  const logReadFailed = ({ cause: driverError }: Error): void => {
    const taken = readFailedThrottle.take("read_failed");
    if (taken) logger.error({ event: opts.readFailedEvent, cache: name, err: driverError, ...taken }, "Dataset unreadable with none cached");
  };

  const get = async (): Promise<T> => {
    if (clock.now().getTime() < unavailableUntil) throw toUnavailable();
    try {
      return await loader.get();
    } catch (err) {
      if (!(err instanceof NoGoodDatasetError || isReadError(err))) throw err;
      // WHY: every caller waiting on one failed load receives the same error; it is one failure to remember and log.
      if (err === lastFailure) throw toUnavailable();
      lastFailure = err;
      if (config.cache.enabled) unavailableUntil = clock.now().getTime() + DATASET_CACHE_TTL_MS;
      if (isReadError(err)) logReadFailed(err);
      throw toUnavailable();
    }
  };

  return { get };
}
