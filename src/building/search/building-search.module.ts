import { Module } from "@nestjs/common";
import { BuildingModule } from "../building.module";
import { BuildingSearchController } from "./building-search.controller";
import { BuildingSearchRepository } from "./building-search.repository";
import { BuildingSearchService } from "./building-search.service";

/**
 * GET /building/search. It imports BuildingModule for BuildingService, whose
 * cached building list joins each room group to its building. It shares the
 * /building prefix with the catalog, so app.module.ts registers it before
 * BuildingCatalogModule: Nest registers routes in module order, and
 * /building/:skkuId first would answer /building/search
 * (__tests__/architecture/route-order.test.ts).
 */
@Module({
  imports: [BuildingModule],
  controllers: [BuildingSearchController],
  providers: [BuildingSearchService, BuildingSearchRepository],
})
export class BuildingSearchModule {}
