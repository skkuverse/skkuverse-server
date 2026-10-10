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

export { groupSpacesByBuilding, toBuildingSearch };
