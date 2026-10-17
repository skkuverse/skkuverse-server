import { Injectable } from "@nestjs/common";
import type { SupportedLang } from "../../infra/types";
import { toBuildingCard } from "../building.mapper";
import { hasBuildNo } from "../building.rules";
import { BuildingRepository } from "../building.repository";
import type { Campus, SkkuId } from "../building.types";
import {
  groupByFloor,
  toBuildingCafeterias,
  toBuildingConnections,
  toConnectedSkkuIds,
  withFloorEnFallback,
} from "./building-catalog.mapper";
import { BuildingCatalogRepository } from "./building-catalog.repository";
import type { BuildingConnection } from "./building-catalog.types";
import type { BuildingDetail, BuildingList } from "./building-catalog.wire";

@Injectable()
export class BuildingCatalogService {
  constructor(
    private readonly repository: BuildingCatalogRepository,
    private readonly buildings: BuildingRepository,
  ) {}

  async list(campus: Campus | undefined, lang: SupportedLang): Promise<BuildingList> {
    const buildings = await this.buildings.listBuildings(campus);
    return { buildings: buildings.map((b) => toBuildingCard(b, lang)) };
  }

  async detail(skkuId: SkkuId, lang: SupportedLang): Promise<BuildingDetail | null> {
    const building = await this.repository.findBuildingBySkkuId(skkuId);
    if (!building) return null;
    const [spaces, connections, cafeterias] = await Promise.all([
      hasBuildNo(building) ? this.repository.listSpacesByBuildNo(building.buildNo) : [],
      this.listConnections(skkuId),
      hasBuildNo(building) ? this.repository.listCafeteriasByBuildNo(building.buildNo) : [],
    ]);
    return {
      building: toBuildingCard(building, lang),
      floors: withFloorEnFallback(groupByFloor(spaces)),
      connections,
      cafeterias: toBuildingCafeterias(cafeterias),
    };
  }

  private async listConnections(skkuId: SkkuId): Promise<BuildingConnection[]> {
    const connections = await this.repository.listConnectionsBySkkuId(skkuId);
    if (!connections.length) return [];
    const targets = await this.repository.listBuildingsBySkkuIds(toConnectedSkkuIds(skkuId, connections));
    return toBuildingConnections(skkuId, connections, targets);
  }
}
