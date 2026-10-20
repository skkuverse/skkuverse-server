import { Injectable, type OnModuleInit } from "@nestjs/common";
import { PollerRegistryService } from "../../scheduling/poller-registry.service";
import { JONGRO_ROUTES } from "../bus.constants";
import { toJongroRoute } from "../bus.mapper";
import { SYNC_INTERVAL_MS } from "./bus-route-path.constants";
import { BusRoutePathService } from "./bus-route-path.service";

@Injectable()
export class BusRoutePathPoller implements OnModuleInit {
  constructor(
    private readonly registry: PollerRegistryService,
    private readonly routePaths: BusRoutePathService,
  ) {}

  // WHY: one poller per route, so one dead route does not mark the others down.
  onModuleInit(): void {
    for (const route of JONGRO_ROUTES.map(toJongroRoute)) {
      this.registry.registerPoller(() => this.routePaths.sync(route), SYNC_INTERVAL_MS, `jongro-path-${route.code}`);
    }
  }
}
