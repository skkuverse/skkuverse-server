import { Injectable } from "@nestjs/common";
import type { SupportedLang } from "../../infra/types";
import { withCampusLabel } from "../building.mapper";
import { hasBuildNo } from "../building.rules";
import { BuildingRepository } from "../building.repository";
import type { Campus, SkkuId } from "../building.types";
import { groupByFloor, toConnectedSkkuIds, toBuildingConnections, withFloorEnFallback } from "./building-catalog.mapper";
import { BuildingCatalogRepository } from "./building-catalog.repository";
import type { BuildingConnection, BuildingDetail, BuildingList } from "./building-catalog.types";

@Injectable()
export class BuildingCatalogService {
  constructor(
    private readonly repository: BuildingCatalogRepository,
    private readonly buildings: BuildingRepository,
  ) {}

  async list(campus: Campus | undefined, lang: SupportedLang): Promise<BuildingList> {
    const buildings = await this.buildings.listBuildings(campus);
    return { buildings: buildings.map((b) => withCampusLabel(b, lang)) };
  }

  async detail(skkuId: SkkuId, lang: SupportedLang): Promise<BuildingDetail | null> {
    const building = await this.repository.findBuildingBySkkuId(skkuId);
    if (!building) return null;
    const [spaces, connections] = await Promise.all([
      hasBuildNo(building) ? this.repository.listSpacesByBuildNo(building.buildNo) : [],
      this.listConnections(skkuId),
    ]);
    return {
      building: withCampusLabel(building, lang),
      floors: withFloorEnFallback(groupByFloor(spaces)),
      connections,
    };
  }

  private async listConnections(skkuId: SkkuId): Promise<BuildingConnection[]> {
    const connections = await this.repository.listConnectionsBySkkuId(skkuId);
    if (!connections.length) return [];
    const targets = await this.repository.listBuildingsBySkkuIds(toConnectedSkkuIds(skkuId, connections));
    return toBuildingConnections(skkuId, connections, targets);
  }
}
