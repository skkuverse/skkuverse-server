import { Module } from "@nestjs/common";
import { MiniappsModule } from "../miniapps.module";
import { MiniappsNotificationsModule } from "../notifications/miniapps-notifications.module";
import { MiniappsCatalogClient } from "./miniapps-catalog.client";
import { MiniappsCatalogController } from "./miniapps-catalog.controller";
import { MiniappsCatalogService } from "./miniapps-catalog.service";

@Module({
  imports: [MiniappsModule, MiniappsNotificationsModule],
  controllers: [MiniappsCatalogController],
  providers: [MiniappsCatalogService, MiniappsCatalogClient],
})
export class MiniappsCatalogModule {}
