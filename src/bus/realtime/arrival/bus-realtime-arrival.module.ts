import { Module } from "@nestjs/common";
import { BusRealtimeModule } from "../bus-realtime.module";
import { BusRealtimeArrivalService } from "./bus-realtime-arrival.service";

@Module({
  imports: [BusRealtimeModule],
  providers: [BusRealtimeArrivalService],
  exports: [BusRealtimeArrivalService],
})
export class BusRealtimeArrivalModule {}
