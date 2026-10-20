import { Module } from "@nestjs/common";
import { BusEtaProbeClient } from "./bus-eta-probe.client";
import { BusEtaProbeRepository } from "./bus-eta-probe.repository";
import { BusEtaProbeService } from "./bus-eta-probe.service";

@Module({
  providers: [BusEtaProbeClient, BusEtaProbeRepository, BusEtaProbeService],
  exports: [BusEtaProbeService],
})
export class BusEtaProbeModule {}
