import { Controller, Get } from "@nestjs/common";
import { AppError } from "../../http/app.error";
import { RouteInput } from "../../http/route-input.decorator";
import { ZodValidationPipe } from "../../http/zod-validation.pipe";
import { noticeDetailRequest, type NoticeDetailRequest } from "./notices-detail.schema";
import { NoticesDetailService } from "./notices-detail.service";
import type { NoticeDetail } from "./notices-detail.wire";

@Controller("notices")
export class NoticesDetailController {
  constructor(private readonly notices: NoticesDetailService) {}

  @Get(":sourceId/:articleNo")
  async detail(
    @RouteInput(new ZodValidationPipe(noticeDetailRequest, "INVALID_PARAMS", { fieldCodes: { sourceId: "INVALID_SOURCE_ID" } }))
    { sourceId, articleNo }: NoticeDetailRequest,
  ): Promise<NoticeDetail> {
    const notice = await this.notices.findNotice(sourceId, articleNo);
    if (!notice) throw new AppError("NOT_FOUND", "notice not found", 404);
    return notice;
  }
}
