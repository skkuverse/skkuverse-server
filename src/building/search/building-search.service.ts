import { Injectable } from "@nestjs/common";
import type { SupportedLang } from "../../infra/types";
import { BuildingService } from "../building.service";
import type { Campus } from "../building.types";
import { toBuildingSearch } from "./building-search.mapper";
import { BuildingSearchRepository } from "./building-search.repository";
import type { BuildingSearch } from "./building-search.types";

@Injectable()
export class BuildingSearchService {
  constructor(
    private readonly repository: BuildingSearchRepository,
    private readonly buildings: BuildingService,
  ) {}

  /**
   * GET /building/search: ranked buildings and rooms. Rooms are grouped by
   * building and joined to its skkuId; `meta` carries the counts (campus-agnostic,
   * for the app's campus toggle) and the row caps.
   */
  async search(keyword: string, campus: Campus | null, lang: SupportedLang): Promise<BuildingSearch> {
    // Rows and counts arrive together (one $facet per collection), so the
    // count cannot describe a different predicate than the list.
    const [buildingResult, spaceResult, allBuildings] = await Promise.all([
      this.repository.searchBuildings(keyword, campus),
      this.repository.searchSpaces(keyword, campus),
      this.buildings.listAllBuildings(),
    ]);
    return toBuildingSearch(keyword, buildingResult, spaceResult, allBuildings, lang);
  }
}
