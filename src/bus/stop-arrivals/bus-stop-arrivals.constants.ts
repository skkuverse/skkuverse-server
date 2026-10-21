// WHY: the owner's choice of how many runs a stop page lists per route (unify-bus-stops D9).
export const NEXT_RUN_COUNT = 3;

// WHY: a route that cannot be read stays so on every request; one line a minute, as docs/reference/logging.md asks.
export const LEFT_OUT_LOG_INTERVAL_MS = 60_000;

// WHY: like the realtime routes, the page carries live positions and arrivals (unify-bus-stops D7).
export const STOP_ARRIVALS_CACHE_CONTROL = "no-store";
