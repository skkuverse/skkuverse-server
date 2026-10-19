import { Module } from "@nestjs/common";
import { Clock } from "../../infra/clock";
import { MiniappsModule } from "../../miniapps/miniapps.module";
import { UiModule } from "../ui.module";
import { UiCampusController } from "./ui-campus.controller";
import { UiCampusRepository } from "./ui-campus.repository";
import { UiCampusService } from "./ui-campus.service";

@Module({
  imports: [UiModule, MiniappsModule],
  controllers: [UiCampusController],
  providers: [UiCampusService, UiCampusRepository, Clock],
})
export class UiCampusModule {}
