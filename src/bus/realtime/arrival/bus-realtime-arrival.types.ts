import type { JongroArrivalBus } from "../../cache/bus-cache.document";
import type { RealtimeArrival } from "../group/bus-realtime-group.wire";

export type ArrivalState = RealtimeArrival["state"];
export type Crowding = NonNullable<RealtimeArrival["crowding"]>;

export type ArrivalStatePhrases = ReadonlyArray<readonly [ArrivalState, readonly string[]]>;

/** WHY: the time a running bus's text states, for when TOPIS sends no travel time. */
export interface TimedText {
  minutes: number;
  seconds: number;
}

/** WHY: a TOPIS bus with a text, its realtime arrival and the seconds its time comes to from the row's mkTm. */
export interface TimedArrival {
  bus: JongroArrivalBus;
  arrival: RealtimeArrival;
  travelSeconds: number | null;
}
