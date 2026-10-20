import { Module } from "@nestjs/common";
import { Clock } from "../../../infra/clock";
import { BusEtaModule } from "../bus-eta.module";
import { BusEtaLaneRepository } from "./bus-eta-lane.repository";
import { BusEtaLaneService } from "./bus-eta-lane.service";

@Module({
  imports: [BusEtaModule],
  providers: [BusEtaLaneService, BusEtaLaneRepository, Clock],
  exports: [BusEtaLaneService],
})
export class BusEtaLaneModule {}
