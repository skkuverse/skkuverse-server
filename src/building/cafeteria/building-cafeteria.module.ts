import { Module } from "@nestjs/common";
import { Clock } from "../../infra/clock";
import { BuildingModule } from "../building.module";
import { BuildingCafeteriaClient } from "./building-cafeteria.client";
import { BuildingCafeteriaPoller } from "./building-cafeteria.poller";
import { BuildingCafeteriaRepository } from "./building-cafeteria.repository";
import { BuildingCafeteriaService } from "./building-cafeteria.service";

@Module({
  imports: [BuildingModule],
  providers: [BuildingCafeteriaClient, BuildingCafeteriaRepository, BuildingCafeteriaService, BuildingCafeteriaPoller, Clock],
})
export class BuildingCafeteriaModule {}
