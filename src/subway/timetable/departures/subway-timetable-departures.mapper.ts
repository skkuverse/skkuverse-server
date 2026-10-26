import { toPlaceAction } from "../../../shared/place.util";
import type { Place } from "../../../shared/place.wire";
import { SUBWAY_STATIONS } from "../../subway.constants";
import type { ScheduledTrain } from "../subway-timetable.types";
import type { RideStopCatalog } from "./subway-timetable-departures.types";

// WHY: a served station keeps its slug and tap action; a neighbor its station id and no action. A neighbor without a name is no
// place, so the ride lists no stops rather than a Korean Seoul name in another language.
export function toRideStopPlace(platformId: string, { registry, coordsOf, lang }: RideStopCatalog): Place | null {
  const served = SUBWAY_STATIONS.find((station) => station.platforms.some((platform) => platform.id === platformId));
  if (served) {
    const coords = coordsOf(served.id);
    return coords && { kind: "subway_station", id: served.id, name: served.name[lang], coords, platformId, action: toPlaceAction("subway_station", served.id) };
  }
  const neighbor = registry.neighbors[platformId];
  if (neighbor?.stationId === undefined || neighbor.coords === undefined || neighbor.name === undefined) return null;
  return { kind: "subway_station", id: neighbor.stationId, name: neighbor.name[lang], coords: neighbor.coords, platformId, action: null };
}

// WHY: the train's own row, so an express lists only the platforms it calls at (ADR 0022, D5); never a partial list.
export function toRideStops(train: ScheduledTrain, [boardPlatformId, alightPlatformId]: readonly [string, string], placeOf: (platformId: string) => Place | null): Place[] | null {
  const platformIds = train.stops.map((stop) => stop.platformId);
  const boardIndex = platformIds.indexOf(boardPlatformId);
  const alightIndex = boardIndex === -1 ? -1 : platformIds.indexOf(alightPlatformId, boardIndex + 1);
  if (alightIndex === -1) return null;
  const places = platformIds.slice(boardIndex + 1, alightIndex).map(placeOf);
  return places.every((place): place is Place => place !== null) ? places : null;
}
