import type { LatLng } from "../../shared/lat-lng.types";
import type { RoutePath } from "../route-path/bus-route-path.types";
import type { IndexedPole } from "./bus-stop-index.types";

export function toPoleCoords(poles: readonly IndexedPole[], routePaths: readonly RoutePath[]): LatLng | null {
  for (const pole of poles) {
    const station = routePaths.flatMap((routePath) => routePath.stations).find((candidate) => candidate.topisId === pole.topisId);
    if (station) return { lat: station.lat, lng: station.lng };
  }
  return null;
}
