import { Module } from "@nestjs/common";
import { BuildingModule } from "../building.module";
import { BuildingSyncClient } from "./building-sync.client";
import { BuildingSyncPoller } from "./building-sync.poller";
import { BuildingSyncRepository } from "./building-sync.repository";
import { BuildingSyncService } from "./building-sync.service";

@Module({
  imports: [BuildingModule],
  providers: [BuildingSyncClient, BuildingSyncRepository, BuildingSyncService, BuildingSyncPoller],
})
export class BuildingSyncModule {}
