// WHY: a village bus line changes a few times a year; six calls a day leave TOPIS's 10,000-a-day quota per
// operation to the realtime poller (add-jongro-route-lines D3).
export const SYNC_INTERVAL_MS = 24 * 60 * 60_000;

// WHY: a line of a few points is a broken answer, not a route: the shortest of Jongno 02, 07 and 08 had 241 on 2026-10-18.
export const MIN_PATH_POINTS_TO_TRUST = 10;

// WHY: a change to more than this share of the points or the length reads as another route's line, not a reroute.
export const MAX_PATH_CHANGE_SHARE_TO_APPLY = 0.3;

export const PATH_VERSION_LENGTH = 16;

// WHY: the line changes at most daily; a replica reads a synced line within ten minutes.
export const ROUTE_PATHS_TTL_MS = 10 * 60_000;

// WHY: a line changes a few times a year, so a failed reload keeps the last good lines for a day before the 503;
// a reload that succeeds is always waited for, so the TTL stays the freshness bound.
export const ROUTE_PATHS_STALE_WINDOW_MS = 24 * 60 * 60_000;

// WHY: a read that fails with nothing cached is not cached by its loader, so without a hold every stop page would read
// again; one retry per 30 s per process bounds the reads an Atlas outage costs.
export const ROUTE_PATHS_RETRY_MS = 30_000;

// WHY: a missing or unreadable line recurs on every request; one line a minute, as docs/reference/logging.md asks.
export const ROUTE_PATHS_LOG_INTERVAL_MS = 60_000;
