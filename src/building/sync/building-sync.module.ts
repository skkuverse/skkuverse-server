import { Module } from "@nestjs/common";
import { BuildingModule } from "../building.module";
import { BuildingSyncClient } from "./building-sync.client";
import { BuildingSyncPoller } from "./building-sync.poller";
import { BuildingSyncRepository } from "./building-sync.repository";
import { BuildingSyncService } from "./building-sync.service";

/**
 * The weekly sync of SKKU's campusMap.do into the building DB. It has no
 * routes. It imports BuildingModule for BuildingRepository, whose read caches
 * it clears after a run.
 */
@Module({
  imports: [BuildingModule],
  providers: [BuildingSyncClient, BuildingSyncRepository, BuildingSyncService, BuildingSyncPoller],
})
export class BuildingSyncModule {}
