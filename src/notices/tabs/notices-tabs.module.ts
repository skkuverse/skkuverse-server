import { Module } from "@nestjs/common";
import { NoticesModule } from "../notices.module";
import { NoticesTabsController } from "./notices-tabs.controller";
import { NoticesTabsService } from "./notices-tabs.service";

@Module({
  imports: [NoticesModule],
  controllers: [NoticesTabsController],
  providers: [NoticesTabsService],
})
export class NoticesTabsModule {}
