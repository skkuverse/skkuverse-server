// WHY: a delay outside this range is far likelier a train-number mismatch than a real delay.
export const MIN_DELAY_SEC = -120;
export const MAX_DELAY_SEC = 2700;

export const MAX_DELAY_LENDER_GAP_MS = 30 * 60_000;

export const MAX_COUNTDOWN_DIVERGENCE_SEC = 120;

// EVIDENCE: on 2026-10-17 every departure at Hyehwa came at most 82 s past the estimated one (96 trains); at
// Sungkyunkwan Univ., where Korail reports none, 17 of 85 trains were missing from the train map and lingered.
export const MAX_STANDING_PAST_DEPARTURE_SEC = 90;
