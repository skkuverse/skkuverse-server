import { Module } from "@nestjs/common";
import { Clock } from "../../infra/clock";
import { NoticesModule } from "../notices.module";
import { NoticesScreenModule } from "../screen/notices-screen.module";
import { NoticesDetailController } from "./notices-detail.controller";
import { NoticesDetailRepository } from "./notices-detail.repository";
import { NoticesDetailService } from "./notices-detail.service";

@Module({
  imports: [NoticesModule, NoticesScreenModule],
  controllers: [NoticesDetailController],
  providers: [NoticesDetailService, NoticesDetailRepository, Clock],
})
export class NoticesDetailModule {}
