import { Injectable, type OnModuleInit } from "@nestjs/common";
import config from "../infra/config";
import logger from "../infra/logger";
import { syncBuildings } from "./building.sync";
import { PollerRegistryService } from "../scheduling/poller-registry.service";

/**
 * BuildingSyncService — registers building.sync's syncBuildings() (SKKU
 * campusMap.do crawl → raw/enriched/spaces upsert) with the Nest
 * PollerRegistry. Interval = config.building.syncIntervalMs (~7 days), name
 * "building-sync". The wrapper catches a rejected sync and logs it
 * (`building.sync.poller_failed`).
 *
 * Gating: PollerRegistryService.onApplicationBootstrap only startAll()s when
 * ROLE !== "api", so an api replica registers but never runs the sync — no
 * duplicate crawls across replicas.
 *
 * building.sync registers nothing when imported (see the note above its
 * export), so this service is the sync's only driver.
 */
@Injectable()
export class BuildingSyncService implements OnModuleInit {
  constructor(private readonly registry: PollerRegistryService) {}

  onModuleInit(): void {
    this.registry.registerPoller(
      () =>
        syncBuildings().catch((err: unknown) =>
          logger.error(
            { event: "building.sync.poller_failed", err },
            "Poller error",
          ),
        ),
      config.building.syncIntervalMs,
      "building-sync",
    );
  }
}
