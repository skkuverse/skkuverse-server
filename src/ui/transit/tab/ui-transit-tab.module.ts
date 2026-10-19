import { Module } from "@nestjs/common";
import { BusConfigModule } from "../../../bus/config/bus-config.module";
import { Clock } from "../../../infra/clock";
import { SubwayStationsModule } from "../../../subway/stations/subway-stations.module";
import { UiModule } from "../../ui.module";
import { UiTransitModule } from "../ui-transit.module";
import { UiTransitTabController } from "./ui-transit-tab.controller";
import { UiTransitTabService } from "./ui-transit-tab.service";

@Module({
  imports: [UiModule, UiTransitModule, BusConfigModule, SubwayStationsModule],
  controllers: [UiTransitTabController],
  providers: [UiTransitTabService, Clock],
})
export class UiTransitTabModule {}
