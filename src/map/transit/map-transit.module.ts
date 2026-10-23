import { Module } from "@nestjs/common";
import { BusHsscRouteLineModule } from "../../bus/hssc-route-line/bus-hssc-route-line.module";
import { BusRoutePathModule } from "../../bus/route-path/bus-route-path.module";
import { MapModule } from "../map.module";
import { MapTransitController } from "./map-transit.controller";
import { MapTransitService } from "./map-transit.service";

@Module({
  imports: [MapModule, BusRoutePathModule, BusHsscRouteLineModule],
  controllers: [MapTransitController],
  providers: [MapTransitService],
})
export class MapTransitModule {}
