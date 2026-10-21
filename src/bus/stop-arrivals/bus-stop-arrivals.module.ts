import { Module } from "@nestjs/common";
import { Clock } from "../../infra/clock";
import { BusEtaSmartModule } from "../eta/smart/bus-eta-smart.module";
import { BusRealtimeGroupModule } from "../realtime/group/bus-realtime-group.module";
import { BusStopIndexModule } from "../stop-index/bus-stop-index.module";
import { BusStopArrivalsController } from "./bus-stop-arrivals.controller";
import { BusStopArrivalsService } from "./bus-stop-arrivals.service";

@Module({
  imports: [BusStopIndexModule, BusRealtimeGroupModule, BusEtaSmartModule],
  controllers: [BusStopArrivalsController],
  providers: [BusStopArrivalsService, Clock],
})
export class BusStopArrivalsModule {}
