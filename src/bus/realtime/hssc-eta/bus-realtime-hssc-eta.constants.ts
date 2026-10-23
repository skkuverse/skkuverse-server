import type { HsscSegment } from "./bus-realtime-hssc-eta.types";

// EVIDENCE: medians of the feed's ENTERED and LEFT events over about 100 laps on 2026-10-20 and 2026-10-22, by seq;
// the method is ADR 0018, D3, and the days agree within about 5 s a segment.
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

// EVIDENCE: 614 of 625 departures away from the turnaround (2026-10-22 to 10-23) showed their next stop event within
// 120 s past the travel median; past it the bus is stalled or the feed stopped. The client keeps an overdue arrival as long (ADR 0018, D6).
export const MAX_OVERDUE_SECONDS = 120;

// QUIRK(hssc): seq 10 reports its departure as LEFT_LAST, every other stop as LEFT.
export const DEPARTURE_INOUTS: readonly string[] = ["LEFT", "LEFT_LAST"];
