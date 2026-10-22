import type { RegistryRoute } from "../../registry/bus-registry.types";

/** WHY: what the live route knows of each named bus beyond one arrival row: the station whose stop it stands at, and its last-bus flag. */
export interface JongroVehicleStates {
  standingStationIndexById: ReadonlyMap<string, number>;
  lastBusIds: ReadonlySet<string>;
}

/** WHY: what places an arrival row as a live station: its route's stations, the stop aliases and the named buses' states. */
export interface JongroStationContext {
  route: RegistryRoute;
  stopIdByArsId: ReadonlyMap<string, string>;
  states: JongroVehicleStates;
}
