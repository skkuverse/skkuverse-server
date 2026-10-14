import { Module } from "@nestjs/common";
import { Clock } from "../../infra/clock";
import { NoticesModule } from "../notices.module";
import { NoticesAttachmentClient } from "./notices-attachment.client";
import { NoticesAttachmentController } from "./notices-attachment.controller";
import { NoticesAttachmentService } from "./notices-attachment.service";

@Module({
  imports: [NoticesModule],
  controllers: [NoticesAttachmentController],
  providers: [NoticesAttachmentService, NoticesAttachmentClient, Clock],
})
export class NoticesAttachmentModule {}
