import { Module } from "@nestjs/common";
import { Clock } from "../../infra/clock";
import { BusRegistryModule } from "../registry/bus-registry.module";
import { BusRoutePathModule } from "../route-path/bus-route-path.module";
import { BusStopsModule } from "../stops/bus-stops.module";
import { BusStopIndexService } from "./bus-stop-index.service";

@Module({
  imports: [BusStopsModule, BusRegistryModule, BusRoutePathModule],
  providers: [BusStopIndexService, Clock],
  exports: [BusStopIndexService],
})
export class BusStopIndexModule {}
