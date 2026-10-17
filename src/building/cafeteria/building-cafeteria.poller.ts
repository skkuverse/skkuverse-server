import { Injectable, type OnModuleInit } from "@nestjs/common";
import config from "../../infra/config";
import logger from "../../infra/logger";
import { PollerRegistryService } from "../../scheduling/poller-registry.service";
import { BuildingCafeteriaService } from "./building-cafeteria.service";

@Injectable()
export class BuildingCafeteriaPoller implements OnModuleInit {
  constructor(
    private readonly registry: PollerRegistryService,
    private readonly sync: BuildingCafeteriaService,
  ) {}

  onModuleInit(): void {
    // WHY: BUILDING_SYNC=off, the development default, also covers this sync: both write the building DB.
    if (!config.building.syncEnabled) {
      logger.info(
        { event: "building.cafeteria.sync_disabled" },
        "Cafeteria sync not registered (BUILDING_SYNC=off)",
      );
      return;
    }
    this.registry.registerPoller(() => this.sync.run(), config.building.syncIntervalMs, "building-cafeteria-sync");
  }
}
