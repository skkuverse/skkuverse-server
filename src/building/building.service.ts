import { Injectable } from "@nestjs/common";
import type { SupportedLang } from "../infra/types";
import type { BuildingDoc, CampusShapeDoc } from "./building.document";
import { withCampusLabel, withFloorEnFallback } from "./building.mapper";
import { BuildingRepository } from "./building.repository";
import type { BuildingDetail, Campus, SkkuId, WithCampusLabel } from "./building.types";

@Injectable()
export class BuildingService {
  constructor(private readonly repository: BuildingRepository) {}

  /** GET /building/list: every building, or one campus's, each with its campus label. */
  async list(
    campus: Campus | null,
    lang: SupportedLang,
  ): Promise<{ buildings: Array<WithCampusLabel<BuildingDoc>> }> {
    const buildings = await this.repository.listBuildings(campus);
    return { buildings: buildings.map((b) => withCampusLabel(b, lang)) };
  }

  /** GET /building/:skkuId: the building, its floors and connections; null if there is none. */
  async detail(skkuId: SkkuId, lang: SupportedLang): Promise<BuildingDetail | null> {
    const building = await this.repository.findBuildingBySkkuId(skkuId);
    if (!building) return null;
    const [floors, connections] = await Promise.all([
      this.repository.listFloorsByBuildNo(building.buildNo),
      this.repository.listConnectionsBySkkuId(skkuId),
    ]);
    return {
      building: withCampusLabel(building, lang),
      floors: withFloorEnFallback(floors),
      connections,
    };
  }

  /** Every building, unlabeled: the read other modules (map, building search) get through the exported BuildingService. */
  listAllBuildings(): Promise<BuildingDoc[]> {
    return this.repository.listBuildings();
  }

  /** Every campus outline, for other modules through the exported BuildingService. */
  listAllCampusShapes(): Promise<CampusShapeDoc[]> {
    return this.repository.listCampusShapes();
  }
}
