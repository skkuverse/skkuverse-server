import { Injectable } from "@nestjs/common";
import type { BuildingDoc, CampusShapeDoc } from "./building.document";
import { BuildingRepository } from "./building.repository";

/**
 * The door other features read building through (ESLint lets them import
 * only a module's `.module` and `.service`): the cached building list and the
 * campus shapes, for map. The building flows inject BuildingRepository.
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
