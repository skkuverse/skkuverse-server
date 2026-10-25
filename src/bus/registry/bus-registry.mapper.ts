import { isTopisPassThrough } from "../bus.rules";
import type { JongroRoute } from "../bus.types";
import type { JongroRouteDocument, RegistryStation } from "./bus-registry.document";
import type { JongroStation, JongroStationMapping, ObservedStation, RegistryRoute } from "./bus-registry.types";

function toJongroStations(doc: JongroRouteDocument): JongroStation[] {
  const last = doc.stations.length - 1;
  return doc.stations.map((station, index) => ({
    sequence: String(index + 1),
    stationName: station.stationName,
    stationNumber: station.arsId,
    topisId: station.topisId,
    isFirstStation: index === 0,
    isLastStation: index === last,
    isRotationStation: station.topisId === doc.turnaroundTopisId,
  }));
}

// WHY: the first ord wins a loop-closing repeat: a bus whose last passed stop is the terminal has just left it.
function toStationMapping(stations: readonly RegistryStation[]): JongroStationMapping {
  // WHY: no prototype, so a TOPIS id that names an Object.prototype member (`constructor`) maps to nothing.
  const mapping: JongroStationMapping = Object.create(null);
  stations.forEach((station, index) => {
    mapping[station.topisId] ??= { sequence: index + 1, stationName: station.stationName };
  });
  return mapping;
}

export function toRegistryRoute(route: JongroRoute, doc: JongroRouteDocument): RegistryRoute {
  return {
    ...route,
    stationsVersion: doc.stationsVersion,
    turnaroundTopisId: doc.turnaroundTopisId,
    registryStations: doc.stations,
    stations: toJongroStations(doc),
    mapping: toStationMapping(doc.stations),
    topisIds: doc.stations.map((station) => station.topisId),
    passThroughOrds: new Set(doc.stations.filter((station) => isTopisPassThrough(station.stationName)).map((station) => station.sequence)),
  };
}

export function toRegistryStations(stations: readonly ObservedStation[]): RegistryStation[] {
  return stations.map((station, index) => ({ ...station, sequence: index + 1 }));
}
