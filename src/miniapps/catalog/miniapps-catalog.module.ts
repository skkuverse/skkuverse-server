import { Module } from "@nestjs/common";
import { MiniappsManifestModule } from "../manifest/miniapps-manifest.module";
import { MiniappsModule } from "../miniapps.module";
import { MiniappsNotificationsModule } from "../notifications/miniapps-notifications.module";
import { MiniappsCatalogController } from "./miniapps-catalog.controller";
import { MiniappsCatalogService } from "./miniapps-catalog.service";

@Module({
  imports: [MiniappsModule, MiniappsNotificationsModule, MiniappsManifestModule],
  controllers: [MiniappsCatalogController],
  providers: [MiniappsCatalogService],
})
export class MiniappsCatalogModule {}
