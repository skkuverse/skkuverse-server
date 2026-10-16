import { Injectable, type OnModuleInit } from "@nestjs/common";
import config from "../../infra/config";
import { PollerRegistryService } from "../../scheduling/poller-registry.service";
import { HolidaysSyncService } from "./holidays-sync.service";

@Injectable()
export class HolidaysSyncPoller implements OnModuleInit {
  constructor(
    private readonly registry: PollerRegistryService,
    private readonly sync: HolidaysSyncService,
  ) {}

  onModuleInit(): void {
    this.registry.registerPoller(() => this.sync.run(), config.holidays.syncIntervalMs, "holidays-sync");
  }
}
