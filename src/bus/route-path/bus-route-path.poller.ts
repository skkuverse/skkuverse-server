import { Injectable, type OnModuleInit } from "@nestjs/common";
import config from "../../infra/config";
import logger from "../../infra/logger";
import { PollerRegistryService } from "../../scheduling/poller-registry.service";
import { REGIONAL_ROUTES, TOPIS_ROUTES } from "../bus.constants";
import { SYNC_INTERVAL_MS } from "./bus-route-path.constants";
import { BusRoutePathService } from "./bus-route-path.service";

@Injectable()
export class BusRoutePathPoller implements OnModuleInit {
  constructor(
    private readonly registry: PollerRegistryService,
    private readonly routePaths: BusRoutePathService,
  ) {}

  // WHY: one poller per route, so one dead route does not mark the others down; REGIONAL_BUS=off syncs no regional line.
  onModuleInit(): void {
    for (const route of TOPIS_ROUTES) {
      const name = `jongro-path-${route.code}`;
      if (REGIONAL_ROUTES.includes(route) && !config.regionalBus.enabled) {
        logger.info({ event: "bus.regional.disabled", poller: name }, "REGIONAL_BUS=off: poller not registered");
        continue;
      }
      this.registry.registerPoller(() => this.routePaths.sync(route), SYNC_INTERVAL_MS, name);
    }
  }
}
