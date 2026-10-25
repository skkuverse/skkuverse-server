import type { LatLng } from "../shared/lat-lng.types";
import type { JOURNEY_PLACE_KINDS, JOURNEY_SOURCE_IDS } from "./journey.constants";

export type JourneySourceId = (typeof JOURNEY_SOURCE_IDS)[number];
export type PlaceKind = (typeof JOURNEY_PLACE_KINDS)[number];

/** WHY: a stored `<kind>:<id>` read apart; the id is the owning catalog's verbatim. */
export interface PlaceRef {
  kind: PlaceKind;
  id: string;
}

/** WHY: the leg's two ends as place refs: a walk's from and to, a transfer's station twice, a ride's board and alight. */
export interface LegEnds {
  from: string;
  to: string;
}

/** WHY: a place the dataset cites, where it sits, the role that limits its kind, and the platform it names. */
export interface CitedPlace {
  ref: string;
  path: Array<string | number>;
  role: "routeEnd" | "rideStop" | "walkEnd" | "transferAt";
  platformId: string | null;
}

export interface JourneyReference {
  dataset: "bus-stops";
  id: string;
  path: Array<string | number>;
}

export interface JourneyIssue {
  path: Array<string | number>;
  message: string;
  warning?: true;
}

type SequenceStopRef = { stopId?: string; action: "board" | "alight" };

/** WHY: what the push checks a journey dataset against, gathered by the data tool from the target environment. */
export interface JourneyCatalog {
  /** WHY: a stop or pole id's coords through the stop index, null without them, undefined for no stop; null when no `bus-stops` is stored. */
  stopCoordsOf: ((stopId: string) => LatLng | null | undefined) | null;
  /** WHY: each stored building's point by its `_id` as a string, null for one without; null when `buildings` was not read. */
  buildingCoords: ReadonlyMap<string, LatLng | null> | null;
  /** WHY: each served subway station's stored coords, null for a station without them. */
  stationCoords: ReadonlyMap<string, LatLng | null>;
  platformIdsByStation: ReadonlyMap<string, ReadonlySet<string>>;
  /** WHY: `bus-stops` sequences, service id to route type to stops; null when no `bus-stops` is stored. */
  sequencesByService: Readonly<Record<string, Readonly<Record<string, readonly SequenceStopRef[]>>>> | null;
  /** WHY: why the stored `subway-timetables` refuse a subway ride, null when they accept it; null when none is stored. */
  subwayRideIssueOf: ((ride: { lineId: string; boardPlatformId: string; alightPlatformId: string }) => string | null) | null;
  /** WHY: why the stored registry refuses a TOPIS ride (a stop off the route, or the alight not after the board), null when it accepts it; null when unread. */
  topisRideIssueOf: ((ride: { lineId: string; boardStopId: string; alightStopId: string }) => string | null) | null;
}
