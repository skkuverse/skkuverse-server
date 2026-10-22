import type { HsscBusAnchor, HsscEta, HsscStationTime } from "../../realtime/hssc-eta/bus-realtime-hssc-eta.types";

/** WHY: a stop of the HSSC line with the engine's ETAs there, nearest first. */
export interface HsscLiveStation {
  stationIndex: number;
  stopId: string;
  etas: HsscEta[];
}

/** WHY: a fresh bus with where it stands on the line and the engine's times for the rest of its lap. */
export interface HsscLiveBus {
  anchor: HsscBusAnchor;
  stationIndex: number;
  /** WHY: false at a rotary pass, where the bus stops for no one. */
  isAtStopPosition: boolean;
  /** WHY: at the turnaround, or overdue after the feed said it left it (ADR 0018, D6). */
  isLayingOver: boolean;
  /** WHY: when a bus standing at a stop leaves it; null once it left, or laying over. */
  departsAt: Date | null;
  lapTimes: HsscStationTime[];
}

export interface HsscLiveReading {
  stations: HsscLiveStation[];
  buses: HsscLiveBus[];
  checkedAt: Date | null;
}
