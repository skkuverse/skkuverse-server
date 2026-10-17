import type { TrainState } from "../subway.types";

export const STATE_STEPS: Readonly<Record<TrainState, number>> = { approaching: 0, arrived: 1, departed: 2 };

export const MAX_ROW_AHEAD_MS = 5 * 60_000;

export const MISSING_TRAIN_HOLD_MS = 90_000;

// WHY: an unobserved train is listed until its scheduled departure plus a lent delay of up to 2,700 s, and an
// observed one leaves at most 120 s early (design D4); held this long, a train past the station is never listed again.
export const PASSED_TRAIN_HOLD_MS = 47 * 60_000;

// WHY: a source that stopped answering leaves its last countdowns counting down to nothing; after as long as a
// missing train is held, its trains fall back to their estimates.
export const MAX_COUNTDOWN_SOURCE_AGE_MS = 90_000;

export const MAX_TRAINS_PER_DIRECTION = 3;
