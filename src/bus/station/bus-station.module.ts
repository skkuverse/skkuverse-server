import { Module } from "@nestjs/common";
import { BusCacheModule } from "../cache/bus-cache.module";
import { BusRealtimeHsscModule } from "../realtime/hssc/bus-realtime-hssc.module";
import { BusStationClient } from "./bus-station.client";
import { BusStationController } from "./bus-station.controller";
import { BusStationPoller } from "./bus-station.poller";
import { BusStationService } from "./bus-station.service";

@Module({
  imports: [BusCacheModule, BusRealtimeHsscModule],
  controllers: [BusStationController],
  providers: [BusStationClient, BusStationService, BusStationPoller],
})
export class BusStationModule {}
