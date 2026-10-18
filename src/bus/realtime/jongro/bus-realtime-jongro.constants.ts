export const POLL_INTERVAL_MS = 40_000;

// WHY: a stop held longer than this is a new arrival, not the same dwell.
export const DWELL_RESET_MINUTES = 10;

// WHY: agreed with skkuverse-app (add-jongro-bus-positions D3): GPS jitter of an idling bus stays under this.
export const MAX_STATIONARY_MOVE_METERS = 10;
