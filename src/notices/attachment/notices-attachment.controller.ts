import { Controller, Get, Query, Res } from "@nestjs/common";
import type { Response } from "express";
import { NoticesAttachmentService } from "./notices-attachment.service";
import type { AttachmentRequest } from "./notices-attachment.types";

@Controller("notices")
export class NoticesAttachmentController {
  constructor(private readonly attachment: NoticesAttachmentService) {}

  // QUIRK(skku): some department servers refuse a hotlink without their own Referer, so this proxy sends it. The
  // CORP header overrides helmet's for the skkuverse.com pages that embed the file, error answers included.
  @Get("proxy/attachment")
  async proxyAttachment(@Query() query: AttachmentRequest, @Res() res: Response): Promise<void> {
    res.set("Cross-Origin-Resource-Policy", "cross-origin");
    await this.attachment.sendAttachment(query, res);
  }
}
