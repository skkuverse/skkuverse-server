import type { TrainState } from "../subway.types";

export const STATE_STEPS: Readonly<Record<TrainState, number>> = { approaching: 0, arrived: 1, departed: 2 };

export const MAX_ROW_AHEAD_MS = 5 * 60_000;

// EVIDENCE: the longest scheduled run between two row stops of the committed timetables is 510 s, an express from
// Geumjeong to Sungkyunkwan Univ., which no upstream reliably reports in between; held this long, it keeps its delay through it.
export const MISSING_TRAIN_HOLD_MS = 15 * 60_000;

// WHY: an unseen train is listed until at most its scheduled departure plus 2,700 s, and an observed one leaves at
// most 120 s early (design D4); held this long, a train seen at or past the station is never listed again.
export const PASSED_TRAIN_HOLD_MS = 47 * 60_000;

// WHY: a source that stopped answering leaves its last countdowns counting down to nothing; after 90 s without a
// tick, its trains fall back to their estimates.
export const MAX_COUNTDOWN_SOURCE_AGE_MS = 90_000;

export const MAX_TRAINS_PER_DIRECTION = 3;
