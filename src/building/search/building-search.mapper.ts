import type { SupportedLang } from "../../infra/types";
import type { BuildingDoc, SpaceDoc } from "../building.document";
import { campusLabel, withCampusLabel, withEnFallback } from "../building.mapper";
import { hasBuildNo, toDisplayNo } from "../building.rules";
import type { BuildNo, SkkuId } from "../building.types";
import { BUILDING_SEARCH_LIMIT, SPACE_SEARCH_LIMIT } from "./building-search.rules";
import type { BuildingSearch, RankedSearchResult, SearchLimit, SpaceGroup } from "./building-search.types";

/** Groups keep first-seen order, so the relevance ranking survives grouping. */
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

interface RankedSearch {
  keyword: string;
  buildings: RankedSearchResult<BuildingDoc>;
  spaces: RankedSearchResult<SpaceDoc>;
}

function toSkkuIdByBuildNo(allBuildings: readonly BuildingDoc[]): Map<BuildNo, SkkuId> {
  return new Map(allBuildings.filter(hasBuildNo).map((building) => [building.buildNo, building._id]));
}

function toSearchLimit(limit: number, result: RankedSearchResult<unknown>): SearchLimit {
  return { limit, total: result.total, truncated: result.truncated };
}

function toBuildingSearch(
  { keyword, buildings: buildingResult, spaces: spaceResult }: RankedSearch,
  allBuildings: readonly BuildingDoc[],
  lang: SupportedLang,
): BuildingSearch {
  return {
    data: {
      buildings: buildingResult.items.map((b) => withCampusLabel(b, lang)),
      spaces: groupSpacesByBuilding(spaceResult.items, toSkkuIdByBuildNo(allBuildings), lang),
    },
    meta: {
      keyword,
      buildingCount: buildingResult.items.length,
      spaceCount: spaceResult.items.length,
      counts: { building: buildingResult.counts, space: spaceResult.counts },
      // The app's parseBuildingSearchResult ignores unknown keys, so meta can grow.
      limits: {
        building: toSearchLimit(BUILDING_SEARCH_LIMIT, buildingResult),
        space: toSearchLimit(SPACE_SEARCH_LIMIT, spaceResult),
      },
    },
  };
}

export { toBuildingSearch };
