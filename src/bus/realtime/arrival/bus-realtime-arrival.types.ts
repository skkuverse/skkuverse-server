import type { Arrival } from "../group/bus-realtime-group.wire";

export type ArrivalState = Arrival["state"];
export type Crowding = NonNullable<Arrival["crowding"]>;

export type ArrivalStatePhrases = ReadonlyArray<readonly [ArrivalState, readonly string[]]>;

/** WHY: the time a running bus's text states, for when TOPIS sends no travel time. */
export interface TimedText {
  minutes: number;
  seconds: number;
}
