import { Module } from "@nestjs/common";
import { BusRouteAttributesModule } from "../../route-attributes/bus-route-attributes.module";
import { BusRealtimeModule } from "../bus-realtime.module";
import { BusRealtimeArrivalService } from "./bus-realtime-arrival.service";

@Module({
  imports: [BusRealtimeModule, BusRouteAttributesModule],
  providers: [BusRealtimeArrivalService],
  exports: [BusRealtimeArrivalService],
})
export class BusRealtimeArrivalModule {}
