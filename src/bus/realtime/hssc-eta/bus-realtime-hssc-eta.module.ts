import { Module } from "@nestjs/common";
import { BusRealtimeHsscEtaService } from "./bus-realtime-hssc-eta.service";

@Module({
  providers: [BusRealtimeHsscEtaService],
  exports: [BusRealtimeHsscEtaService],
})
export class BusRealtimeHsscEtaModule {}
