import { Module } from "@nestjs/common";
import { Clock } from "../../infra/clock";
import { BusHsscRouteLineRepository } from "./bus-hssc-route-line.repository";
import { BusHsscRouteLineService } from "./bus-hssc-route-line.service";

@Module({
  providers: [BusHsscRouteLineRepository, BusHsscRouteLineService, Clock],
  exports: [BusHsscRouteLineService],
})
export class BusHsscRouteLineModule {}
