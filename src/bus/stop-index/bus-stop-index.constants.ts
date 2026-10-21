// WHY: a registry route that cannot be read is not cached by its loader, so without a hold every stop page would read
// it again; one retry per registry TTL (REGISTRY_TTL_MS, 30 s) keeps the stop page's reads bounded during an outage.
export const REGISTRY_RETRY_MS = 30_000;

// WHY: a source that stays unreadable recurs on every request; one line a minute, as docs/reference/logging.md asks.
export const STOP_INDEX_LOG_INTERVAL_MS = 60_000;
