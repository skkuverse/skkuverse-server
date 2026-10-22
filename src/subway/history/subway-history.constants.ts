export const PREDICTION_HORIZONS_MIN: readonly number[] = [10, 5, 3, 1];

export const UNRESOLVED_AFTER_MS = 30 * 60_000;

// WHY: to shorten once the accuracy report shows the volume.
export const HISTORY_TTL_SEC = 180 * 24 * 60 * 60;

export const WRITE_FAILURE_LOG_INTERVAL_MS = 10 * 60_000;

// WHY: one sweep a minute bounds an unresolved record's lateness to a minute at one write a minute, not one per tick.
export const UNRESOLVED_SWEEP_INTERVAL_MS = 60_000;
