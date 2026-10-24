/**
 * In-memory BuildingRepository: the building list and the campus shapes, with
 * the real reads' campus filter, projection and sort (pinned in
 * building.repository.spec.ts). The unfiltered list is the same array until
 * `buildings` is replaced, as the cached read returns within its TTL.
 * `failWith` makes the next reads reject, as a database error would.
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
  private listed: { from: BuildingDoc[]; buildings: BuildingDoc[] } | null = null;

  async onModuleInit(): Promise<void> {}

  async listBuildings(campus?: Campus): Promise<readonly BuildingDoc[]> {
    if (this.failWith) throw this.failWith;
    if (this.listed?.from !== this.buildings) {
      const buildings = [...this.buildings]
        .sort((a, b) => a._id - b._id)
        .map(({ extensions: _extensions, sync: _sync, enrichVersion: _enrichVersion, ...projected }) => projected);
      this.listed = { from: this.buildings, buildings };
    }
    return campus ? this.listed.buildings.filter((b) => b.campus === campus) : this.listed.buildings;
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
