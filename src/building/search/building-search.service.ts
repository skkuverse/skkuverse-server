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

  async search(keyword: string, campus: Campus | undefined, lang: SupportedLang): Promise<BuildingSearch> {
    const [buildings, spaces, allBuildings] = await Promise.all([
      this.repository.searchBuildings(keyword, campus),
      this.repository.searchSpaces(keyword, campus),
      this.buildings.listBuildings(),
    ]);
    return toBuildingSearch({ keyword, buildings, spaces }, allBuildings, lang);
  }
}
