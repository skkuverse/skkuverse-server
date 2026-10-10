import { BUILDING_SEARCH_LIMIT, SPACE_SEARCH_LIMIT, type RankedSearchResult } from "./building-search.rules";
import { floorSortKey, toDisplayNo } from "./building.rules";
import type { BuildingDoc, ConnectionDoc, SpaceDoc } from "./building.document";
import { t } from "../infra/i18n";
import type { SupportedLang } from "../infra/types";
import type {
  BilingualText,
  BuildingConnection,
  BuildingSearch,
  Campus,
  FloorGroup,
  SpaceGroup,
  WithCampusLabel,
} from "./building.types";

/** A building's spaces grouped by floor, lowest floor first (floorSortKey). */
function groupByFloor(
  spaces: ReadonlyArray<Pick<SpaceDoc, "spaceCd" | "name" | "floor" | "conspaceCd">>,
): FloorGroup[] {
  const floorMap = new Map<string, FloorGroup>();
  for (const s of spaces) {
    const key = s.floor?.ko || "unknown";
    if (!floorMap.has(key)) {
      floorMap.set(key, { floor: s.floor, spaces: [] });
    }
    floorMap.get(key)!.spaces.push({
      spaceCd: s.spaceCd,
      name: s.name,
      conspaceCd: s.conspaceCd,
    });
  }
  return Array.from(floorMap.values()).sort(
    (a, b) => floorSortKey(a.floor?.ko) - floorSortKey(b.floor?.ko),
  );
}

/**
 * Connections as seen from `skkuId`. A connection doc is undirected (a/b), so
 * the side matching `skkuId` is "from" and the other is the target, named from
 * `targets` (the other buildings' docs).
 */
function toConnectionItems(
  skkuId: number,
  docs: readonly ConnectionDoc[],
  targets: ReadonlyArray<Pick<BuildingDoc, "_id" | "buildNo" | "displayNo" | "name">>,
): BuildingConnection[] {
  const buildingMap = new Map(targets.map((b) => [b._id, b]));
  return docs.map((doc) => {
    const isA = doc.a.skkuId === skkuId;
    const self = isA ? doc.a : doc.b;
    const other = isA ? doc.b : doc.a;
    const target = buildingMap.get(other.skkuId);
    return {
      targetSkkuId: other.skkuId,
      targetBuildNo: target?.buildNo || null,
      targetDisplayNo: target?.displayNo || null,
      targetName: target?.name || { ko: "", en: "" },
      fromFloor: self.floor,
      toFloor: other.floor,
    };
  });
}

function campusLabel(campus: Campus, lang: SupportedLang): string {
  return t(`map.campus.${campus}.label`, lang);
}

function withCampusLabel<T extends { campus: Campus }>(item: T, lang: SupportedLang): WithCampusLabel<T> {
  return { ...item, campusLabel: campusLabel(item.campus, lang) };
}

/** An empty English side shows the Korean one. */
function withEnFallback<T extends Partial<BilingualText> | undefined>(text: T): T {
  if (text && !text.en && text.ko) return { ...text, en: text.ko };
  return text;
}

/**
 * Search rooms grouped by building, in row order so the relevance ranking
 * survives grouping. `skkuIdByBuildNo` joins each group to its building.
 */
function groupSpacesByBuilding(
  spaces: readonly SpaceDoc[],
  skkuIdByBuildNo: ReadonlyMap<string, number>,
  lang: SupportedLang,
): SpaceGroup[] {
  const groups = new Map<string, SpaceGroup>();
  for (const space of spaces) {
    const s = {
      ...space,
      name: withEnFallback(space.name),
      buildingName: withEnFallback(space.buildingName),
      floor: withEnFallback(space.floor),
    };
    let group = groups.get(s.buildNo);
    if (!group) {
      group = {
        skkuId: skkuIdByBuildNo.get(s.buildNo) || null,
        buildNo: s.buildNo,
        displayNo: toDisplayNo(s.buildNo, s.campus),
        campus: s.campus,
        campusLabel: campusLabel(s.campus, lang),
        buildingName: s.buildingName,
        items: [],
      };
      groups.set(s.buildNo, group);
    }
    group.items.push({ spaceCd: s.spaceCd, name: s.name, floor: s.floor });
  }
  return [...groups.values()];
}

/** A building's floors with the English fallback applied to floor and space names. */
function withFloorEnFallback(floors: readonly FloorGroup[]): FloorGroup[] {
  return floors.map((f) => ({
    ...f,
    floor: withEnFallback(f.floor),
    spaces: f.spaces.map((s) => ({ ...s, name: withEnFallback(s.name) })),
  }));
}

/**
 * GET /building/search's `data` and extra `meta`. Rooms are grouped by
 * building and joined to its skkuId through `allBuildings`.
 */
function toBuildingSearch(
  q: string,
  buildingResult: RankedSearchResult<BuildingDoc>,
  spaceResult: RankedSearchResult<SpaceDoc>,
  allBuildings: readonly BuildingDoc[],
  lang: SupportedLang,
): BuildingSearch {
  const skkuIdByBuildNo = new Map<string, number>(
    allBuildings
      .filter((b): b is BuildingDoc & { buildNo: string } => !!b.buildNo)
      .map((b) => [b.buildNo, b._id]),
  );

  return {
    data: {
      buildings: buildingResult.items.map((b) => withCampusLabel(b, lang)),
      spaces: groupSpacesByBuilding(spaceResult.items, skkuIdByBuildNo, lang),
    },
    meta: {
      keyword: q,
      buildingCount: buildingResult.items.length,
      spaceCount: spaceResult.items.length,
      counts: { building: buildingResult.counts, space: spaceResult.counts },
      // Additive — the app's parseBuildingSearchResult reads only known keys.
      // The row caps sit above any realistic query (the largest building has
      // 801 rooms), which is what makes spaceCount and counts.space.total
      // agree; `truncated` records the cut on a pathological one-character
      // query rather than presenting it as the whole result.
      limits: {
        building: {
          limit: BUILDING_SEARCH_LIMIT,
          total: buildingResult.total,
          truncated: buildingResult.truncated,
        },
        space: {
          limit: SPACE_SEARCH_LIMIT,
          total: spaceResult.total,
          truncated: spaceResult.truncated,
        },
      },
    },
  };
}

export { groupByFloor, toBuildingSearch, toConnectionItems, withCampusLabel, withFloorEnFallback };
