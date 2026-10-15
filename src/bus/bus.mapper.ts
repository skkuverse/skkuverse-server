import { JONGRO_ROUTE_ID_PREFIX, SEOUL_BUS_API_URL } from "./bus.constants";
import type { JongroRoute, JongroStation, JongroStationMapping } from "./bus.types";
import type { JongroRoutesFile } from "./bus.wire";

type JongroRouteEntry = JongroRoutesFile[number];
type JongroRouteStation = JongroRouteEntry["stations"][number];

export function toJongroArrivalsUrl(busRouteId: string, serviceKey: string): string {
  return `${SEOUL_BUS_API_URL}/arrive/getArrInfoByRouteAll?serviceKey=${serviceKey}&busRouteId=${busRouteId}&resultType=json`;
}

export function toJongroPositionsUrl(
  busRouteId: string,
  stationCount: number,
  serviceKey: string,
): string {
  return `${SEOUL_BUS_API_URL}/buspos/getBusPosByRouteSt?serviceKey=${serviceKey}&busRouteId=${busRouteId}&startOrd=1&endOrd=${stationCount}&resultType=json`;
}

function toJongroStations(stations: readonly JongroRouteStation[]): JongroStation[] {
  return stations.map((station, index) => ({
    sequence: String(index + 1),
    stationName: station.stationName,
    stationNumber: station.arsId,
    isFirstStation: station.isFirstStation,
    isLastStation: station.isLastStation,
    isRotationStation: station.isRotationStation,
    transferLines: station.transferLines.map((t) => ({ line: t.line, color: t.color })),
  }));
}

// WHY: the first ord wins a loop-closing repeat: a bus whose last passed stop is the terminal has just left it.
function toStationMapping(stations: readonly JongroRouteStation[]): JongroStationMapping {
  // WHY: no prototype, so a TOPIS id that names an Object.prototype member (`constructor`) maps to nothing.
  const mapping: JongroStationMapping = Object.create(null);
  stations.forEach((station, index) => {
    mapping[station.topisId] ??= { sequence: index + 1, stationName: station.stationName };
  });
  return mapping;
}

export function toJongroRoute(entry: JongroRouteEntry, serviceKey: string): JongroRoute {
  return {
    id: entry.id,
    code: entry.id.slice(JONGRO_ROUTE_ID_PREFIX.length),
    busRouteId: entry.busRouteId,
    themeColor: entry.themeColor,
    iconType: entry.iconType,
    refreshInterval: entry.refreshInterval,
    arrivalsUrl: toJongroArrivalsUrl(entry.busRouteId, serviceKey),
    positionsUrl: toJongroPositionsUrl(entry.busRouteId, entry.stations.length, serviceKey),
    stations: toJongroStations(entry.stations),
    mapping: toStationMapping(entry.stations),
    topisIds: entry.stations.map((s) => s.topisId),
  };
}
