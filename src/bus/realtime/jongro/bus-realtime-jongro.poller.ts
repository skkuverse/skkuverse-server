import { Injectable, type OnModuleInit } from "@nestjs/common";
import { PollerRegistryService } from "../../../scheduling/poller-registry.service";
import { jongroRoutes } from "../../bus.config";
import { POLL_INTERVAL_MS } from "./bus-realtime-jongro.constants";
import { BusRealtimeJongroService } from "./bus-realtime-jongro.service";

@Injectable()
export class BusRealtimeJongroPoller implements OnModuleInit {
  constructor(
    private readonly registry: PollerRegistryService,
    private readonly jongro: BusRealtimeJongroService,
  ) {}

  // WHY: one poller per route, so one dead route does not mark the others down.
  onModuleInit(): void {
    for (const route of jongroRoutes) {
      this.registry.registerPoller(() => this.jongro.refresh(route), POLL_INTERVAL_MS, `jongro-${route.code}`);
    }
  }
}
