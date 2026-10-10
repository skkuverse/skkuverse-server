import { Injectable } from "@nestjs/common";
import type { BuildingDoc, CampusShapeDoc } from "./building.document";
import { BuildingRepository } from "./building.repository";

// The door for other features, which may import only a .module or a .service
// (ADR 0010, D1); building's own flows inject BuildingRepository.
@Injectable()
export class BuildingService {
  constructor(private readonly repository: BuildingRepository) {}

  listAllBuildings(): Promise<readonly BuildingDoc[]> {
    return this.repository.listBuildings();
  }

  listAllCampusShapes(): Promise<readonly CampusShapeDoc[]> {
    return this.repository.listCampusShapes();
  }
}
