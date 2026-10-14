import { Module } from "@nestjs/common";
import { BusConfigModule } from "../../bus/config/bus-config.module";
import { Clock } from "../../infra/clock";
import { UiModule } from "../ui.module";
import { UiTransitListController } from "./ui-transit-list.controller";
import { UiTransitListService } from "./ui-transit-list.service";

@Module({
  imports: [UiModule, BusConfigModule],
  controllers: [UiTransitListController],
  providers: [UiTransitListService, Clock],
})
export class UiTransitListModule {}
