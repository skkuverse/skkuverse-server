import type { DepartureContinuation } from "../../../shared/departure.types";

/** WHY: where a leg sits on a TOPIS route: its board station's index and, when asked for, its alight station's after it. */
export interface TopisLegStations {
  boardIndex: number;
  alightIndex: number | null;
}

/** WHY: one service day at a stop, from its first run to its last; a last run after midnight is the next day's. */
export interface ServiceSpan {
  startsAt: Date;
  endsAt: Date;
}

/** WHY: what a stop's service day gives its board: its first run while still ahead in the window, the headway, the next first run. */
export interface BoardHours {
  firstRunAt: Date | null;
  continuation: DepartureContinuation;
  nextServiceAt: Date | null;
}

/** WHY: a TOPIS ride as the journey push checks it: the route id and the cited board and alight stop ids. */
export interface TopisRide {
  lineId: string;
  boardStopId: string;
  alightStopId: string;
}
