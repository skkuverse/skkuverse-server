export const BUS_STOPS_DATASET = "bus-stops";

// WHY: a missing, invalid or unreadable dataset recurs on every read; one line a minute, as docs/reference/logging.md asks.
export const BUS_STOPS_LOG_INTERVAL_MS = 60_000;

export const PANO_ID_PATTERN = /^[A-Za-z0-9_-]{22}$/;

export const MAX_WALK_M = 500;

// QUIRK(naver): one directions call covers a run: start, up to five waypoints, goal.
export const MAX_ETA_STOPS = 7;

// WHY: the walk end that means the stop itself; never a place id.
export const STOP_END = "stop";

export const OPTIONAL_LANGS = ["en", "zh"] as const;
