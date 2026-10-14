import { Module } from "@nestjs/common";
import { Clock } from "../../../infra/clock";
import { BusRealtimeModule } from "../bus-realtime.module";
import { BusRealtimeHsscClient } from "./bus-realtime-hssc.client";
import { BusRealtimeHsscPoller } from "./bus-realtime-hssc.poller";
import { BusRealtimeHsscService } from "./bus-realtime-hssc.service";

@Module({
  imports: [BusRealtimeModule],
  providers: [BusRealtimeHsscClient, BusRealtimeHsscService, BusRealtimeHsscPoller, Clock],
  exports: [BusRealtimeHsscService],
})
export class BusRealtimeHsscModule {}
