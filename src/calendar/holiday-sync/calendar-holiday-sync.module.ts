import { Module } from "@nestjs/common";
import { Clock } from "../../infra/clock";
import { CalendarModule } from "../calendar.module";
import { CalendarHolidaySyncClient } from "./calendar-holiday-sync.client";
import { CalendarHolidaySyncPoller } from "./calendar-holiday-sync.poller";
import { CalendarHolidaySyncRepository } from "./calendar-holiday-sync.repository";
import { CalendarHolidaySyncService } from "./calendar-holiday-sync.service";

@Module({
  imports: [CalendarModule],
  providers: [CalendarHolidaySyncClient, CalendarHolidaySyncRepository, CalendarHolidaySyncService, CalendarHolidaySyncPoller, Clock],
})
export class CalendarHolidaySyncModule {}
