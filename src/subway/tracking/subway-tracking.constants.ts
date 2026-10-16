import type { TrainState } from "../subway.types";

export const STATE_STEPS: Readonly<Record<TrainState, number>> = { approaching: 0, arrived: 1, departed: 2 };

export const MAX_ROW_AHEAD_MS = 5 * 60_000;

export const MISSING_TRAIN_HOLD_MS = 90_000;

// WHY: a source that stopped answering leaves its last countdowns counting down to nothing; after as long as a
// missing train is held, its trains fall back to their estimates.
export const MAX_COUNTDOWN_SOURCE_AGE_MS = 90_000;

export const MAX_TRAINS_PER_DIRECTION = 3;
