import { Module } from "@nestjs/common";
import { BuildingModule } from "../building.module";
import { BuildingCatalogController } from "./building-catalog.controller";
import { BuildingCatalogRepository } from "./building-catalog.repository";
import { BuildingCatalogService } from "./building-catalog.service";

/**
 * GET /building/list and GET /building/:skkuId. It imports BuildingModule for
 * BuildingRepository's cached building list. app.module.ts registers it after
 * BuildingSearchModule, so /building/search is not caught by /building/:skkuId.
 */
@Module({
  imports: [BuildingModule],
  controllers: [BuildingCatalogController],
  providers: [BuildingCatalogService, BuildingCatalogRepository],
})
export class BuildingCatalogModule {}
