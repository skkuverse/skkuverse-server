import { Module } from "@nestjs/common";
import { Clock } from "../../infra/clock";
import { NoticesModule } from "../notices.module";
import { NoticesOverviewClient } from "./notices-overview.client";
import { NoticesOverviewController } from "./notices-overview.controller";
import { NoticesOverviewRepository } from "./notices-overview.repository";
import { NoticesOverviewService } from "./notices-overview.service";

@Module({
  imports: [NoticesModule],
  controllers: [NoticesOverviewController],
  providers: [NoticesOverviewService, NoticesOverviewRepository, NoticesOverviewClient, Clock],
})
export class NoticesOverviewModule {}
