/** WHY: where a first-party mini app serves its `public/skkuverse.json`, the @skkuverse/miniapp SDK manifest. */
export const MANIFEST_PATH = "/skkuverse.json";

/** WHY: a slow origin must not hold up what waits on its manifest: a detail request, or the next poll. */
export const FETCH_TIMEOUT_MS = 3_000;

/** WHY: refused whether announced or actually read, so a manifest never buffers more than this. */
export const MAX_MANIFEST_BYTES = 16 * 1024;

/** WHY: four minutes, plus a reader's minute, keeps a manifest edit within the five minutes it takes to show. */
export const POLL_INTERVAL_MS = 4 * 60_000;

/** WHY: the reader's minute of the five; one read serves every origin, so a replica reads once a minute. */
export const MANIFEST_CACHE_TTL_MS = 60_000;

/** WHY: after a good read, a database outage keeps the last read shells serving for a day. */
export const MANIFEST_STALE_WINDOW_MS = 24 * 60 * 60_000;

export const READ_FAILED_LOG_INTERVAL_MS = 10 * 60_000;
