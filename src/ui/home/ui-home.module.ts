import { Module } from "@nestjs/common";
import { Clock } from "../../infra/clock";
import { MiniappsModule } from "../../miniapps/miniapps.module";
import { UiModule } from "../ui.module";
import { UiHomeController } from "./ui-home.controller";
import { UiHomeService } from "./ui-home.service";

@Module({
  imports: [UiModule, MiniappsModule],
  controllers: [UiHomeController],
  providers: [UiHomeService, Clock],
})
export class UiHomeModule {}
