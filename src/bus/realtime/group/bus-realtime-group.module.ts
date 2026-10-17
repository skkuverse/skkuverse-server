import { Module } from "@nestjs/common";
import { Clock } from "../../../infra/clock";
import { BusRealtimeArrivalModule } from "../arrival/bus-realtime-arrival.module";
import { BusRealtimeModule } from "../bus-realtime.module";
import { BusRealtimeHsscModule } from "../hssc/bus-realtime-hssc.module";
import { BusRealtimeJongroModule } from "../jongro/bus-realtime-jongro.module";
import { BusRealtimeGroupController } from "./bus-realtime-group.controller";
import { BusRealtimeGroupService } from "./bus-realtime-group.service";

@Module({
  imports: [BusRealtimeModule, BusRealtimeHsscModule, BusRealtimeJongroModule, BusRealtimeArrivalModule],
  controllers: [BusRealtimeGroupController],
  providers: [BusRealtimeGroupService, Clock],
})
export class BusRealtimeGroupModule {}
