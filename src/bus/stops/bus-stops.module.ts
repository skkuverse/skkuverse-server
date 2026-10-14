import { Module } from "@nestjs/common";
import { BusStopsService } from "./bus-stops.service";

@Module({
  providers: [BusStopsService],
  exports: [BusStopsService],
})
export class BusStopsModule {}
