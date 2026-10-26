import type { SupportedLang } from "../infra/types";
import type { StopCall } from "./call.types";
import type { Place } from "./place.wire";
import type { Vehicle } from "./vehicle.wire";

export interface DepartureQuery {
  /** WHY: the source's own line: a service id, a route id or a subway line. */
  lineId: string;
  boardStopId: string;
  /** WHY: null asks for a board with no destination, whose departures carry no alight call. */
  alightStopId: string | null;
  from: Date;
  until: Date;
  /** WHY: a headsign is served in the request language. */
  lang: SupportedLang;
}

export interface Departure {
  lineId: string;
  board: StopCall;
  /** WHY: the same run at the alight stop, joined by the source; null when it cannot place the run there. */
  alight: StopCall | null;
  /** WHY: when the source's own document was written; null for a published timetable with no observation. */
  observedAt: Date | null;
  /** WHY: the stops this run passes between the board and alight stops, for a door whose runs call at different ones (an express); null when it cannot list them. */
  stops?: readonly Place[] | null;
}

export type DepartureContinuation = { kind: "listed" } | { kind: "headway"; headwaySec: number; serviceEndsAt: Date | null };

export interface DepartureBoard {
  /** WHY: by call time, ascending. */
  departures: readonly Departure[];
  vehicles: Readonly<Record<string, Vehicle>>;
  continuation: DepartureContinuation;
  /** WHY: the first departure after the window, the next service day's first when the day has ended; null when none is known. */
  nextServiceAt: Date | null;
  /** WHY: the stops a ride from the board stop to the alight one passes between them, in travel order; absent when the door cannot list them. */
  stops?: readonly Place[];
}

export interface DepartureSource {
  listDepartures(query: DepartureQuery): Promise<DepartureBoard>;
}
