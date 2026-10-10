import { Injectable } from "@nestjs/common";
import type { SupportedLang } from "../../infra/types";
import type { BuildingDoc } from "../building.document";
import { withCampusLabel } from "../building.mapper";
import { hasBuildNo } from "../building.rules";
import { BuildingRepository } from "../building.repository";
import type { Campus, SkkuId, WithCampusLabel } from "../building.types";
import { groupByFloor, toConnectedSkkuIds, toBuildingConnections, withFloorEnFallback } from "./building-catalog.mapper";
import { BuildingCatalogRepository } from "./building-catalog.repository";
import type { BuildingConnection, BuildingDetail } from "./building-catalog.types";

@Injectable()
export class BuildingCatalogService {
  constructor(
    private readonly repository: BuildingCatalogRepository,
    private readonly buildings: BuildingRepository,
  ) {}

  /** GET /building/list: every building, or one campus's, each with its campus label. */
  async list(
    campus: Campus | null,
    lang: SupportedLang,
  ): Promise<{ buildings: Array<WithCampusLabel<BuildingDoc>> }> {
    const buildings = await this.buildings.listBuildings(campus);
    return { buildings: buildings.map((b) => withCampusLabel(b, lang)) };
  }

  /** GET /building/:skkuId: the building, its floors and connections; null if there is none. */
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

  /** A building's connections, each labelled with the building at its far end. */
  private async listConnections(skkuId: SkkuId): Promise<BuildingConnection[]> {
    const connections = await this.repository.listConnectionsBySkkuId(skkuId);
    if (!connections.length) return [];
    const targets = await this.repository.listBuildingsBySkkuIds(toConnectedSkkuIds(skkuId, connections));
    return toBuildingConnections(skkuId, connections, targets);
  }
}
