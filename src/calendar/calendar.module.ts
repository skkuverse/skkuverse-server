import { Module } from "@nestjs/common";
import { Clock } from "../infra/clock";
import { CalendarRepository } from "./calendar.repository";
import { CalendarService } from "./calendar.service";

// SEE: docs/explanation/calendar-architecture.md
@Module({
  providers: [CalendarService, CalendarRepository, Clock],
  exports: [CalendarService, CalendarRepository],
})
export class CalendarModule {}
