import { Injectable, type OnModuleInit } from "@nestjs/common";
import config from "../../../infra/config";
import logger from "../../../infra/logger";
import { PollerRegistryService } from "../../../scheduling/poller-registry.service";
import { REGIONAL_ROUTES, TOPIS_ROUTES } from "../../bus.constants";
import { BusRealtimeJongroService } from "./bus-realtime-jongro.service";

@Injectable()
export class BusRealtimeJongroPoller implements OnModuleInit {
  constructor(
    private readonly registry: PollerRegistryService,
    private readonly jongro: BusRealtimeJongroService,
  ) {}

  // WHY: one poller per route, so one dead route does not mark the others down; REGIONAL_BUS=off (the development
  // default) registers no regional route, whose TOPIS quota production has little to spare of.
  onModuleInit(): void {
    for (const route of TOPIS_ROUTES) {
      const name = `jongro-${route.code}`;
      if (REGIONAL_ROUTES.includes(route) && !config.regionalBus.enabled) {
        logger.info({ event: "bus.regional.disabled", poller: name }, "REGIONAL_BUS=off: poller not registered");
        continue;
      }
      this.registry.registerPoller(() => this.jongro.refresh(route), route.pollIntervalMs, name);
    }
  }
}
