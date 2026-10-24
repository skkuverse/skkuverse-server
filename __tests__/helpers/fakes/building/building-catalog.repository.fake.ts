/**
 * In-memory BuildingCatalogRepository over buildings, spaces and connections,
 * with the real queries' filters, projections and parses (pinned in
 * building-catalog.repository.spec.ts): a building by skkuId (buildingDoc), a
 * building's spaces by buildNo (floorSpace), a connection from either end
 * (connectionEnds), buildings by skkuId list (buildingLabel), and a building's
 * cafeterias by buildNo, sorted by conspaceCd (cafeteriaSummary). Each parse
 * leaves a malformed document out, and `displayNo` is derived from `buildNo`,
 * as the real reads do. `reads`
 * names each read in order, for the tests where skipping a read is the
 * behavior. `failWith` makes every read reject.
 */
import type { BuildingDoc, CafeteriaDoc, SpaceDoc } from "../../../../src/building/building.document";
import type { BuildNo, SkkuId } from "../../../../src/building/building.types";
import type { BuildingCatalogRepository } from "../../../../src/building/catalog/building-catalog.repository";
import type {
  BuildingLabel,
  CafeteriaSummary,
  ConnectionEnds,
  FloorSpaceDoc,
} from "../../../../src/building/catalog/building-catalog.document";
import { buildingDoc } from "../../../../src/building/building.schema";
import {
  buildingLabel,
  cafeteriaSummary,
  connectionEnds,
  floorSpace,
} from "../../../../src/building/catalog/building-catalog.schema";
import type { PublicOf } from "../public-of";

export class FakeBuildingCatalogRepository implements PublicOf<BuildingCatalogRepository> {
  buildings: BuildingDoc[] = [];
  spaces: SpaceDoc[] = [];
  connections: ConnectionEnds[] = [];
  cafeterias: CafeteriaDoc[] = [];
  reads: string[] = [];
  failWith: Error | null = null;

  async onModuleInit(): Promise<void> {}

  async findBuildingBySkkuId(skkuId: SkkuId): Promise<BuildingDoc | null> {
    this.read("findBuildingBySkkuId");
    const building = this.buildings.find((b) => b._id === skkuId);
    if (!building) return null;
    const parsed = buildingDoc.safeParse(building);
    return parsed.success ? parsed.data : null;
  }

  async listSpacesByBuildNo(buildNo: BuildNo): Promise<FloorSpaceDoc[]> {
    this.read("listSpacesByBuildNo");
    return this.spaces
      .filter((s) => s.buildNo === buildNo)
      .flatMap((s) => {
        const parsed = floorSpace.safeParse(s);
        return parsed.success ? [parsed.data] : [];
      });
  }

  async listConnectionsBySkkuId(skkuId: SkkuId): Promise<ConnectionEnds[]> {
    this.read("listConnectionsBySkkuId");
    return this.connections
      .filter((c) => c.a?.skkuId === skkuId || c.b?.skkuId === skkuId)
      .flatMap((c) => {
        const parsed = connectionEnds.safeParse(c);
        return parsed.success ? [parsed.data] : [];
      });
  }

  async listBuildingsBySkkuIds(skkuIds: readonly SkkuId[]): Promise<BuildingLabel[]> {
    this.read("listBuildingsBySkkuIds");
    return this.buildings
      .filter((b) => skkuIds.includes(b._id))
      .flatMap((b) => {
        const parsed = buildingLabel.safeParse(b);
        return parsed.success ? [parsed.data] : [];
      });
  }

  async listCafeteriasByBuildNo(buildNo: BuildNo): Promise<CafeteriaSummary[]> {
    this.read("listCafeteriasByBuildNo");
    return this.cafeterias
      .filter((c) => c.buildNo === buildNo && c.kind === "cafeteria")
      .sort((a, b) => (a._id < b._id ? -1 : a._id > b._id ? 1 : 0))
      .flatMap((c) => {
        const parsed = cafeteriaSummary.safeParse(c);
        return parsed.success ? [parsed.data] : [];
      });
  }

  private read(name: string): void {
    this.reads.push(name);
    if (this.failWith) throw this.failWith;
  }
}
