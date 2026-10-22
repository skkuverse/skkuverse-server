import { Module } from "@nestjs/common";
import { Clock } from "../../../infra/clock";
import { BusRealtimeHsscModule } from "../../realtime/hssc/bus-realtime-hssc.module";
import { BusRealtimeHsscEtaModule } from "../../realtime/hssc-eta/bus-realtime-hssc-eta.module";
import { BusStopsModule } from "../../stops/bus-stops.module";
import { BusLiveModule } from "../bus-live.module";
import { BusLiveHsscService } from "./bus-live-hssc.service";

@Module({
  imports: [BusLiveModule, BusRealtimeHsscModule, BusRealtimeHsscEtaModule, BusStopsModule],
  providers: [BusLiveHsscService, Clock],
  exports: [BusLiveHsscService],
})
export class BusLiveHsscModule {}
