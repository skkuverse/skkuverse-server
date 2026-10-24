// EVIDENCE: GBIS getBusRouteInfoItemv2 (2026-10-24): 7800's first bus leaves Homaesil at 05:00 and its weekday last
// leaves Sadang at 01:00, reaching Homaesil about 02:00; one window for every day, with a margin each side.
export const SERVICE_WINDOW_START_MINUTE = 4 * 60 + 50;
export const SERVICE_WINDOW_END_MINUTE = 2 * 60 + 30;

// WHY: two ticks and a request's timeout: one failed tick keeps the seats served, a second serves null.
export const MAX_SEATS_AGE_MS = 200_000;

// EVIDENCE: data.go.kr's development account allows 1,000 calls a day per operation (owner's account, 2026-10-24);
// the window above fits 867 at this interval.
export const POLL_INTERVAL_MS = 90_000;
