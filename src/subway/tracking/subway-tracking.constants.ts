import type { TrainState } from "../subway.types";

export const STATE_STEPS: Readonly<Record<TrainState, number>> = { approaching: 0, arrived: 1, departed: 2 };

export const MAX_ROW_AHEAD_MS = 5 * 60_000;

// EVIDENCE: the longest scheduled run between two row stops of subway-timetables revision 1 is 510 s, an express from
// Geumjeong to Sungkyunkwan Univ., which no upstream reliably reports in between; held this long, it keeps its delay through it.
export const MISSING_TRAIN_HOLD_MS = 15 * 60_000;

// WHY: an unseen train is listed until at most its scheduled departure plus 2,700 s; held 120 s longer, a train seen
// at or past the station is never listed again, unless it was seen there over 120 s early and then vanished from
// every source.
export const PASSED_TRAIN_HOLD_MS = 47 * 60_000;

// WHY: a source that stopped answering leaves its last countdowns counting down to nothing; after 90 s without a
// tick, its trains fall back to their estimates.
export const MAX_COUNTDOWN_SOURCE_AGE_MS = 90_000;

export const MAX_TRAINS_PER_DIRECTION = 3;
