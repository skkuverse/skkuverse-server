import type { RegistryRoute } from "../../registry/bus-registry.types";

/** WHY: what the live route knows of each bus beyond one arrival row: the station whose stop it stands at, its last-bus flag, and whether any row names it. */
export interface JongroVehicleStates {
  standingStationIndexById: ReadonlyMap<string, number>;
  lastBusIds: ReadonlySet<string>;
  namedVehicleIds: ReadonlySet<string>;
}

/** WHY: what places an arrival row as a live station: its route's stations, the stop aliases and the named buses' states. */
export interface JongroStationContext {
  route: RegistryRoute;
  stopIdByArsId: ReadonlyMap<string, string>;
  states: JongroVehicleStates;
}
