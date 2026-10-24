import { Injectable, type OnModuleInit } from "@nestjs/common";
import config from "../../../infra/config";
import logger from "../../../infra/logger";
import { PollerRegistryService } from "../../../scheduling/poller-registry.service";
import { REGIONAL_ROUTES } from "../../bus.constants";
import { POLL_INTERVAL_MS } from "./bus-realtime-gbis.constants";
import { BusRealtimeGbisService } from "./bus-realtime-gbis.service";

@Injectable()
export class BusRealtimeGbisPoller implements OnModuleInit {
  constructor(
    private readonly registry: PollerRegistryService,
    private readonly seats: BusRealtimeGbisService,
  ) {}

  // WHY: GBIS=off (the development default) registers nothing, so no laptop spends production's 1,000-call quota.
  onModuleInit(): void {
    for (const route of REGIONAL_ROUTES) {
      const name = `gbis-seats-${route.code}`;
      if (!config.gbis.enabled) {
        logger.info({ event: "bus.gbis.disabled", poller: name }, "GBIS=off: poller not registered");
        continue;
      }
      this.registry.registerPoller(() => this.seats.refresh(route), POLL_INTERVAL_MS, name);
    }
  }
}
