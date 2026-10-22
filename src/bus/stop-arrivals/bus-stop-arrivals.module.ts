import { Module } from "@nestjs/common";
import { Clock } from "../../infra/clock";
import { BusEtaSmartModule } from "../eta/smart/bus-eta-smart.module";
import { BusLiveGroupModule } from "../live/group/bus-live-group.module";
import { BusStopIndexModule } from "../stop-index/bus-stop-index.module";
import { BusStopArrivalsController } from "./bus-stop-arrivals.controller";
import { BusStopArrivalsService } from "./bus-stop-arrivals.service";

@Module({
  imports: [BusStopIndexModule, BusLiveGroupModule, BusEtaSmartModule],
  controllers: [BusStopArrivalsController],
  providers: [BusStopArrivalsService, Clock],
})
export class BusStopArrivalsModule {}
