import { Module } from "@nestjs/common";
import { Clock } from "../infra/clock";
import { HolidaysClient } from "./holidays.client";
import { HolidaysPoller } from "./holidays.poller";
import { HolidaysRepository } from "./holidays.repository";
import { HolidaysService } from "./holidays.service";

// SEE: docs/explanation/holidays-architecture.md
@Module({
  providers: [HolidaysClient, HolidaysRepository, HolidaysService, HolidaysPoller, Clock],
  exports: [HolidaysService],
})
export class HolidaysModule {}
