import { Injectable } from "@nestjs/common";
import type { BuildingDoc, CampusShapeDoc } from "./building.document";
import { BuildingRepository } from "./building.repository";

// SEE: docs/decisions/0010-server-architecture.md (D1): the door for other features, which may
// import only a .module or a .service; building's own flows inject BuildingRepository.
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
