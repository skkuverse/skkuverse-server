import { Injectable, type OnModuleInit } from "@nestjs/common";
import { PollerRegistryService } from "../../scheduling/poller-registry.service";
import { POLL_INTERVAL_MS } from "./bus-station.constants";
import { BusStationService } from "./bus-station.service";

@Injectable()
export class BusStationPoller implements OnModuleInit {
  constructor(
    private readonly registry: PollerRegistryService,
    private readonly station: BusStationService,
  ) {}

  onModuleInit(): void {
    this.registry.registerPoller(() => this.station.refresh(), POLL_INTERVAL_MS, "station");
  }
}
