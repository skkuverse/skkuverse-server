import { Module } from "@nestjs/common";
import { BusRealtimeGroupModule } from "../../realtime/group/bus-realtime-group.module";
import { BusStopsModule } from "../../stops/bus-stops.module";
import { BusLiveModule } from "../bus-live.module";
import { BusLiveJongroService } from "./bus-live-jongro.service";

@Module({
  imports: [BusLiveModule, BusRealtimeGroupModule, BusStopsModule],
  providers: [BusLiveJongroService],
  exports: [BusLiveJongroService],
})
export class BusLiveJongroModule {}
