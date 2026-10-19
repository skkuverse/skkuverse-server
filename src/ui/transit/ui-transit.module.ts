import { Module } from "@nestjs/common";
import { Clock } from "../../infra/clock";
import { MiniappsModule } from "../../miniapps/miniapps.module";
import { UiTransitRepository } from "./ui-transit.repository";
import { UiTransitService } from "./ui-transit.service";

@Module({
  imports: [MiniappsModule],
  providers: [UiTransitService, UiTransitRepository, Clock],
  exports: [UiTransitService],
})
export class UiTransitModule {}
