import { Module } from "@nestjs/common";
import { Clock } from "../../infra/clock";
import { MiniAppsModule } from "../../miniapps/miniapps.module";
import { UiModule } from "../ui.module";
import { UiCampusController } from "./ui-campus.controller";
import { UiCampusService } from "./ui-campus.service";

@Module({
  imports: [UiModule, MiniAppsModule],
  controllers: [UiCampusController],
  providers: [UiCampusService, Clock],
})
export class UiCampusModule {}
