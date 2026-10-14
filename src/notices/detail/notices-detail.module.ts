import { Module } from "@nestjs/common";
import { NoticesModule } from "../notices.module";
import { NoticesDetailController } from "./notices-detail.controller";
import { NoticesDetailRepository } from "./notices-detail.repository";
import { NoticesDetailService } from "./notices-detail.service";

@Module({
  imports: [NoticesModule],
  controllers: [NoticesDetailController],
  providers: [NoticesDetailService, NoticesDetailRepository],
})
export class NoticesDetailModule {}
