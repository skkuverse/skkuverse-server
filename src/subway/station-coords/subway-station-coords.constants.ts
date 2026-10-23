export const SUBWAY_STATION_COORDS_DATASET = "subway-station-coords";

// WHY: a missing, invalid or unreadable dataset recurs on every read; one line a minute, as docs/reference/logging.md asks.
export const STATION_COORDS_LOG_INTERVAL_MS = 60_000;
