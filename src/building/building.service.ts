import { Injectable } from "@nestjs/common";
import type { RankedSearchResult } from "./building-search.rules";
import type { BuildingDoc, CampusShapeDoc, SpaceDoc } from "./building.document";
import { BuildingRepository } from "./building.repository";
import type { Campus, ConnectionResponseItem, FloorGroup } from "./building.types";

@Injectable()
export class BuildingService {
  constructor(private readonly repository: BuildingRepository) {}

  getAllBuildings(campus?: Campus | null): Promise<BuildingDoc[]> {
    return this.repository.getAllBuildings(campus);
  }

  /** Every campus shape, in authored order (the campus map overlay). */
  getAllCampusShapes(): Promise<CampusShapeDoc[]> {
    return this.repository.getAllCampusShapes();
  }

  getBuildingBySkkuId(skkuId: number): Promise<BuildingDoc | null> {
    return this.repository.getBuildingBySkkuId(skkuId);
  }

  getFloorsByBuildNo(buildNo: string | null): Promise<FloorGroup[]> {
    return this.repository.getFloorsByBuildNo(buildNo);
  }

  getConnectionsForBuilding(skkuId: number): Promise<ConnectionResponseItem[]> {
    return this.repository.getConnectionsForBuilding(skkuId);
  }

  searchBuildings(query: string, campus?: Campus | null): Promise<RankedSearchResult<BuildingDoc>> {
    return this.repository.searchBuildings(query, campus);
  }

  searchSpaces(query: string, campus?: Campus | null): Promise<RankedSearchResult<SpaceDoc>> {
    return this.repository.searchSpaces(query, campus);
  }
}
