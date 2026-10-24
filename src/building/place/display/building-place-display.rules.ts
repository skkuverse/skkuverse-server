import { toDisplayNo } from "../../building.rules";
import type { Campus } from "../../building.types";
import type { PinnedPlace, PlaceId, PlaceIndex, ResolvedPlace } from "../building-place.types";
import type { CampusBuilding, CampusPrimaryPlace, PlaceDisplay } from "./building-place-display.types";

// WHY: the owner's order for a session's pin: a room says the most, then a building, then a facility.
const SPECIFICITY: Readonly<Record<PinnedPlace["kind"], number>> = { space: 0, building: 1, facility: 2 };

const isPinned = (place: ResolvedPlace): place is PinnedPlace => place.kind !== "unresolved";

export function toPlaceId(place: PinnedPlace): PlaceId {
  if (place.kind === "space") return `space:${place.campus}:${place.spaceCd}`;
  if (place.kind === "building") return `building:${place.campus}:${place.buildNo}`;
  return `facility:${place.campus}:${place.slug}`;
}

function toBuildingDisplay(buildNo: string | undefined, campus: Campus, index: PlaceIndex): PlaceDisplay | null {
  const building = buildNo ? index.placeByKey.get(buildNo) : undefined;
  if (!building || building.campus !== campus) return null;
  const displayNo = toDisplayNo(building.buildNo, building.campus);
  return displayNo ? { name: building.name, code: displayNo } : { name: building.name };
}

export function toPlaceDisplay(place: PinnedPlace, index: PlaceIndex): PlaceDisplay | null {
  if (place.kind === "building") return toBuildingDisplay(place.buildNo, place.campus, index);
  if (place.kind === "facility") {
    const facility = index.placeByKey.get(`${place.campus}:${place.slug}`);
    return facility ? { name: facility.name } : null;
  }
  const space = index.spacesByCd.get(place.spaceCd.toUpperCase())?.find((s) => s.campus === place.campus);
  const building = toBuildingDisplay(space?.buildNo, place.campus, index);
  return building ? { name: building.name, code: place.spaceCd } : null;
}

export function buildingOf(place: ResolvedPlace): CampusBuilding | null {
  if (place.kind !== "space" && place.kind !== "building") return null;
  return { campus: place.campus, buildNo: place.buildNo };
}

export function pickPrimaryPlace(places: readonly ResolvedPlace[]): number | null {
  let primary: number | null = null;
  places.forEach((place, at) => {
    const current = primary === null ? undefined : places[primary];
    if (isPinned(place) && (!current || !isPinned(current) || SPECIFICITY[place.kind] < SPECIFICITY[current.kind])) primary = at;
  });
  return primary;
}

export function pickPrimaryPlacesByCampus(places: readonly ResolvedPlace[]): CampusPrimaryPlace[] {
  const campuses = [...new Set(places.filter(isPinned).map((p) => p.campus))];
  return campuses.map((campus: Campus) => {
    const onCampus = places.map((place) => (isPinned(place) && place.campus === campus ? place : null));
    const pinnedCount = onCampus.filter((p) => p !== null).length;
    const placeIndex = pickPrimaryPlace(onCampus.map((p) => p ?? { kind: "unresolved", reason: "unknown", campus: null })) ?? 0;
    return { campus, placeIndex, otherCount: pinnedCount - 1 };
  });
}
