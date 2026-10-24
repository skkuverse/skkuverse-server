import type { LatLng } from "../../shared/lat-lng.types";
import type { BusStopsSnapshot, ScheduleStop, SequenceStop } from "../stops/bus-stops.types";

/** WHY: a TOPIS pole a stop stands for, as its stored registry station names it. */
export interface IndexedPole {
  /** WHY: null at a pole TOPIS gives no ARS number, which only a TOPIS alias names. */
  arsId: string | null;
  topisId: string;
  stationName: string;
}

export interface JongroStopRoute {
  kind: "jongro";
  groupId: string;
  stationIndex: number;
  /** WHY: the next station's name, or null at the route's last index. */
  towards: string | null;
  /** WHY: the stations version the index was placed by, which the realtime view must match to serve this index's arrivals. */
  stationsVersion: string;
}

export interface HsscStopRoute { kind: "hssc"; groupId: string; stationIndex: number }

export type ShuttleStopRoute = Pick<SequenceStop, "action" | "timing"> & {
  kind: "shuttle";
  groupId: string;
  serviceId: string;
  routeType: string;
  sequenceIndex: number;
};

export type StopRoute = JongroStopRoute | HsscStopRoute | ShuttleStopRoute;

export interface IndexedStop {
  id: string;
  /** WHY: the dataset's stop, or null for a TOPIS pole no local stop aliases. */
  localStop: ScheduleStop | null;
  poles: IndexedPole[];
  /** WHY: in the order /bus/config lists the groups, then a group's services and route types. */
  routes: StopRoute[];
}

export interface StopIndex {
  snapshot: BusStopsSnapshot;
  stopById: ReadonlyMap<string, IndexedStop>;
  /** WHY: every ARS number a served route stops at, to its stop id: `seoul-<arsId>` or the local stop aliasing it. */
  stopIdByArsId: ReadonlyMap<string, string>;
  /** WHY: aliased ARS numbers no stored station has, which serve nothing. */
  unmatchedArsIds: readonly string[];
  unmatchedTopisIds: readonly string[];
  /** WHY: the first registry route that could not be read, so a pole only it names is not answered as gone. */
  registryFailure?: unknown;
}

export interface FoundStop extends IndexedStop {
  snapshot: BusStopsSnapshot;
  /** WHY: the stop's own, else its pole's on the stored route line, else none. */
  coords: LatLng | null;
}

export type LocatedStop = Omit<FoundStop, "snapshot">;

/** WHY: each stop once, in the index's order; partial when a registry route or a route line could not be read. */
export interface StopList { snapshot: BusStopsSnapshot; stops: LocatedStop[]; isPartial: boolean }
