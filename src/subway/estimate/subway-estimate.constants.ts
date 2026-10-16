export const APPROACH_LEAD_MS = 30_000;

// WHY: a delay outside this range is far likelier a train-number mismatch than a real delay (design D4).
export const MIN_DELAY_SEC = -120;
export const MAX_DELAY_SEC = 2700;

export const MAX_DELAY_LENDER_GAP_MS = 30 * 60_000;

export const MAX_COUNTDOWN_DIVERGENCE_SEC = 120;
