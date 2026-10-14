import { Injectable, type OnModuleInit } from "@nestjs/common";
import { PollerRegistryService } from "../../../scheduling/poller-registry.service";
import { BusRealtimeHsscService } from "./bus-realtime-hssc.service";

const POLL_INTERVAL_MS = 10_000;

@Injectable()
export class BusRealtimeHsscPoller implements OnModuleInit {
  constructor(
    private readonly registry: PollerRegistryService,
    private readonly hssc: BusRealtimeHsscService,
  ) {}

  onModuleInit(): void {
    this.registry.registerPoller(() => this.hssc.refresh(), POLL_INTERVAL_MS, "hssc");
  }
}
