/**
 * In-memory BuildingCatalogRepository over buildings, spaces and connections,
 * with the real queries' filters and projections (pinned in
 * building-catalog.repository.spec.ts): a building by skkuId, a building's spaces by
 * buildNo, a connection from either end, and buildings by skkuId list. `reads`
 * names each read in order, for the tests where skipping a read is the
 * behavior. `failWith` makes every read reject.
 */
import type { BuildingDoc, SpaceDoc } from "../../../../src/building/building.document";
import type { BuildNo, SkkuId } from "../../../../src/building/building.types";
import type { BuildingCatalogRepository } from "../../../../src/building/catalog/building-catalog.repository";
import type { BuildingLabel, ConnectionEnds, FloorSpaceDoc } from "../../../../src/building/catalog/building-catalog.document";
import type { PublicOf } from "../public-of";

export class FakeBuildingCatalogRepository implements PublicOf<BuildingCatalogRepository> {
  buildings: BuildingDoc[] = [];
  spaces: SpaceDoc[] = [];
  connections: ConnectionEnds[] = [];
  reads: string[] = [];
  failWith: Error | null = null;

  async onModuleInit(): Promise<void> {}

  async ensureIndexes(): Promise<void> {}

  async findBuildingBySkkuId(skkuId: SkkuId): Promise<BuildingDoc | null> {
    this.read("findBuildingBySkkuId");
    const building = this.buildings.find((b) => b._id === skkuId);
    if (!building) return null;
    const projected: Partial<BuildingDoc> = { ...building };
    delete projected.sync;
    delete projected.enrichVersion;
    return projected as BuildingDoc;
  }

  async listSpacesByBuildNo(buildNo: BuildNo): Promise<FloorSpaceDoc[]> {
    this.read("listSpacesByBuildNo");
    return this.spaces
      .filter((s) => s.buildNo === buildNo)
      .map(({ spaceCd, name, floor, conspaceCd }) => ({ spaceCd, name, floor, conspaceCd }));
  }

  async listConnectionsBySkkuId(skkuId: SkkuId): Promise<ConnectionEnds[]> {
    this.read("listConnectionsBySkkuId");
    return this.connections.filter((c) => c.a.skkuId === skkuId || c.b.skkuId === skkuId);
  }

  async listBuildingsBySkkuIds(skkuIds: readonly SkkuId[]): Promise<BuildingLabel[]> {
    this.read("listBuildingsBySkkuIds");
    return this.buildings
      .filter((b) => skkuIds.includes(b._id))
      .map(({ _id, buildNo, displayNo, name }) => ({ _id, buildNo, displayNo, name }));
  }

  private read(name: string): void {
    this.reads.push(name);
    if (this.failWith) throw this.failWith;
  }
}
