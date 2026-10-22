// EVIDENCE: TOPIS held stopFlag 1 for one to three observations, about 0-40 s (2026-10-18 sample); 23 complete runs on
// routes 02 and 08 spanned 0-68 s between first and last observation, median 13 s (2026-10-18 18:07-18:13 KST capture).
export const DWELL_SECONDS = 15;

// EVIDENCE: next-stop ETAs of one vehicle were never inverted and at least 27 s apart (247 pairs, the same capture),
// so this moves only a stop already due: 27 of 125 next stops were under 20 s past the observation, 5 before it.
export const MIN_SEGMENT_SECONDS = 20;

// WHY: the contract agreed with skkuverse-app; a poll every 25 s replaces them long before.
export const TRAJECTORY_STOPS_AHEAD = 3;

// WHY: the app's own speed, so one predictor: with a trajectory the app ignores nextStopInSec and segmentMeters, so a
// next stop TOPIS gives no time for is reached at this speed (agreed with skkuverse-app).
export const ASSUMED_SPEED_METERS_PER_SECOND = 4;

// WHY: knot 0 stays in the bus's own section, floor(s) == stationIndex (agreed with skkuverse-app), even when TOPIS's
// sectDist reaches fullSectDist.
export const MAX_FIRST_KNOT_FRACTION = 0.999;

// WHY: the route is frozen and superseded by GET /bus/live/:groupId (ADR 0019, D11), as of 2026-10-22 00:00 KST; an
// RFC 9745 date, @ and Unix seconds. Sunset is added once a removal date is set.
export const REALTIME_ROUTE_DEPRECATION = "@1792594800";

export const DEPRECATED_CALL_LOG_INTERVAL_MS = 60 * 60_000;
