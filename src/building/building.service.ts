import { Injectable } from "@nestjs/common";
import type { BuildingDoc, CampusShapeDoc } from "./building.document";
import { BuildingRepository } from "./building.repository";

/**
 * What other modules and the building flows read through DI: the cached
 * building list (map, building search) and the campus shapes (map).
 */
@Injectable()
export class BuildingService {
  constructor(private readonly repository: BuildingRepository) {}

  /** Every building, unlabeled. */
  listAllBuildings(): Promise<readonly BuildingDoc[]> {
    return this.repository.listBuildings();
  }

  /** Every campus outline. */
  listAllCampusShapes(): Promise<readonly CampusShapeDoc[]> {
    return this.repository.listCampusShapes();
  }
}
