/**
 * In-memory BuildingRepository: the building list and the campus shapes, with
 * the campus filter the real repository applies. `failWith` makes the next
 * reads reject, as a database error would.
 */
import type { BuildingRepository } from "../../../../src/building/building.repository";
import type { BuildingDoc, CampusShapeDoc } from "../../../../src/building/building.document";
import type { Campus } from "../../../../src/building/building.types";
import type { PublicOf } from "../public-of";

export class FakeBuildingRepository implements PublicOf<BuildingRepository> {
  buildings: BuildingDoc[] = [];
  campusShapes: CampusShapeDoc[] = [];
  cacheClears = 0;
  failWith: Error | null = null;

  async onModuleInit(): Promise<void> {}

  async ensureIndexes(): Promise<void> {}

  async listBuildings(campus?: Campus | null): Promise<readonly BuildingDoc[]> {
    if (this.failWith) throw this.failWith;
    return campus ? this.buildings.filter((b) => b.campus === campus) : this.buildings;
  }

  async listCampusShapes(): Promise<readonly CampusShapeDoc[]> {
    if (this.failWith) throw this.failWith;
    return this.campusShapes;
  }

  clearCache(): void {
    this.cacheClears++;
  }
}
