import { Module } from "@nestjs/common";
import { BuildingModule } from "../building.module";
import { BuildingCatalogController } from "./building-catalog.controller";
import { BuildingCatalogRepository } from "./building-catalog.repository";
import { BuildingCatalogService } from "./building-catalog.service";

@Module({
  imports: [BuildingModule],
  controllers: [BuildingCatalogController],
  providers: [BuildingCatalogService, BuildingCatalogRepository],
})
export class BuildingCatalogModule {}
