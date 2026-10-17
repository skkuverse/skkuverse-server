import { Module } from "@nestjs/common";
import { BusEtaLaneModule } from "../lane/bus-eta-lane.module";
import { BusEtaProbeClient } from "./bus-eta-probe.client";
import { BusEtaProbeRepository } from "./bus-eta-probe.repository";
import { BusEtaProbeService } from "./bus-eta-probe.service";

@Module({
  imports: [BusEtaLaneModule],
  providers: [BusEtaProbeClient, BusEtaProbeRepository, BusEtaProbeService],
  exports: [BusEtaProbeService],
})
export class BusEtaProbeModule {}
