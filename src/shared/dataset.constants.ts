// WHY: every replica serves a push within this bound while the database answers (ADR 0013, D6).
export const DATASET_CACHE_TTL_MS = 60_000;

// WHY: editorial data a day old is still correct to serve, and a 503 costs the screen that reads it (ADR 0013, D6).
export const DATASET_STALE_WINDOW_MS = 24 * 60 * 60 * 1000;
