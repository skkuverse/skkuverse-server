import { Module } from "@nestjs/common";
import { MiniappsModule } from "../miniapps.module";
import { MiniappsNotificationsModule } from "../notifications/miniapps-notifications.module";
import { MiniappsSenderModule } from "../sender/miniapps-sender.module";
import { PrivateFile } from "./private-file";

@Module({
  imports: [MiniappsModule, MiniappsSenderModule, MiniappsNotificationsModule],
  controllers: [PrivateFile],
})
export class MiniappsPushModule {}
