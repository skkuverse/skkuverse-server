import type { SkkuId } from "../building.types";
import type { PlaceBuilding, PlaceSpace } from "./building-place.document";
import type { PlaceLexicon } from "./building-place.schema";
import type { IndexedPlace, IndexedSpace, PlaceIndex } from "./building-place.types";

interface PlaceSkkumap { buildings: readonly PlaceBuilding[]; spaces: readonly PlaceSpace[] }

function toIndexedSpaces(spaces: readonly PlaceSpace[]): IndexedSpace[] {
  return spaces.flatMap(({ spaceCd, buildNo, campus }) => (spaceCd ? [{ spaceCd, buildNo, campus }] : []));
}

function groupBy<T>(rows: readonly T[], keyOf: (row: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const group = groups.get(keyOf(row));
    if (group) group.push(row);
    else groups.set(keyOf(row), [row]);
  }
  return groups;
}

function toListedPlaces(buildings: readonly PlaceBuilding[], lexicon: PlaceLexicon): { places: IndexedPlace[]; unpinned: SkkuId[] } {
  const places: IndexedPlace[] = [];
  const unpinned: SkkuId[] = [];
  for (const { _id, buildNo, campus, name } of buildings) {
    const slug = buildNo ? null : (lexicon.facilitySlugs[String(_id)] ?? null);
    if (!buildNo && !slug) unpinned.push(_id);
    else places.push({ key: buildNo ?? `${campus}:${slug}`, campus, name: name.ko, buildNo, slug });
  }
  return { places, unpinned };
}

// QUIRK(skku): some buildings are listed only through their spaces (`E-하우스`), named by the spaces' buildingName.
function toSpaceOnlyPlaces(spaces: readonly PlaceSpace[], knownKeys: ReadonlySet<string>): IndexedPlace[] {
  const places = new Map<string, IndexedPlace>();
  for (const { buildNo, campus, buildingName } of spaces) {
    if (!knownKeys.has(buildNo) && !places.has(buildNo)) places.set(buildNo, { key: buildNo, campus, name: buildingName?.ko ?? buildNo, buildNo, slug: null });
  }
  return [...places.values()];
}

function toPlaces({ buildings, spaces }: PlaceSkkumap, lexicon: PlaceLexicon): { places: IndexedPlace[]; unpinned: SkkuId[] } {
  const { places, unpinned } = toListedPlaces(buildings, lexicon);
  const extras = lexicon.extraFacilities.map(({ campus, slug, name }) => ({ key: `${campus}:${slug}`, campus, name: name.ko, buildNo: null, slug }));
  const listed = [...places, ...extras];
  return { places: [...listed, ...toSpaceOnlyPlaces(spaces, new Set(listed.map((p) => p.key)))], unpinned };
}

export function toPlaceIndex(skkumap: PlaceSkkumap, lexicon: PlaceLexicon): PlaceIndex {
  const { places, unpinned } = toPlaces(skkumap, lexicon);
  return {
    placeByKey: new Map(places.map((p) => [p.key, p])),
    spacesByCd: groupBy(toIndexedSpaces(skkumap.spaces), (s) => s.spaceCd.toUpperCase()),
    unpinnedFacilities: unpinned,
  };
}
