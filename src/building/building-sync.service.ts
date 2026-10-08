import { Injectable, type OnModuleInit } from "@nestjs/common";
import config from "../infra/config";
import { syncBuildings } from "./building.sync";
import { PollerRegistryService } from "../scheduling/poller-registry.service";

/**
 * BuildingSyncService — registers building.sync's syncBuildings() (SKKU
 * campusMap.do crawl → raw/enriched/spaces upsert) with the Nest
 * PollerRegistry. Interval = config.building.syncIntervalMs (~7 days), name
 * "building-sync". Registered as is: a failed run rejects, and the registry
 * logs it as `poller.failing` and opens a Sentry Issue on the first failure
 * (a slow poller), like every other poller.
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
      syncBuildings,
      config.building.syncIntervalMs,
      "building-sync",
    );
  }
}
