// EVIDENCE: TOPIS held stopFlag 1 for one to three observations, about 0-40 s (2026-10-18 sample); 23 complete runs on
// routes 02 and 08 spanned 0-68 s between first and last observation, median 13 s (2026-10-18 18:07-18:13 KST capture).
export const DWELL_SECONDS = 15;

// EVIDENCE: next-stop ETAs of one vehicle were never inverted and at least 27 s apart (247 pairs, the same capture),
// so this moves only a stop already due: 27 of 125 next stops were under 20 s past the observation, 5 before it.
export const MIN_SEGMENT_SECONDS = 20;

// WHY: the contract proposed to skkuverse-app (add-jongro-bus-trajectory D2); a poll every 25 s replaces them long before.
export const TRAJECTORY_STOPS_AHEAD = 3;
