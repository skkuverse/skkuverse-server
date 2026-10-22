// WHY: the estimate's delay range: a run matched outside it would give its train no delay, and a
// delay outside it is far likelier the wrong run than a real delay.
export const MIN_DELAY_SEC = -120;
export const MAX_DELAY_SEC = 2700;

// WHY: as long as the tracker holds a missing train, so a trainset back in view keeps its run.
export const MISSING_TRAIN_HOLD_MS = 15 * 60_000;
