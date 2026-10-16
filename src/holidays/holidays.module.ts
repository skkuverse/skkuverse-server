import { Module } from "@nestjs/common";
import { Clock } from "../infra/clock";
import { HolidaysRepository } from "./holidays.repository";
import { HolidaysService } from "./holidays.service";

// SEE: docs/explanation/holidays-architecture.md
@Module({
  providers: [HolidaysService, HolidaysRepository, Clock],
  exports: [HolidaysService, HolidaysRepository],
})
export class HolidaysModule {}
