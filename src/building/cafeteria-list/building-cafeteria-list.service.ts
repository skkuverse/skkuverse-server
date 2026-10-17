import { Injectable } from "@nestjs/common";
import type { Campus } from "../building.types";
import type { ListedCafeteria } from "./building-cafeteria-list.document";
import { BuildingCafeteriaListRepository } from "./building-cafeteria-list.repository";

// SEE: docs/decisions/0010-server-architecture.md (D1): the door other features list cafeterias through.
@Injectable()
export class BuildingCafeteriaListService {
  constructor(private readonly repository: BuildingCafeteriaListRepository) {}

  listCafeterias(campus: Campus): Promise<readonly ListedCafeteria[]> {
    return this.repository.listCafeterias(campus);
  }
}
