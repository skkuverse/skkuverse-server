import { Module } from "@nestjs/common";
import { Clock } from "../../infra/clock";
import { HolidaysModule } from "../holidays.module";
import { HolidaysSyncClient } from "./holidays-sync.client";
import { HolidaysSyncPoller } from "./holidays-sync.poller";
import { HolidaysSyncRepository } from "./holidays-sync.repository";
import { HolidaysSyncService } from "./holidays-sync.service";

@Module({
  imports: [HolidaysModule],
  providers: [HolidaysSyncClient, HolidaysSyncRepository, HolidaysSyncService, HolidaysSyncPoller, Clock],
})
export class HolidaysSyncModule {}
