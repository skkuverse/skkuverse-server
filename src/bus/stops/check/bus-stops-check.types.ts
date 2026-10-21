import type { LaneStrategies } from "../../eta/lane/bus-eta-lane.types";
import type { EtaOptIns } from "../bus-stops.types";

export interface BusStopsIssue {
  path: Array<string | number>;
  message: string;
}

/** WHY: what the checked-out code serves, which a push is checked against. */
export interface BusStopsCheckContext {
  knownServiceIds: ReadonlySet<string>;
  optIns: EtaOptIns;
  stationIds: ReadonlySet<string>;
  laneStrategies: LaneStrategies;
}
