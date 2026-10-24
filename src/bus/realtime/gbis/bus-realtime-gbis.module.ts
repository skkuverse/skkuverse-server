import { Module } from "@nestjs/common";
import { Clock } from "../../../infra/clock";
import { BusRealtimeModule } from "../bus-realtime.module";
import { BusRealtimeGbisClient } from "./bus-realtime-gbis.client";
import { BusRealtimeGbisPoller } from "./bus-realtime-gbis.poller";
import { BusRealtimeGbisRepository } from "./bus-realtime-gbis.repository";
import { BusRealtimeGbisService } from "./bus-realtime-gbis.service";

@Module({
  imports: [BusRealtimeModule],
  providers: [BusRealtimeGbisClient, BusRealtimeGbisRepository, BusRealtimeGbisService, BusRealtimeGbisPoller, Clock],
  exports: [BusRealtimeGbisService],
})
export class BusRealtimeGbisModule {}
