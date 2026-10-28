import { Module } from "@nestjs/common";
import { Clock } from "../../infra/clock";
import { NoticesModule } from "../notices.module";
import { NoticesLegacyModule } from "../legacy/notices-legacy.module";
import { NoticesRowModule } from "../row/notices-row.module";
import { NoticesListController } from "./notices-list.controller";
import { NoticesListRepository } from "./notices-list.repository";
import { NoticesListService } from "./notices-list.service";

@Module({
  imports: [NoticesModule, NoticesRowModule, NoticesLegacyModule],
  controllers: [NoticesListController],
  providers: [NoticesListService, NoticesListRepository, Clock],
})
export class NoticesListModule {}
