// EVIDENCE: GBIS getBusRouteInfoItemv2 (2026-10-24): 7800's first bus leaves Homaesil at 05:00 and its weekday last
// leaves Sadang at 01:00, reaching Homaesil about 02:00; one window for every day, with a margin each side.
export const SERVICE_WINDOW_START_MINUTE = 4 * 60 + 50;
export const SERVICE_WINDOW_END_MINUTE = 2 * 60 + 30;

// WHY: two ticks and a request's timeout: one failed tick keeps the seats served, a second serves null.
export const MAX_SEATS_AGE_MS = 200_000;

// EVIDENCE: at this interval the window above makes 867 calls a day, inside data.go.kr's daily quota per operation
// for the key's account type (2026-10-24).
export const POLL_INTERVAL_MS = 90_000;
