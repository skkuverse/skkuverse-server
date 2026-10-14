import { Module } from "@nestjs/common";
import { BusScheduleModule } from "../schedule/bus-schedule.module";
import { BusStopsModule } from "../stops/bus-stops.module";
import { BusEtaRepository } from "./bus-eta.repository";
import { BusEtaService } from "./bus-eta.service";

@Module({
  imports: [BusScheduleModule, BusStopsModule],
  providers: [BusEtaRepository, BusEtaService],
  exports: [BusEtaRepository, BusEtaService, BusScheduleModule, BusStopsModule],
})
export class BusEtaModule {}
