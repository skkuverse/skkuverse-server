import { Module } from "@nestjs/common";
import { Clock } from "../../infra/clock";
import { BusRoutePathClient } from "./bus-route-path.client";
import { BusRoutePathPoller } from "./bus-route-path.poller";
import { BusRoutePathRepository } from "./bus-route-path.repository";
import { BusRoutePathService } from "./bus-route-path.service";

@Module({
  providers: [BusRoutePathRepository, BusRoutePathClient, BusRoutePathService, BusRoutePathPoller, Clock],
  exports: [BusRoutePathService],
})
export class BusRoutePathModule {}
