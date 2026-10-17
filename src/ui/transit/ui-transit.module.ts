import { Module } from "@nestjs/common";
import { BusConfigModule } from "../../bus/config/bus-config.module";
import { Clock } from "../../infra/clock";
import { MiniappsModule } from "../../miniapps/miniapps.module";
import { SubwayStationsModule } from "../../subway/stations/subway-stations.module";
import { UiModule } from "../ui.module";
import { UiTransitController } from "./ui-transit.controller";
import { UiTransitService } from "./ui-transit.service";

@Module({
  imports: [UiModule, BusConfigModule, MiniappsModule, SubwayStationsModule],
  controllers: [UiTransitController],
  providers: [UiTransitService, Clock],
})
export class UiTransitModule {}
