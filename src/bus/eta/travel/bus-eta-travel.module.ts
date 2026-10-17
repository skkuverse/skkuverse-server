import { Module } from "@nestjs/common";
import { BusEtaLaneModule } from "../lane/bus-eta-lane.module";
import { BusEtaProbeModule } from "../probe/bus-eta-probe.module";
import { BusEtaTravelClient } from "./bus-eta-travel.client";
import { BusEtaTravelService } from "./bus-eta-travel.service";

@Module({
  imports: [BusEtaLaneModule, BusEtaProbeModule],
  providers: [BusEtaTravelClient, BusEtaTravelService],
  exports: [BusEtaTravelService],
})
export class BusEtaTravelModule {}
