import { Module } from "@nestjs/common";
import { BusRouteOverlayController } from "./bus-route-overlay.controller";
import { BusRouteOverlayService } from "./bus-route-overlay.service";

@Module({
  controllers: [BusRouteOverlayController],
  providers: [BusRouteOverlayService],
})
export class BusRouteOverlayModule {}
