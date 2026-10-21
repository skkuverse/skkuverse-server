export const GAMES_DATASET = "games";

// WHY: a missing, invalid or unreadable dataset recurs on every read; one line a minute, as docs/reference/logging.md asks.
export const GAMES_LOG_INTERVAL_MS = 60_000;

/** WHY: the mini-app registry's lifetime: five minutes bounds how long a kill switch takes to reach a client, on top of the server's own bound. */
export const GAMES_CACHE_CONTROL = "public, max-age=300";
