import type { LatLng } from "../../../shared/lat-lng.types";
import type { EtaSequence } from "../bus-eta.types";

/** WHY: southbound runs from the Hannam IC end toward Singal JC, the direction along-distance grows in. */
export type LaneDirection = "southbound" | "northbound";

export type SequenceStrategy = { strategy: "car" } | { strategy: "busLane"; direction: LaneDirection };

export interface LaneHours {
  /** WHY: HH:mm in KST, compared with a run's departure. */
  from: string;
  to: string;
}

export interface CorridorBoundary {
  name: string;
  /** WHY: meters from the first centerline vertex, summed vertex to vertex. */
  alongM: number;
}

export interface LaneCorridor {
  centerline: LatLng[];
  boundaries: CorridorBoundary[];
}

export interface CorridorEnds {
  entry: LatLng;
  exit: LatLng;
}

/** WHY: TOPIS `sectOrd` values, inclusive; section N runs from station N to station N+1. */
export interface SectionRange {
  from: number;
  to: number;
}

export interface ProbeRoute {
  routeId: string;
  name: string;
  sectOrds: Record<LaneDirection, SectionRange>;
}

export interface LaneConfig {
  laneHours: LaneHours;
  /** WHY: serviceId → routeType → strategy; a sequence left out is `car`. */
  strategies: Record<string, Record<string, SequenceStrategy>>;
  corridor: LaneCorridor;
  entryExit: Record<LaneDirection, CorridorEnds>;
  probeRoutes: ProbeRoute[];
}

export interface LaneConfigIssue {
  path: Array<string | number>;
  message: string;
}

export type SequenceKey = Pick<EtaSequence, "serviceId" | "routeType">;

export interface LegBounds {
  fromAlongM: number;
  toAlongM: number;
}
