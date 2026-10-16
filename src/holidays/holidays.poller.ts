import { Injectable, type OnModuleInit } from "@nestjs/common";
import config from "../infra/config";
import { PollerRegistryService } from "../scheduling/poller-registry.service";
import { HolidaysService } from "./holidays.service";

@Injectable()
export class HolidaysPoller implements OnModuleInit {
  constructor(
    private readonly registry: PollerRegistryService,
    private readonly holidays: HolidaysService,
  ) {}

  onModuleInit(): void {
    this.registry.registerPoller(() => this.holidays.sync(), config.holidays.syncIntervalMs, "holidays-sync");
  }
}
