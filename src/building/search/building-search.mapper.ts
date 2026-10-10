import type { SupportedLang } from "../../infra/types";
import type { BuildingDoc, SpaceDoc } from "../building.document";
import { campusLabel, withCampusLabel, withEnFallback } from "../building.mapper";
import { toDisplayNo } from "../building.rules";
import type { BuildNo, SkkuId } from "../building.types";
import { BUILDING_SEARCH_LIMIT, SPACE_SEARCH_LIMIT } from "./building-search.rules";
import type { BuildingSearch, RankedSearchResult, SpaceGroup } from "./building-search.types";

/**
 * Search rooms grouped by building, in row order so the relevance ranking
 * survives grouping. `skkuIdByBuildNo` joins each group to its building.
 */
function groupSpacesByBuilding(
  spaces: readonly SpaceDoc[],
  skkuIdByBuildNo: ReadonlyMap<BuildNo, SkkuId>,
  lang: SupportedLang,
): SpaceGroup[] {
  const spaceGroupByBuildNo = new Map<string, SpaceGroup>();
  for (const spaceDoc of spaces) {
    const space = {
      ...spaceDoc,
      name: withEnFallback(spaceDoc.name),
      buildingName: withEnFallback(spaceDoc.buildingName),
      floor: withEnFallback(spaceDoc.floor),
    };
    let group = spaceGroupByBuildNo.get(space.buildNo);
    if (!group) {
      group = {
        skkuId: skkuIdByBuildNo.get(space.buildNo) || null,
        buildNo: space.buildNo,
        displayNo: toDisplayNo(space.buildNo, space.campus),
        campus: space.campus,
        campusLabel: campusLabel(space.campus, lang),
        buildingName: space.buildingName,
        items: [],
      };
      spaceGroupByBuildNo.set(space.buildNo, group);
    }
    group.items.push({ spaceCd: space.spaceCd, name: space.name, floor: space.floor });
  }
  return [...spaceGroupByBuildNo.values()];
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
  const skkuIdByBuildNo = new Map<BuildNo, SkkuId>(
    allBuildings
      .filter((b): b is BuildingDoc & { buildNo: BuildNo } => !!b.buildNo)
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

export { toBuildingSearch };
