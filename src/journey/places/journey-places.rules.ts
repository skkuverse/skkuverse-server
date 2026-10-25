import type { LatLng } from "../../shared/lat-lng.types";
import { JOURNEY_PLACE_KINDS } from "../journey.constants";
import type { JourneyRoutesData } from "../journey.document";
import { toCitedPlaces, toPlaceRef } from "../journey.rules";
import type { CitedPlace, JourneyCatalog, JourneyIssue, PlaceKind, PlaceRef } from "../journey.types";

type Lookup = { coords: LatLng | null } | { message: string; warning?: true };

const KINDS_BY_ROLE: Readonly<Record<CitedPlace["role"], readonly PlaceKind[]>> = {
  routeEnd: ["skku_building", "bus_stop_area"],
  rideStop: ["bus_stop", "subway_station"],
  walkEnd: JOURNEY_PLACE_KINDS,
  transferAt: ["subway_station"],
};

type CoordsOf = (id: string) => LatLng | null | undefined;

const fromMap = (coordsById: ReadonlyMap<string, LatLng | null> | null): CoordsOf | null => coordsById && ((id) => (coordsById.has(id) ? (coordsById.get(id) ?? null) : undefined));

function lookUp(coordsOf: CoordsOf | null, id: string, [unread, unknown]: [string, string]): Lookup {
  if (coordsOf === null) return { message: unread, warning: true };
  const coords = coordsOf(id);
  return coords === undefined ? { message: unknown } : { coords };
}

// WHY: each kind resolves through its owning catalog in the target environment (ADR 0022, D4); no option needs a stop
// area yet, so the planner resolves none and the push refuses one.
function lookUpPlace({ kind, id }: PlaceRef, catalog: JourneyCatalog): Lookup {
  if (kind === "bus_stop") return lookUp(catalog.stopCoordsOf, id, ["no stored bus-stops, so the stop was not resolved", `"${id}" is not a stop of bus-stops`]);
  if (kind === "skku_building") return lookUp(fromMap(catalog.buildingCoords), id, ["buildings was not read, so the building was not resolved", `"${id}" is not a stored building`]);
  if (kind === "subway_station") return lookUp(fromMap(catalog.stationCoords), id, ["", `"${id}" is not a station the checked-out code serves`]);
  return { message: `"${id}" is a stop area, which the planner does not resolve yet` };
}

function platformIssues({ ref, path, role, platformId }: CitedPlace, place: PlaceRef, catalog: JourneyCatalog): JourneyIssue[] {
  const isSubwayStop = place.kind === "subway_station" && role !== "walkEnd";
  if (!isSubwayStop) return platformId === null ? [] : [{ path, message: `${ref} names a platform, which only a boarded or alighted subway station does` }];
  if (platformId === null) return [{ path, message: `${ref} is boarded or alighted, so it names its platform` }];
  return catalog.platformIdsByStation.get(place.id)?.has(platformId) ? [] : [{ path, message: `${platformId} is no platform of ${ref}` }];
}

function citedIssues(cited: CitedPlace, catalog: JourneyCatalog): JourneyIssue[] {
  const place = toPlaceRef(cited.ref);
  if (place === null) return [];
  const allowed = KINDS_BY_ROLE[cited.role];
  if (!allowed.includes(place.kind)) return [{ path: cited.path, message: `a ${place.kind} cannot stand here; expected ${allowed.join(" or ")}` }];
  const found = lookUpPlace(place, catalog);
  if ("message" in found) return [{ path: cited.path, message: found.message, ...(found.warning && { warning: found.warning }) }];
  const coordsIssues = found.coords === null ? [{ path: cited.path, message: `${cited.ref} has no coords in its catalog` }] : [];
  return [...coordsIssues, ...platformIssues(cited, place, catalog)];
}

/** WHY: every cited place stands where its kind may, resolves in its owning catalog, has coords, and names a platform only where one is boarded. */
export function toPlaceIssues(data: JourneyRoutesData, catalog: JourneyCatalog): JourneyIssue[] {
  return toCitedPlaces(data).flatMap((cited) => citedIssues(cited, catalog));
}
