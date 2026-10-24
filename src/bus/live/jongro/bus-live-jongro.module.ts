import { Module } from "@nestjs/common";
import { BusRealtimeGbisModule } from "../../realtime/gbis/bus-realtime-gbis.module";
import { BusRealtimeGroupModule } from "../../realtime/group/bus-realtime-group.module";
import { BusStopsModule } from "../../stops/bus-stops.module";
import { BusLiveModule } from "../bus-live.module";
import { BusLiveJongroService } from "./bus-live-jongro.service";

@Module({
  imports: [BusLiveModule, BusRealtimeGroupModule, BusRealtimeGbisModule, BusStopsModule],
  providers: [BusLiveJongroService],
  exports: [BusLiveJongroService],
})
export class BusLiveJongroModule {}
