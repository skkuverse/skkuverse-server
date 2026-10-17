import { Injectable } from "@nestjs/common";
import type { Campus } from "../../building/building.types";
import { BuildingService } from "../../building/building.service";
import { BuildingCafeteriaListService } from "../../building/cafeteria-list/building-cafeteria-list.service";
import { toCafeteriaList } from "./meals-catalog.mapper";
import type { CafeteriaList } from "./meals-catalog.wire";

@Injectable()
export class MealsCatalogService {
  constructor(
    private readonly cafeterias: BuildingCafeteriaListService,
    private readonly buildings: BuildingService,
  ) {}

  async listCafeterias(campus: Campus): Promise<CafeteriaList> {
    const [cafeterias, buildings] = await Promise.all([
      this.cafeterias.listCafeterias(campus),
      this.buildings.listAllBuildings(),
    ]);
    return toCafeteriaList(cafeterias, buildings);
  }
}
