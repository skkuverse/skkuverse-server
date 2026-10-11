import { Module } from "@nestjs/common";
import { Clock } from "../../infra/clock";
import { BuildingModule } from "../building.module";
import { BuildingSyncClient } from "./building-sync.client";
import { BuildingSyncPoller } from "./building-sync.poller";
import { BuildingSyncRepository } from "./building-sync.repository";
import { BuildingSyncService } from "./building-sync.service";

@Module({
  imports: [BuildingModule],
  providers: [BuildingSyncClient, BuildingSyncRepository, BuildingSyncService, BuildingSyncPoller, Clock],
})
export class BuildingSyncModule {}
