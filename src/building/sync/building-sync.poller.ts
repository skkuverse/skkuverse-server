import { Injectable, type OnModuleInit } from "@nestjs/common";
import config from "../../infra/config";
import logger from "../../infra/logger";
import { PollerRegistryService } from "../../scheduling/poller-registry.service";
import { BuildingSyncService } from "./building-sync.service";

/**
 * Registers the building sync with the PollerRegistry: every
 * config.building.syncIntervalMs (~7 days), as "building-sync". The registry
 * starts pollers only when ROLE !== "api", so api replicas never crawl, and it
 * reports a rejected run as `poller.failing` with a Sentry Issue.
 */
@Injectable()
export class BuildingSyncPoller implements OnModuleInit {
  constructor(
    private readonly registry: PollerRegistryService,
    private readonly sync: BuildingSyncService,
  ) {}

  onModuleInit(): void {
    // BUILDING_SYNC=off (the development default): not registered at all. The
    // registry's warm-up would otherwise crawl campusMap.do and rewrite
    // skkumap_dev on every boot — every save, under nodemon.
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
