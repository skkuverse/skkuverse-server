import { SEOUL_BUS_API_URL } from "../bus.constants";
import type { JongroRoute } from "../bus.types";
import type { JongroRouteDocument, RegistryStation } from "./bus-registry.document";
import type { JongroStation, JongroStationMapping, ObservedStation, RegistryRoute } from "./bus-registry.types";

export function toJongroPositionsUrl(busRouteId: string, stationCount: number, serviceKey: string): string {
  return `${SEOUL_BUS_API_URL}/buspos/getBusPosByRouteSt?serviceKey=${serviceKey}&busRouteId=${busRouteId}&startOrd=1&endOrd=${stationCount}&resultType=json`;
}

function toJongroStations(route: JongroRoute, doc: JongroRouteDocument): JongroStation[] {
  const last = doc.stations.length - 1;
  return doc.stations.map((station, index) => ({
    sequence: String(index + 1),
    stationName: station.stationName,
    stationNumber: station.arsId,
    isFirstStation: index === 0,
    isLastStation: index === last,
    isRotationStation: station.topisId === doc.turnaroundTopisId,
    transferLines: (route.transferLinesByArsId[station.arsId] ?? []).map((t) => ({ line: t.line, color: t.color })),
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

export function toRegistryRoute(route: JongroRoute, doc: JongroRouteDocument, serviceKey: string): RegistryRoute {
  return {
    ...route,
    stationsVersion: doc.stationsVersion,
    turnaroundTopisId: doc.turnaroundTopisId,
    registryStations: doc.stations,
    positionsUrl: toJongroPositionsUrl(route.busRouteId, doc.stations.length, serviceKey),
    stations: toJongroStations(route, doc),
    mapping: toStationMapping(doc.stations),
    topisIds: doc.stations.map((station) => station.topisId),
  };
}

export function toRegistryStations(stations: readonly ObservedStation[]): RegistryStation[] {
  return stations.map((station, index) => ({ ...station, sequence: index + 1 }));
}
