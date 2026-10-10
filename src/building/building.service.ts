import { Injectable } from "@nestjs/common";
import type { SupportedLang } from "../infra/types";
import { BUILDING_SEARCH_LIMIT, SPACE_SEARCH_LIMIT } from "./building-search.rules";
import type { BuildingDoc, CampusShapeDoc } from "./building.document";
import { groupSpacesByBuilding, withCampusLabel, withFloorEnFallback } from "./building.mapper";
import { BuildingRepository } from "./building.repository";
import type {
  BuildingDetail,
  BuildingSearch,
  Campus,
  WithCampusLabel,
} from "./building.types";

@Injectable()
export class BuildingService {
  constructor(private readonly repository: BuildingRepository) {}

  /** GET /building/list: every building, or one campus's, each with its campus label. */
  async list(
    campus: Campus | null,
    lang: SupportedLang,
  ): Promise<{ buildings: Array<WithCampusLabel<BuildingDoc>> }> {
    const buildings = await this.repository.getAllBuildings(campus);
    return { buildings: buildings.map((b) => withCampusLabel(b, lang)) };
  }

  /**
   * GET /building/search: ranked buildings and rooms. Rooms are grouped by
   * building and joined to its skkuId; `meta` carries the counts (campus-agnostic,
   * for the app's campus toggle) and the row caps.
   */
  async search(q: string, campus: Campus | null, lang: SupportedLang): Promise<BuildingSearch> {
    // Rows and counts arrive together (one $facet per collection), so the
    // count cannot describe a different predicate than the list.
    const [buildingResult, spaceResult, allBuildings] = await Promise.all([
      this.repository.searchBuildings(q, campus),
      this.repository.searchSpaces(q, campus),
      this.repository.getAllBuildings(),
    ]);

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

  /** GET /building/:skkuId: the building, its floors and connections; null if there is none. */
  async detail(skkuId: number, lang: SupportedLang): Promise<BuildingDetail | null> {
    const building = await this.repository.getBuildingBySkkuId(skkuId);
    if (!building) return null;
    const [floors, connections] = await Promise.all([
      this.repository.getFloorsByBuildNo(building.buildNo),
      this.repository.getConnectionsForBuilding(skkuId),
    ]);
    return {
      building: withCampusLabel(building, lang),
      floors: withFloorEnFallback(floors),
      connections,
    };
  }

  // --- Exported to MapService (the campus map overlay) ---

  getAllBuildings(): Promise<BuildingDoc[]> {
    return this.repository.getAllBuildings();
  }

  getAllCampusShapes(): Promise<CampusShapeDoc[]> {
    return this.repository.getAllCampusShapes();
  }
}
