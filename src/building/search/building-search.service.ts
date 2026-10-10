import { Injectable } from "@nestjs/common";
import type { SupportedLang } from "../../infra/types";
import { BuildingRepository } from "../building.repository";
import type { Campus } from "../building.types";
import { toBuildingSearch } from "./building-search.mapper";
import { BuildingSearchRepository } from "./building-search.repository";
import type { BuildingSearch } from "./building-search.types";

@Injectable()
export class BuildingSearchService {
  constructor(
    private readonly repository: BuildingSearchRepository,
    private readonly buildings: BuildingRepository,
  ) {}

  /**
   * GET /building/search: ranked buildings and rooms. Rooms are grouped by
   * building and joined to its skkuId; `meta` carries the counts (campus-agnostic,
   * for the app's campus toggle) and the row caps.
   */
  async search(keyword: string, campus: Campus | null, lang: SupportedLang): Promise<BuildingSearch> {
    // Rows and counts arrive together (one $facet per collection), so the
    // count cannot describe a different predicate than the list.
    const [buildings, spaces, allBuildings] = await Promise.all([
      this.repository.searchBuildings(keyword, campus),
      this.repository.searchSpaces(keyword, campus),
      this.buildings.listBuildings(),
    ]);
    return toBuildingSearch({ keyword, buildings, spaces }, allBuildings, lang);
  }
}
