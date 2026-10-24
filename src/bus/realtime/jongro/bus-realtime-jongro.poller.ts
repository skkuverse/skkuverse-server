import { Injectable, type OnModuleInit } from "@nestjs/common";
import { PollerRegistryService } from "../../../scheduling/poller-registry.service";
import { JONGRO_ROUTES } from "../../bus.constants";
import { BusRealtimeJongroService } from "./bus-realtime-jongro.service";

@Injectable()
export class BusRealtimeJongroPoller implements OnModuleInit {
  constructor(
    private readonly registry: PollerRegistryService,
    private readonly jongro: BusRealtimeJongroService,
  ) {}

  // WHY: one poller per route, so one dead route does not mark the others down.
  onModuleInit(): void {
    for (const route of JONGRO_ROUTES) {
      this.registry.registerPoller(() => this.jongro.refresh(route), route.pollIntervalMs, `jongro-${route.code}`);
    }
  }
}
