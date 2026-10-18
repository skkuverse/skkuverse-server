import type { JongroRoute } from "../bus.types";
import type { JongroRoutePathDocument } from "./bus-route-path.document";
import { toPathVersion } from "./bus-route-path.rules";
import type { RoutePathSeedEntry, TopisRoutePoint, TopisRouteStation } from "./bus-route-path.schema";
import type { FetchedRoutePath, RoutePath } from "./bus-route-path.types";

export function toFetchedRoutePath(points: readonly TopisRoutePoint[], stations: readonly TopisRouteStation[]): FetchedRoutePath {
  return {
    path: [...points].sort((a, b) => a.no - b.no).map((point) => [point.gpsX, point.gpsY]),
    stations: [...stations]
      .sort((a, b) => a.seq - b.seq)
      .map((s) => ({ topisId: s.station, arsId: s.arsId, stationName: s.stationNm, sequence: s.seq, lng: s.gpsX, lat: s.gpsY, isTurnaround: s.transYn === "Y" })),
  };
}

export function toSeedRoutePath(entry: RoutePathSeedEntry): FetchedRoutePath {
  return {
    path: entry.path.map(([lng, lat]) => [lng, lat]),
    stations: entry.stations.map((station, index) => ({ ...station, sequence: index + 1 })),
  };
}

export function toRoutePathDocument(route: Pick<JongroRoute, "id" | "busRouteId">, fetched: FetchedRoutePath, syncedAt: Date): JongroRoutePathDocument {
  return { _id: route.id, busRouteId: route.busRouteId, path: fetched.path, stations: fetched.stations, pathVersion: toPathVersion(fetched), syncedAt };
}

export function toRoutePath(route: Pick<JongroRoute, "id" | "code">, content: FetchedRoutePath): RoutePath {
  return { routeId: route.id, code: route.code, path: content.path, stations: content.stations };
}
