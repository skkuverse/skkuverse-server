import { Module } from "@nestjs/common";
import { BuildingModule } from "../building.module";
import { BuildingSearchController } from "./building-search.controller";
import { BuildingSearchRepository } from "./building-search.repository";
import { BuildingSearchService } from "./building-search.service";

@Module({
  imports: [BuildingModule],
  controllers: [BuildingSearchController],
  providers: [BuildingSearchService, BuildingSearchRepository],
})
export class BuildingSearchModule {}
