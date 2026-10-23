export const HSSC_ROUTE_LINE_DATASET = "hssc-route-line";

// WHY: a missing, invalid or unreadable dataset recurs on every read; one line a minute, as docs/reference/logging.md asks.
export const HSSC_ROUTE_LINE_LOG_INTERVAL_MS = 60_000;

// WHY: a line of a few points is a broken push, not the loop; the shortest Jongno line TOPIS draws has 241.
export const MIN_ROUTE_LINE_POINTS = 10;

// EVIDENCE: the line measured on 2026-10-23 has a point every 16 m (ADR 0018, D9); a longer jump is a stray point.
export const MAX_ROUTE_LINE_SEGMENT_M = 100;
