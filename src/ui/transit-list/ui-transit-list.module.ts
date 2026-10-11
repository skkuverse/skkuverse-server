import { Module } from "@nestjs/common";
import { BusModule } from "../../bus/bus.module";
import { Clock } from "../../infra/clock";
import { UiModule } from "../ui.module";
import { UiTransitListController } from "./ui-transit-list.controller";
import { UiTransitListService } from "./ui-transit-list.service";

@Module({
  imports: [UiModule, BusModule],
  controllers: [UiTransitListController],
  providers: [UiTransitListService, Clock],
})
export class UiTransitListModule {}
