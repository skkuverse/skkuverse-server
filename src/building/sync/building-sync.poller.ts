import { Injectable, type OnModuleInit } from "@nestjs/common";
import config from "../../infra/config";
import logger from "../../infra/logger";
import { PollerRegistryService } from "../../scheduling/poller-registry.service";
import { BuildingSyncService } from "./building-sync.service";

@Injectable()
export class BuildingSyncPoller implements OnModuleInit {
  constructor(
    private readonly registry: PollerRegistryService,
    private readonly sync: BuildingSyncService,
  ) {}

  onModuleInit(): void {
    // WHY: BUILDING_SYNC=off is the development default: the registry's warm-up run would
    // otherwise crawl campusMap.do and rewrite skkumap_dev on every nodemon restart.
    if (!config.building.syncEnabled) {
      logger.info(
        { event: "building.sync.disabled" },
        "Building sync not registered (BUILDING_SYNC=off)",
      );
      return;
    }
    this.registry.registerPoller(
      () => this.sync.run(),
      config.building.syncIntervalMs,
      "building-sync",
    );
  }
}
