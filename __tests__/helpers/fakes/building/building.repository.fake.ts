/**
 * In-memory BuildingRepository: the building list and the campus shapes, with
 * the real reads' campus filter, projection and sort (pinned in
 * building.repository.spec.ts). `failWith` makes the next
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

  async listBuildings(campus?: Campus): Promise<readonly BuildingDoc[]> {
    if (this.failWith) throw this.failWith;
    return [...this.buildings]
      .filter((b) => !campus || b.campus === campus)
      .sort((a, b) => a._id - b._id)
      .map(({ extensions: _extensions, sync: _sync, enrichVersion: _enrichVersion, ...projected }) => projected);
  }

  /** Seed valid shapes: leaving out and logging an invalid one is the real repository's. */
  async listCampusShapes(): Promise<readonly CampusShapeDoc[]> {
    if (this.failWith) throw this.failWith;
    return [...this.campusShapes].sort((a, b) => a.order - b.order || String(a._id).localeCompare(String(b._id)));
  }

  clearCache(): void {
    this.cacheClears++;
  }
}
