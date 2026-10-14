import { Module } from "@nestjs/common";
import { Clock } from "../../../infra/clock";
import { BusRealtimeModule } from "../bus-realtime.module";
import { BusRealtimeJongroClient } from "./bus-realtime-jongro.client";
import { BusRealtimeJongroPoller } from "./bus-realtime-jongro.poller";
import { BusRealtimeJongroService } from "./bus-realtime-jongro.service";

@Module({
  imports: [BusRealtimeModule],
  providers: [BusRealtimeJongroClient, BusRealtimeJongroService, BusRealtimeJongroPoller, Clock],
  exports: [BusRealtimeJongroService],
})
export class BusRealtimeJongroModule {}
