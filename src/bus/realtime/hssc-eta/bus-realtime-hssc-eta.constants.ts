import type { HsscSegment } from "./bus-realtime-hssc-eta.types";

// EVIDENCE: medians of the feed's ENTERED and LEFT events over about 100 laps on 2026-10-20 and 2026-10-22, by seq;
// the method and the table are add-hssc-arrival-estimates design D3, and the days agree within about 5 s a segment.
export const SEGMENTS_BY_SEQ: readonly HsscSegment[] = [
  { dwellSeconds: 174, travelSeconds: 30 },
  { dwellSeconds: 12, travelSeconds: 70 },
  { dwellSeconds: 63, travelSeconds: 28 },
  { dwellSeconds: 30, travelSeconds: 57 },
  { dwellSeconds: 33, travelSeconds: 30 },
  { dwellSeconds: null, travelSeconds: 21 },
  { dwellSeconds: 24, travelSeconds: 54 },
  { dwellSeconds: 24, travelSeconds: 111 },
  { dwellSeconds: 24, travelSeconds: 94 },
  { dwellSeconds: 21, travelSeconds: 24 },
  { dwellSeconds: 12, travelSeconds: 81 },
];

// QUIRK(hssc): seq 5 is the turnaround, where a lap starts and a bus lays over for an unpredictable time.
export const TURNAROUND_SEQ = 5;

// QUIRK(hssc): seq 1 and 10 are the two passes of the Hyehwa Rotary, where the shuttle does not board anyone.
export const NON_STOP_SEQS: readonly number[] = [1, 10];

// QUIRK(hssc): seq 10 reports its departure as LEFT_LAST, every other stop as LEFT.
export const DEPARTURE_INOUTS: readonly string[] = ["LEFT", "LEFT_LAST"];
