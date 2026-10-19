// WHY: bumped only on a breaking change; a new section type or item kind is not one, clients drop it.
export const TRANSIT_LAYOUT_VERSION = 1;

export const TRANSIT_LAYOUT_DATASET = "transit-layout";

// WHY: a missing or invalid dataset recurs on every read; one line a minute, as docs/reference/logging.md asks.
export const TRANSIT_LAYOUT_LOG_INTERVAL_MS = 60_000;
