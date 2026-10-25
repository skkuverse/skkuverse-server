import { Module } from "@nestjs/common";
import { Clock } from "../../infra/clock";
import { MiniappsModule } from "../miniapps.module";
import { MiniappsSenderModule } from "../sender/miniapps-sender.module";
import { MiniappsNotificationsClient } from "./miniapps-notifications.client";
import { MiniappsNotificationsController } from "./miniapps-notifications.controller";
import { MiniappsNotificationsRepository } from "./miniapps-notifications.repository";
import { MiniappsNotificationsService } from "./miniapps-notifications.service";

@Module({
  imports: [MiniappsModule, MiniappsSenderModule],
  controllers: [MiniappsNotificationsController],
  providers: [MiniappsNotificationsService, MiniappsNotificationsRepository, MiniappsNotificationsClient, Clock],
  exports: [MiniappsNotificationsService],
})
export class MiniappsNotificationsModule {}
