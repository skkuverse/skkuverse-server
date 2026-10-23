import { Injectable, type OnModuleInit } from "@nestjs/common";
import config from "../../infra/config";
import { PollerRegistryService } from "../../scheduling/poller-registry.service";
import { CalendarHolidaySyncService } from "./calendar-holiday-sync.service";

@Injectable()
export class CalendarHolidaySyncPoller implements OnModuleInit {
  constructor(
    private readonly registry: PollerRegistryService,
    private readonly sync: CalendarHolidaySyncService,
  ) {}

  onModuleInit(): void {
    this.registry.registerPoller(() => this.sync.run(), config.holidays.syncIntervalMs, "holidays-sync");
  }
}
