import { Module } from "@nestjs/common";
import { Clock } from "../../infra/clock";
import { BusRouteAttributesRepository } from "./bus-route-attributes.repository";
import { BusRouteAttributesService } from "./bus-route-attributes.service";

@Module({
  providers: [BusRouteAttributesService, BusRouteAttributesRepository, Clock],
  exports: [BusRouteAttributesService],
})
export class BusRouteAttributesModule {}
