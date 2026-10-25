import { Module } from "@nestjs/common";
import { BusLiveGroupModule } from "../../live/group/bus-live-group.module";
import { BusRealtimeJongroModule } from "../../realtime/jongro/bus-realtime-jongro.module";
import { BusStopIndexModule } from "../../stop-index/bus-stop-index.module";
import { BusDeparturesModule } from "../bus-departures.module";
import { BusDeparturesTopisService } from "./bus-departures-topis.service";

@Module({
  imports: [BusDeparturesModule, BusLiveGroupModule, BusRealtimeJongroModule, BusStopIndexModule],
  providers: [BusDeparturesTopisService],
  exports: [BusDeparturesTopisService],
})
export class BusDeparturesTopisModule {}
